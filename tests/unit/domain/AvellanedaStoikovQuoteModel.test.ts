import { describe, expect, test } from "bun:test";
import { AvellanedaStoikovQuoteModel } from "../../../src/domain/quote-models/AvellanedaStoikovQuoteModel";
import { BasisPoints } from "../../../src/domain/value-objects/BasisPoints";
import { Price } from "../../../src/domain/value-objects/Price";
import { Quantity } from "../../../src/domain/value-objects/Quantity";

describe("AvellanedaStoikovQuoteModel", () => {
  test("uses fixed spread behavior when gamma is zero", () => {
    const model = new AvellanedaStoikovQuoteModel({
      gamma: 0,
      kappa: 2,
      kInv: 0.3,
    });

    const result = model.compute({
      fairPrice: Price.unsafe(100),
      volatilitySigma: 0.5,
      quoteSize: Quantity.unsafe(0.01),
      positionQty: 0,
      inventoryScale: 0.05,
      timeHorizonSec: 30,
    });

    expect(result.isOk()).toBe(true);
    const quote = result._unsafeUnwrap();
    expect(Number((quote.askPrice - quote.bidPrice).toFixed(6))).toBe(1);
  });

  test("enforces min spread bps floor", () => {
    const model = new AvellanedaStoikovQuoteModel({
      gamma: 0,
      kappa: 10_000,
      kInv: 0,
    });

    const quote = model
      .compute({
        fairPrice: Price.unsafe(100),
        volatilitySigma: 0.01,
        quoteSize: Quantity.unsafe(0.01),
        positionQty: 0,
        inventoryScale: 1,
        timeHorizonSec: 30,
        minSpreadBps: BasisPoints.unsafe(10),
      })
      ._unsafeUnwrap();

    expect(Number((quote.askPrice - quote.bidPrice).toFixed(6))).toBe(0.1);
  });

  test("moves reservation price lower for long inventory and higher for short inventory", () => {
    const model = new AvellanedaStoikovQuoteModel({
      gamma: 0.02,
      kappa: 1.5,
      kInv: 2,
    });

    const base = {
      fairPrice: Price.unsafe(200),
      volatilitySigma: 0.2,
      quoteSize: Quantity.unsafe(0.01),
      inventoryScale: 1,
      timeHorizonSec: 30,
    };

    const longQuote = model.compute({ ...base, positionQty: 3 })._unsafeUnwrap();
    const shortQuote = model.compute({ ...base, positionQty: -3 })._unsafeUnwrap();

    expect(longQuote.reservationPrice).toBeLessThan(200);
    expect(shortQuote.reservationPrice).toBeGreaterThan(200);
  });

  test("returns Err for invalid model input", () => {
    const model = new AvellanedaStoikovQuoteModel({
      gamma: 0,
      kappa: 0,
      kInv: 0,
    });

    const result = model.compute({
      fairPrice: Price.unsafe(100),
      volatilitySigma: Number.NaN,
      quoteSize: Quantity.unsafe(0.01),
      positionQty: 0,
      inventoryScale: 1,
      timeHorizonSec: 30,
    });

    expect(result.isErr()).toBe(true);
  });
});
