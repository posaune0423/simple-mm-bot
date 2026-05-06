import { randomUUID } from "node:crypto";

import type { Fill } from "../domain/entities/Fill.ts";
import type { Quote } from "../domain/entities/Quote.ts";
import type {
  CapitalMode,
  MarkoutTelemetry,
  OrderTelemetry,
  TelemetryEvent,
  TelemetryRun,
} from "../telemetry/Telemetry.ts";
import type { MarketSnapshot } from "../domain/ports/IMarketFeed.ts";
import type { ITelemetryRepository } from "../telemetry/ITelemetryRepository.ts";
import type { AppMode } from "../config.ts";
import { logger } from "../utils/logger.ts";

export interface TelemetryRecorderOptions {
  runId?: string;
  mode: AppMode;
  venue: string;
  capitalMode: CapitalMode;
  market: string;
  configJson: unknown;
  gitSha?: string;
  gitDirty: boolean;
  horizonsSec?: ReadonlyArray<5 | 30 | 60 | 300>;
}

interface PendingFill {
  fill: Fill;
  recordedHorizons: Set<number>;
}

const DEFAULT_HORIZONS: ReadonlyArray<5 | 30 | 60 | 300> = [5, 30, 60, 300];

export class TelemetryRecorder {
  readonly runId: string;
  private readonly pendingFills = new Map<string, PendingFill>();

  constructor(
    private readonly repository: ITelemetryRepository,
    private readonly options: TelemetryRecorderOptions,
  ) {
    this.runId = options.runId ?? randomUUID();
  }

  async start(startedAt = Date.now()): Promise<void> {
    await this.repository.startRun({
      id: this.runId,
      mode: this.options.mode,
      venue: this.options.venue,
      capitalMode: this.options.capitalMode,
      market: this.options.market,
      configJson: this.options.configJson,
      gitSha: this.options.gitSha,
      gitDirty: this.options.gitDirty,
      startedAt,
      status: "running",
    });
  }

  async finish(endedAt = Date.now(), status: TelemetryRun["status"] = "completed"): Promise<void> {
    await this.repository.finishRun(this.runId, endedAt, status);
  }

  async recordMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
    await this.record({
      type: "market_snapshot",
      timestamp: Date.now(),
      market: snapshot.market,
      payload: {
        bestBid: snapshot.bestBid,
        bestAsk: snapshot.bestAsk,
        midPrice: midPrice(snapshot),
        microPrice: snapshot.microPrice,
        markPrice: snapshot.markPrice,
        spreadBps: spreadBps(snapshot),
        stalenessMs: Math.max(0, Date.now() - snapshot.timestamp),
      },
    });
    await this.recordDueMarkouts(snapshot);
  }

  async recordQuote(snapshot: MarketSnapshot, positionQty: number, quote: Quote): Promise<void> {
    const mid = midPrice(snapshot);
    await this.record({
      type: "quote",
      timestamp: Date.now(),
      market: snapshot.market,
      payload: {
        positionQty,
        fairPrice: quote.fairPrice,
        sigma: quote.sigma,
        bid: quote.bid,
        ask: quote.ask,
        bidSize: quote.bidSize,
        askSize: quote.askSize,
        bidDistanceBps: distanceBps(mid, quote.bid),
        askDistanceBps: distanceBps(quote.ask, mid),
        expectedSpreadBps: distanceBps(quote.ask, quote.bid),
        timeInForce: quote.policy,
      },
    });
  }

  async recordOrder(payload: OrderTelemetry, market = this.options.market): Promise<void> {
    await this.record({
      type: "order",
      timestamp: Date.now(),
      market,
      payload,
    });
  }

  async recordFill(fill: Fill): Promise<void> {
    this.pendingFills.set(fill.id, { fill, recordedHorizons: new Set() });
    await this.record({
      type: "fill",
      timestamp: fill.filledAt,
      market: fill.market,
      payload: {
        fillId: fill.id,
        orderId: fill.quoteId,
        side: fill.side,
        price: fill.price,
        qty: fill.qty,
        fee: fill.fee,
        notional: fill.price * fill.qty,
        makerTaker: "unknown",
        filledAt: fill.filledAt,
      },
    });
  }

  async recordRuntimeHealth(
    level: "info" | "warn" | "error",
    code: string,
    message: string,
    rawSummary?: unknown,
  ): Promise<void> {
    await this.record({
      type: "runtime_health",
      timestamp: Date.now(),
      market: this.options.market,
      payload: { level, code, message, rawSummary },
    });
  }

  private async recordDueMarkouts(snapshot: MarketSnapshot): Promise<void> {
    const horizons = this.options.horizonsSec ?? DEFAULT_HORIZONS;
    for (const pending of this.pendingFills.values()) {
      for (const horizonSec of horizons) {
        if (pending.recordedHorizons.has(horizonSec)) {
          continue;
        }
        if (snapshot.timestamp - pending.fill.filledAt < horizonSec * 1000) {
          continue;
        }
        await this.recordMarkout(pending.fill, snapshot, horizonSec);
        pending.recordedHorizons.add(horizonSec);
      }
    }
    for (const [fillId, pending] of this.pendingFills) {
      if (pending.recordedHorizons.size >= horizons.length) {
        this.pendingFills.delete(fillId);
      }
    }
  }

  private async recordMarkout(
    fill: Fill,
    snapshot: MarketSnapshot,
    horizonSec: 5 | 30 | 60 | 300,
  ): Promise<void> {
    const basisPrice = snapshot.markPrice;
    const fillBasis = fill.markPriceAtFill ?? fill.price;
    const signedMove = fill.side === "buy" ? basisPrice - fillBasis : fillBasis - basisPrice;
    const payload: MarkoutTelemetry = {
      fillId: fill.id,
      basis: "mark",
      horizonSec,
      markoutBps: fillBasis > 0 ? (signedMove / fillBasis) * 10_000 : 0,
      spreadCaptureBps: fillBasis > 0 ? ((fill.price - fillBasis) / fillBasis) * 10_000 : 0,
      adverse: signedMove < 0,
    };
    await this.record({
      type: "markout",
      timestamp: snapshot.timestamp,
      market: fill.market,
      payload,
    });
  }

  private async record(
    event: Omit<TelemetryEvent, "id" | "runId" | "mode" | "venue">,
  ): Promise<void> {
    await this.repository
      .recordEvent({
        id: randomUUID(),
        runId: this.runId,
        mode: this.options.mode,
        venue: this.options.venue,
        ...event,
      } as TelemetryEvent)
      .catch((error: unknown) => {
        logger.warn(`telemetry.record_failed type=${event.type} error=${String(error)}`);
      });
  }
}

function midPrice(snapshot: MarketSnapshot): number {
  return (snapshot.bestBid + snapshot.bestAsk) / 2;
}

function spreadBps(snapshot: MarketSnapshot): number {
  return distanceBps(snapshot.bestAsk, snapshot.bestBid);
}

function distanceBps(upper: number, lower: number): number {
  if (lower <= 0) {
    return 0;
  }
  return ((upper - lower) / lower) * 10_000;
}
