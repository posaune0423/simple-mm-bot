import { describe, expect, test } from "bun:test";

import { FundingAwareQuoteModel } from "../../../src/domain/quote-models/FundingAwareQuoteModel.ts";
import { BasisPoints } from "../../../src/domain/value-objects/BasisPoints.ts";
import { Price } from "../../../src/domain/value-objects/Price.ts";
import { Quantity } from "../../../src/domain/value-objects/Quantity.ts";

describe("FundingAwareQuoteModel", () => {
  test("adjusts fair price by clamped alpha drift", () => {
    const result = model().compute({
      ...input(),
      signals: { alphaDriftBps: 2 },
    });

    expect(result.isOk()).toBe(true);
    const quote = result._unsafeUnwrap();
    expect(quote.fairPrice).toBeCloseTo(100 * Math.exp(2 / 10_000), 8);
    expect(quote.reservationPrice).toBeCloseTo(quote.fairPrice, 8);
    expect(quote.diagnostics.alphaDriftBps).toBe(2);
  });

  test("skews reservation price from target inventory error", () => {
    const result = model().compute({
      ...input(),
      positionQty: 0.35,
      signals: { targetInventoryQty: 0.1 },
    });

    expect(result.isOk()).toBe(true);
    const quote = result._unsafeUnwrap();
    expect(quote.reservationPrice).toBeLessThan(quote.fairPrice);
    expect(quote.diagnostics.targetInventoryQty).toBe(0.1);
    expect(quote.diagnostics.inventoryErrorQty).toBeCloseTo(0.25);
  });

  test("widens spread by absolute expected funding", () => {
    const neutral = model().compute(input())._unsafeUnwrap();
    const funded = model().compute({
      ...input(),
      signals: { expectedFundingBps: -20 },
    });

    expect(funded.isOk()).toBe(true);
    const quote = funded._unsafeUnwrap();
    expect(quote.askPrice - quote.bidPrice).toBeGreaterThan(neutral.askPrice - neutral.bidPrice);
    expect(quote.diagnostics.expectedFundingBps).toBe(-20);
  });

  test("cash-scales positive funding carry to lower both quote offsets for long-pays funding", () => {
    const neutral = model().compute(input())._unsafeUnwrap();
    const funded = model().compute({
      ...input(),
      signals: { fundingRateBps: 36, expectedFundingBps: 20 },
    });

    expect(funded.isOk()).toBe(true);
    const quote = funded._unsafeUnwrap();
    expect(quote.fairPrice).toBe(neutral.fairPrice);
    expect(quote.reservationPrice).toBeDefined();
    expect(neutral.reservationPrice).toBeDefined();
    expect(quote.reservationPrice ?? 0).toBeCloseTo((neutral.reservationPrice ?? 0) - 0.2);
    expect(quote.bidPrice).toBeLessThan(neutral.bidPrice);
    expect(quote.askPrice).toBeLessThan(neutral.askPrice);
    expect(quote.diagnostics.fundingRateBps).toBe(36);
  });

  test("cash-scales negative funding carry to raise both quote offsets for long-receives funding", () => {
    const neutral = model().compute(input())._unsafeUnwrap();
    const funded = model().compute({
      ...input(),
      signals: { fundingRateBps: -36, expectedFundingBps: -20 },
    });

    expect(funded.isOk()).toBe(true);
    const quote = funded._unsafeUnwrap();
    expect(quote.reservationPrice).toBeDefined();
    expect(neutral.reservationPrice).toBeDefined();
    expect(quote.reservationPrice ?? 0).toBeCloseTo((neutral.reservationPrice ?? 0) + 0.2);
    expect(quote.bidPrice).toBeGreaterThan(neutral.bidPrice);
    expect(quote.askPrice).toBeGreaterThan(neutral.askPrice);
  });

  test("rejects invalid funding-aware signals", () => {
    const result = model().compute({
      ...input(),
      signals: { basisBps: Number.NaN },
    });

    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr().message).toContain("basisBps must be finite");
  });
});

function model(): FundingAwareQuoteModel {
  return new FundingAwareQuoteModel({
    gamma: 0,
    kappa: 625,
    kInv: 2,
    funding: { spreadWideningBpsPerAbsFundingBps: 0.1 },
  });
}

function input() {
  return {
    fairPrice: Price.unsafe(100),
    volatilitySigma: 0.01,
    quoteSize: Quantity.unsafe(1),
    positionQty: 0,
    inventoryScale: 1,
    timeHorizonSec: 10,
    minSpreadBps: BasisPoints.unsafe(4),
  };
}
