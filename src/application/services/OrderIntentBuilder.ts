import { err, ok, type Result } from "neverthrow";
import { match, P } from "ts-pattern";
import type { OrderTimeInForce } from "../../domain/types/Order";
import type { MarketSnapshot } from "../../domain/ports/IMarketFeed";
import type { DomainError } from "../../domain/errors/DomainError";
import { OrderIntent } from "../../domain/value-objects/OrderIntent";
import type { Quote } from "../../domain/value-objects/Quote";
import type { QuoteLeg } from "../../domain/value-objects/QuoteLeg";
import { Price } from "../../domain/value-objects/Price";
import { ApplicationError } from "../errors/ApplicationError";

const MAX_OPEN_QUOTE_TOUCH_STALENESS_MS = 1_500;
const EPOCH_MS_LOWER_BOUND = 1_000_000_000_000;
const NORMAL_PASSIVE_TOUCH_MARGIN_BPS = 0.25;
const REDUCE_PASSIVE_TOUCH_MARGIN_BPS = 0.05;
const MOMENTUM_GUARD_THRESHOLD_BPS = 0.05;
const OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS = 0.8;
const REDUCE_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS = 0.8;
const MOMENTUM_GUARD_MULTIPLIER = 1;
const MAX_MOMENTUM_GUARD_BPS = 8;

type OrderIntentBuilderError = DomainError | OrderIntentBuildFailedError;

export class OrderIntentBuildFailedError extends ApplicationError {
  readonly code = "application.order_intent_builder.build_failed";

  constructor(
    message: string,
    context: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(message, { context });
  }
}

type OrderIntentSkip = Readonly<{
  key: string;
  reason:
    | "stale_touch"
    | "downtrend_open_bid"
    | "uptrend_open_ask"
    | "downtrend_reduce_bid"
    | "uptrend_reduce_ask";
  sourceQuoteSide: "bid" | "ask";
  sourceQuoteLevel: number;
}>;

type OrderIntentBuildInput = Readonly<{
  quote: Quote;
  quoteCycleId: string;
  execution: {
    defaultTimeInForce: OrderTimeInForce;
    postOnly: boolean;
  };
  placement: {
    trendBps: number;
    touchByLegKey: ReadonlyMap<string, MarketSnapshot>;
  };
}>;

export type OrderIntentBuildResult = Readonly<{
  intents: readonly OrderIntent[];
  skipped: readonly OrderIntentSkip[];
}>;

interface OrderIntentBuilderOptions {
  nowMs?: () => number;
}

export class OrderIntentBuilder {
  private readonly nowMs: () => number;

  constructor(options: OrderIntentBuilderOptions = {}) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  build(input: OrderIntentBuildInput): Result<OrderIntentBuildResult, OrderIntentBuilderError> {
    const intents: OrderIntent[] = [];
    const skipped: OrderIntentSkip[] = [];

    for (const leg of [...input.quote.bids, ...input.quote.asks]) {
      const key = legKey(leg);
      const touch = input.placement.touchByLegKey.get(key);
      if (touch === undefined) {
        return err(
          new OrderIntentBuildFailedError(`missing placement touch for quote leg: ${key}`, {
            key,
          }),
        );
      }

      const skipReason = this.skipReason(leg, touch, input.placement.trendBps);
      if (skipReason !== null) {
        skipped.push({
          key,
          reason: skipReason,
          sourceQuoteSide: leg.side,
          sourceQuoteLevel: leg.level,
        });
        continue;
      }

      const orderSide = match(leg.side)
        .with("bid", () => "buy" as const)
        .with("ask", () => "sell" as const)
        .exhaustive();
      const price = Price.unsafe(
        guardedLimitPrice({
          side: orderSide,
          price: leg.price,
          policy: input.execution.defaultTimeInForce,
          reduceOnly: leg.exposureIntent === "reduce_exposure",
          snapshot: touch,
          trendBps: input.placement.trendBps,
        }),
      );
      const intent = OrderIntent.create({
        key,
        market: input.quote.market,
        orderSide,
        price,
        quantity: leg.size,
        timeInForce: input.execution.defaultTimeInForce,
        postOnly: input.execution.postOnly,
        reduceOnly: leg.exposureIntent === "reduce_exposure",
        exposureIntent: leg.exposureIntent,
        sourceQuoteSide: leg.side,
        sourceQuoteLevel: leg.level,
        reasonTags: leg.reasonTags,
        clientOrderId: `${input.quoteCycleId}:${key}`,
      });
      if (intent.isErr()) {
        return err(intent.error);
      }
      intents.push(intent.value);
    }

    return ok({
      intents: Object.freeze(intents),
      skipped: Object.freeze(skipped),
    });
  }

