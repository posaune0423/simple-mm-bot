import { describe, expect, it } from "bun:test";
import { BasisPoints } from "../../../../src/domain/value-objects/BasisPoints";
import { MarketId } from "../../../../src/domain/value-objects/MarketId";
import { OrderIntent } from "../../../../src/domain/value-objects/OrderIntent";
import { PositionSnapshot } from "../../../../src/domain/value-objects/PositionSnapshot";
import { Price } from "../../../../src/domain/value-objects/Price";
import { Quantity } from "../../../../src/domain/value-objects/Quantity";
import { Quote } from "../../../../src/domain/value-objects/Quote";
import { QuoteLeg } from "../../../../src/domain/value-objects/QuoteLeg";

describe("domain value objects", () => {
  it("validates primitive market-making value objects", () => {
    expect(MarketId.create("BTC-USD").isOk()).toBe(true);
    expect(MarketId.create("").isErr()).toBe(true);

    expect(Price.create(100).isOk()).toBe(true);
    expect(Price.create(0).isErr()).toBe(true);
    expect(Price.create(Number.POSITIVE_INFINITY).isErr()).toBe(true);

    expect(Quantity.create(0.01).isOk()).toBe(true);
    expect(Quantity.create(Number.NaN).isErr()).toBe(true);

    expect(BasisPoints.create(-1).isOk()).toBe(true);
    expect(BasisPoints.createNonNegative(-1).isErr()).toBe(true);
  });

  it("creates quote legs and rejects invalid levels", () => {
    const leg = QuoteLeg.create({
      side: "bid",
      price: Price.unsafe(99),
      size: Quantity.unsafe(1),
      level: 0,
      exposureIntent: "increase_exposure",
      reasonTags: ["baseline"],
    });

    expect(leg.isOk()).toBe(true);
    expect(
      QuoteLeg.create({
        side: "ask",
        price: Price.unsafe(101),
        size: Quantity.unsafe(1),
        level: -1,
        exposureIntent: "reduce_exposure",
      }).isErr(),
    ).toBe(true);
  });

  it("rejects empty, crossed, negative-sigma, and unsorted quotes", () => {
    const market = MarketId.unsafe("BTC-USD");
    const referencePrice = Price.unsafe(100);
    const fairPrice = Price.unsafe(100);
    const bid0 = QuoteLeg.unsafe({
      side: "bid",
      price: Price.unsafe(99),
      size: Quantity.unsafe(1),
      level: 0,
      exposureIntent: "increase_exposure",
      reasonTags: [],
    });
    const bid1 = QuoteLeg.unsafe({
      side: "bid",
      price: Price.unsafe(98),
      size: Quantity.unsafe(1),
      level: 1,
      exposureIntent: "increase_exposure",
      reasonTags: [],
    });
    const ask0 = QuoteLeg.unsafe({
      side: "ask",
      price: Price.unsafe(101),
      size: Quantity.unsafe(1),
      level: 0,
      exposureIntent: "increase_exposure",
      reasonTags: [],
    });

    expect(
      Quote.create({
        market,
        bids: [bid0],
        asks: [ask0],
        referencePrice,
        fairPrice,
        sigma: 0.01,
        diagnostics: { quoteModel: "test", reasonTags: [] },
      }).isOk(),
    ).toBe(true);

    expect(
      Quote.create({
        market,
        bids: [],
        asks: [],
        referencePrice,
        fairPrice,
        sigma: 0.01,
        diagnostics: { quoteModel: "test", reasonTags: [] },
      }).isErr(),
    ).toBe(true);

    expect(
      Quote.create({
        market,
        bids: [QuoteLeg.unsafe({ ...bid0, price: Price.unsafe(101) })],
        asks: [QuoteLeg.unsafe({ ...ask0, price: Price.unsafe(100) })],
        referencePrice,
        fairPrice,
        sigma: 0.01,
        diagnostics: { quoteModel: "test", reasonTags: [] },
      }).isErr(),
    ).toBe(true);

    expect(
      Quote.create({
        market,
        bids: [bid0],
        asks: [ask0],
        referencePrice,
        fairPrice,
        sigma: -1,
        diagnostics: { quoteModel: "test", reasonTags: [] },
      }).isErr(),
    ).toBe(true);

    expect(
      Quote.create({
        market,
        bids: [bid1],
        asks: [ask0],
        referencePrice,
        fairPrice,
        sigma: 0.01,
        diagnostics: { quoteModel: "test", reasonTags: [] },
      }).isErr(),
    ).toBe(true);
  });

  it("derives exposure intent from signed position and order side", () => {
    const long = PositionSnapshot.unsafe({
      market: MarketId.unsafe("BTC-USD"),
      signedQuantity: 2,
      averageEntryPrice: 100,
      unrealizedPnl: 0,
    });
    const short = PositionSnapshot.unsafe({
      market: MarketId.unsafe("BTC-USD"),
      signedQuantity: -2,
      averageEntryPrice: 100,
      unrealizedPnl: 0,
    });
    const flat = PositionSnapshot.unsafe({
      market: MarketId.unsafe("BTC-USD"),
      signedQuantity: 0,
      averageEntryPrice: null,
      unrealizedPnl: null,
    });

    expect(PositionSnapshot.side(long)).toBe("long");
    expect(PositionSnapshot.exposureIntentForOrderSide(long, "sell")).toBe("reduce_exposure");
    expect(PositionSnapshot.exposureIntentForOrderSide(short, "buy")).toBe("reduce_exposure");
    expect(PositionSnapshot.exposureIntentForOrderSide(flat, "buy")).toBe("increase_exposure");
    expect(
      PositionSnapshot.maxReduceQuantity(
        PositionSnapshot.unsafe({ ...flat, signedQuantity: 1e-13 }),
      ),
    ).toBe(0);
  });

  it("validates order intent as submit-before-venue intent", () => {
    const valid = OrderIntent.create({
      key: "bid:0",
      market: MarketId.unsafe("BTC-USD"),
      orderSide: "buy",
      price: Price.unsafe(99),
      quantity: Quantity.unsafe(1),
      timeInForce: "ALO",
      postOnly: true,
      reduceOnly: false,
      exposureIntent: "increase_exposure",
      sourceQuoteSide: "bid",
      sourceQuoteLevel: 0,
      reasonTags: [],
      clientOrderId: "cycle-1:bid:0",
    });

    expect(valid.isOk()).toBe(true);
    const trimmed = OrderIntent.create({
      ...valid._unsafeUnwrap(),
      key: " bid:0 ",
      clientOrderId: " cycle-1:bid:0 ",
    })._unsafeUnwrap();
    expect(trimmed.key).toBe("bid:0");
    expect(trimmed.clientOrderId).toBe("cycle-1:bid:0");
    expect(
      OrderIntent.create({
        key: "ask:0",
        market: MarketId.unsafe("BTC-USD"),
        orderSide: "sell",
        price: Price.unsafe(101),
        quantity: Quantity.unsafe(1),
        timeInForce: "ALO",
        postOnly: true,
        reduceOnly: false,
        exposureIntent: "reduce_exposure",
        sourceQuoteSide: "ask",
        sourceQuoteLevel: 0,
        reasonTags: [],
        clientOrderId: "cycle-1:ask:0",
      }).isErr(),
    ).toBe(true);
  });
});
