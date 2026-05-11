import { describe, expect, test } from "bun:test";

import { QuoteControlPolicy } from "../../src/domain/QuoteControlPolicy.ts";

describe("QuoteControlPolicy", () => {
  test("disables only sides with enough negative markout samples", () => {
    const policy = new QuoteControlPolicy({
      enabled: true,
      minAverageMarkoutBps: 0,
      minSamples: 2,
      horizonsSec: [5, 30, 300],
    });

    const controls = policy.controlsFor([
      {
        side: "buy",
        horizons: [
          { horizonSec: 5, sampleCount: 2, averageMarkoutBps: 0.4 },
          { horizonSec: 30, sampleCount: 2, averageMarkoutBps: -0.1 },
          { horizonSec: 300, sampleCount: 1, averageMarkoutBps: -5 },
        ],
      },
      {
        side: "sell",
        horizons: [{ horizonSec: 30, sampleCount: 2, averageMarkoutBps: 0.2 }],
      },
    ]);

    expect(controls.bid).toEqual({
      disableOpen: true,
      reasonTags: ["quality_gate:buy:30s_markout_below_0bps"],
    });
    expect(controls.ask).toBeUndefined();
  });

  test("does not gate when disabled or below the sample floor", () => {
    const disabled = new QuoteControlPolicy({
      enabled: false,
      minAverageMarkoutBps: 0,
      minSamples: 1,
      horizonsSec: [5],
    });
    const underSampled = new QuoteControlPolicy({
      enabled: true,
      minAverageMarkoutBps: 0,
      minSamples: 3,
      horizonsSec: [5],
    });
    const quality = [
      {
        side: "sell" as const,
        horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -10 }],
      },
    ];

    expect(disabled.controlsFor(quality)).toEqual({});
    expect(underSampled.controlsFor(quality)).toEqual({});
  });

  test("gates both open sides when both sides fail the gate", () => {
    const policy = new QuoteControlPolicy({
      enabled: true,
      minAverageMarkoutBps: 0,
      minSamples: 2,
      horizonsSec: [5, 30, 300],
    });

    const controls = policy.controlsFor([
      {
        side: "buy",
        horizons: [
          { horizonSec: 5, sampleCount: 2, averageMarkoutBps: -0.2 },
          { horizonSec: 30, sampleCount: 2, averageMarkoutBps: -0.4 },
        ],
      },
      {
        side: "sell",
        horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -2 }],
      },
    ]);

    expect(controls.bid).toEqual({
      disableOpen: true,
      reasonTags: [
        "quality_gate:buy:5s_markout_below_0bps",
        "quality_gate:buy:30s_markout_below_0bps",
      ],
    });
    expect(controls.ask).toEqual({
      disableOpen: true,
      reasonTags: ["quality_gate:sell:5s_markout_below_0bps"],
    });
  });

  test("gates both open sides when both failed sides tie", () => {
    const policy = new QuoteControlPolicy({
      enabled: true,
      minAverageMarkoutBps: 0,
      minSamples: 2,
      horizonsSec: [5],
    });

    const controls = policy.controlsFor([
      {
        side: "buy",
        horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -1 }],
      },
      {
        side: "sell",
        horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -1 }],
      },
    ]);

    expect(controls.bid).toEqual({
      disableOpen: true,
      reasonTags: ["quality_gate:buy:5s_markout_below_0bps"],
    });
    expect(controls.ask).toEqual({
      disableOpen: true,
      reasonTags: ["quality_gate:sell:5s_markout_below_0bps"],
    });
  });

  test("keeps failed open sides gated when inventory can provide a reduce side", () => {
    const policy = new QuoteControlPolicy({
      enabled: true,
      minAverageMarkoutBps: 0,
      minSamples: 2,
      horizonsSec: [5],
    });

    const controls = policy.controlsFor(
      [
        {
          side: "buy",
          horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -0.2 }],
        },
        {
          side: "sell",
          horizons: [{ horizonSec: 5, sampleCount: 2, averageMarkoutBps: -2 }],
        },
      ],
      { positionQty: 0.3 },
    );

    expect(controls.bid).toEqual({
      disableOpen: true,
      reasonTags: ["quality_gate:buy:5s_markout_below_0bps"],
    });
    expect(controls.ask).toEqual({
      disableOpen: true,
      reasonTags: ["quality_gate:sell:5s_markout_below_0bps"],
    });
  });
});
