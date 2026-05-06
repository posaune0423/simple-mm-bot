import { describe, expect, test } from "bun:test";

import { RecordOhlcvUseCase } from "../../src/application/usecases/RecordOhlcvUseCase.ts";
import type { OhlcvRecord } from "../../src/domain/ports/IOhlcvRepository.ts";

describe("RecordOhlcvUseCase", () => {
  test("skips top-of-book snapshots that do not contain OHLCV data", async () => {
    const saved: OhlcvRecord[][] = [];
    const useCase = new RecordOhlcvUseCase({
      async findByRange() {
        return [];
      },
      async saveMany(records) {
        saved.push(records);
      },
    });

    await useCase.execute({
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 100,
      timestamp: 1_700_000_020_000,
      marginRatio: null,
    });

    expect(saved).toEqual([]);
  });

  test("saves venue OHLCV candles directly", async () => {
    const saved: OhlcvRecord[][] = [];
    const useCase = new RecordOhlcvUseCase({
      async findByRange() {
        return [];
      },
      async saveMany(records) {
        saved.push(records);
      },
    });

    await useCase.execute({
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 105,
      timestamp: 1_700_000_000_000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 12.5,
      marginRatio: null,
    });

    expect(saved.at(-1)?.[0]).toEqual({
      market: "BTC-USD",
      timeframe: "1m",
      ts: 1_700_000_000_000,
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 12.5,
    });
  });

  test("aggregates market snapshots into one minute candles", async () => {
    const saved: OhlcvRecord[][] = [];
    const useCase = new RecordOhlcvUseCase({
      async findByRange() {
        return [];
      },
      async saveMany(records) {
        saved.push(records);
      },
    });

    await useCase.execute({
      market: "BTC-USD",
      bestBid: 99,
      bestAsk: 101,
      microPrice: 100,
      markPrice: 100,
      timestamp: 1_700_000_020_000,
      volume: 2,
      marginRatio: null,
    });
    await useCase.execute({
      market: "BTC-USD",
      bestBid: 104,
      bestAsk: 106,
      microPrice: 105,
      markPrice: 105,
      timestamp: 1_700_000_035_000,
      volume: 3,
      marginRatio: null,
    });

    expect(saved.at(-1)?.[0]).toEqual({
      market: "BTC-USD",
      timeframe: "1m",
      ts: 1_699_999_980_000,
      open: 100,
      high: 105,
      low: 100,
      close: 105,
      volume: 5,
    });
  });

  test("continues an existing stored candle in the same minute", async () => {
    const saved: OhlcvRecord[][] = [];
    const useCase = new RecordOhlcvUseCase({
      async findByRange() {
        return [
          {
            market: "BTC-USD",
            timeframe: "1m",
            ts: 1_700_000_000_000,
            open: 101,
            high: 103,
            low: 99,
            close: 102,
            volume: 4,
          },
        ];
      },
      async saveMany(records) {
        saved.push(records);
      },
    });

    await useCase.execute({
      market: "BTC-USD",
      bestBid: 97,
      bestAsk: 99,
      microPrice: 98,
      markPrice: 98,
      timestamp: 1_700_000_030_000,
      volume: 1,
      marginRatio: null,
    });

    expect(saved.at(-1)?.[0]).toEqual({
      market: "BTC-USD",
      timeframe: "1m",
      ts: 1_700_000_000_000,
      open: 101,
      high: 103,
      low: 98,
      close: 98,
      volume: 5,
    });
  });
});