  private skipReason(
    leg: QuoteLeg,
    touch: MarketSnapshot,
    trendBps: number,
  ): OrderIntentSkip["reason"] | null {
    return match({
      exposureIntent: leg.exposureIntent,
      side: leg.side,
      isStale: isStaleEpochSnapshot(touch, this.nowMs()),
      trendBps,
    })
      .with(
        {
          exposureIntent: "reduce_exposure",
          side: "bid",
          trendBps: P.when((trend) => trend <= -REDUCE_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS),
        },
        () => "downtrend_reduce_bid" as const,
      )
      .with(
        {
          exposureIntent: "reduce_exposure",
          side: "ask",
          trendBps: P.when((trend) => trend >= REDUCE_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS),
        },
        () => "uptrend_reduce_ask" as const,
      )
      .with({ exposureIntent: P.when((intent) => intent !== "increase_exposure") }, () => null)
      .with({ isStale: true }, () => "stale_touch" as const)
      .with(
        {
          side: "bid",
          trendBps: P.when((trend) => trend <= -OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS),
        },
        () => "downtrend_open_bid" as const,
      )
      .with(
        {
          side: "ask",
          trendBps: P.when((trend) => trend >= OPEN_SIDE_MOMENTUM_SKIP_THRESHOLD_BPS),
        },
        () => "uptrend_open_ask" as const,
      )
      .otherwise(() => null);
  }
}

function legKey(leg: QuoteLeg): string {
  return `${leg.side}:${leg.level}`;
}

function guardedLimitPrice(input: {
  side: "buy" | "sell";
  price: number;
  policy: OrderTimeInForce;
  reduceOnly: boolean;
  snapshot: MarketSnapshot;
  trendBps: number;
}): number {
  const { side, price, policy, reduceOnly, snapshot, trendBps } = input;
  const currentMid = (snapshot.bestBid + snapshot.bestAsk) / 2;
  const momentumGuard =
    currentMid *
    (Math.min(Math.abs(trendBps) * MOMENTUM_GUARD_MULTIPLIER, MAX_MOMENTUM_GUARD_BPS) / 10_000);
  return match({ policy, side })
    .with({ policy: "IOC" }, () => price)
    .with({ policy: "ALO", side: "buy" }, () => {
      const passiveBid = Math.min(price, snapshot.bestBid);
      return trendBps < -MOMENTUM_GUARD_THRESHOLD_BPS ? passiveBid - momentumGuard : passiveBid;
    })
    .with({ policy: "ALO", side: "sell" }, () => {
      const passiveAsk = Math.max(price, snapshot.bestAsk);
      return trendBps > MOMENTUM_GUARD_THRESHOLD_BPS ? passiveAsk + momentumGuard : passiveAsk;
    })
    .otherwise(() => {
      const passiveMarginBps = reduceOnly
        ? REDUCE_PASSIVE_TOUCH_MARGIN_BPS
        : NORMAL_PASSIVE_TOUCH_MARGIN_BPS;

      return match(side)
        .with("buy", () => {
          const passiveBid = snapshot.bestBid * (1 - passiveMarginBps / 10_000);
          const guardedPrice = Math.min(price, passiveBid);
          return trendBps < -MOMENTUM_GUARD_THRESHOLD_BPS
            ? guardedPrice - momentumGuard
            : guardedPrice;
        })
        .with("sell", () => {
          const passiveAsk = snapshot.bestAsk * (1 + passiveMarginBps / 10_000);
          const guardedPrice = Math.max(price, passiveAsk);
          return trendBps > MOMENTUM_GUARD_THRESHOLD_BPS
            ? guardedPrice + momentumGuard
            : guardedPrice;
        })
        .exhaustive();
    });
}

function isStaleEpochSnapshot(snapshot: MarketSnapshot, nowMs: number): boolean {
  const touchTimestamp = snapshot.bookUpdatedAt ?? snapshot.timestamp;
  if (snapshot.bookUpdatedAt === undefined && isCandleSnapshot(snapshot)) {
    return false;
  }
  return (
    touchTimestamp >= EPOCH_MS_LOWER_BOUND &&
    Math.max(0, nowMs - touchTimestamp) > MAX_OPEN_QUOTE_TOUCH_STALENESS_MS
  );
}

function isCandleSnapshot(snapshot: MarketSnapshot): boolean {
  return (
    snapshot.open !== undefined &&
    snapshot.high !== undefined &&
    snapshot.low !== undefined &&
    snapshot.close !== undefined
  );
}
