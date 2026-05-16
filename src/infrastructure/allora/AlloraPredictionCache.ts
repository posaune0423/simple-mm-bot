import {
  AlloraAPIClient,
  ChainSlug,
  PriceInferenceTimeframe,
  PriceInferenceToken,
} from "@alloralabs/allora-sdk";

import type {
  AlphaDriftProvider,
  AlphaDriftSnapshot,
} from "../../domain/ports/IAlphaDriftProvider.ts";
import { stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

type AlloraPriceInferenceClient = Readonly<{
  getPriceInference(
    asset: PriceInferenceToken,
    timeframe: PriceInferenceTimeframe,
  ): Promise<{
    inference_data: {
      network_inference: string;
      confidence_interval_values?: readonly string[];
      timestamp: number;
    };
  }>;
}>;

export type AlloraPredictionCacheOptions = Readonly<{
  client: AlloraPriceInferenceClient;
  fairPrice: () => number | Promise<number>;
  asset: "BTC" | "ETH";
  timeframe: "5m" | "8h";
  pollIntervalMs: number;
  staleMs: number;
  calibrationWeight: number;
  minAlphaDriftBps: number;
  maxAlphaDriftBps: number;
  maxRawDriftBps: number;
  maxCiWidthBps: number;
  nowMs?: () => number;
}>;

type AlloraPredictionCacheConfig = Omit<AlloraPredictionCacheOptions, "client" | "fairPrice">;

export class AlloraPredictionCache implements AlphaDriftProvider {
  private timer: ReturnType<typeof setInterval> | undefined;
  private snapshot: AlphaDriftSnapshot = { alphaDriftBps: 0, stale: true, reason: "not_ready" };
  private refreshing = false;
  private readonly nowMs: () => number;

  constructor(private readonly options: AlloraPredictionCacheOptions) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  start(): void {
    if (this.timer !== undefined) {
      return;
    }
    void this.refreshOnce();
    this.timer = setInterval(() => {
      void this.refreshOnce();
    }, this.options.pollIntervalMs);
  }

  stop(): void {
    if (this.timer === undefined) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  async refreshOnce(): Promise<void> {
    if (this.refreshing) {
      return;
    }
    this.refreshing = true;
    try {
      const inference = await this.options.client.getPriceInference(
        tokenFor(this.options.asset),
        timeframeFor(this.options.timeframe),
      );
      const fairPrice = await this.options.fairPrice();
      this.snapshot = computeSnapshot({
        fairPrice,
        networkInference: Number(inference.inference_data.network_inference),
        confidenceIntervalValues: inference.inference_data.confidence_interval_values ?? [],
        predictionTimestampMs: normalizePredictionTimestampMs(inference.inference_data.timestamp),
        observedAtMs: this.nowMs(),
        config: this.options,
      });
    } catch (error) {
      logger.warn(
        `[infrastructure] AlloraPredictionCache | REFRESH_FAILED | error=${stringifyError(error)}`,
      );
      this.snapshot = {
        alphaDriftBps: 0,
        stale: true,
        reason: "refresh_failed",
        updatedAtMs: this.nowMs(),
      };
    } finally {
      this.refreshing = false;
    }
  }

  current(nowMs: number): AlphaDriftSnapshot {
    if (
      this.snapshot.updatedAtMs === undefined ||
      nowMs - this.snapshot.updatedAtMs > this.options.staleMs
    ) {
      return {
        ...this.snapshot,
        alphaDriftBps: 0,
        stale: true,
        reason: "stale",
      };
    }
    return this.snapshot;
  }
}

export function createAlloraPredictionCache(input: {
  apiKey?: string;
  chainSlug: "testnet" | "mainnet";
  fairPrice: () => number | Promise<number>;
  config: AlloraPredictionCacheConfig;
}): AlloraPredictionCache {
  return new AlloraPredictionCache({
    client: new AlloraAPIClient({
      chainSlug: chainSlugFor(input.chainSlug),
      apiKey: input.apiKey,
    }),
    fairPrice: input.fairPrice,
    ...input.config,
  });
}

function computeSnapshot(input: {
  fairPrice: number;
  networkInference: number;
  confidenceIntervalValues: readonly string[];
  predictionTimestampMs: number;
  observedAtMs: number;
  config: AlloraPredictionCacheConfig;
}): AlphaDriftSnapshot {
  if (!Number.isFinite(input.fairPrice) || input.fairPrice <= 0) {
    return failClosed("invalid_fair_price", input.observedAtMs);
  }
  if (!Number.isFinite(input.networkInference) || input.networkInference <= 0) {
    return failClosed("invalid_prediction", input.observedAtMs);
  }

  const rawDriftBps = ((input.networkInference - input.fairPrice) / input.fairPrice) * 10_000;
  if (Math.abs(rawDriftBps) > input.config.maxRawDriftBps) {
    return failClosed("raw_outlier", input.observedAtMs);
  }
  const ciWidthBps = confidenceIntervalWidthBps(input.confidenceIntervalValues, input.fairPrice);
  if (ciWidthBps !== undefined && ciWidthBps > input.config.maxCiWidthBps) {
    return failClosed("ci_too_wide", input.observedAtMs);
  }

  const weighted = rawDriftBps * input.config.calibrationWeight;
  const absWeighted = Math.abs(weighted);
  const alphaDriftBps =
    absWeighted < input.config.minAlphaDriftBps
      ? 0
      : Math.sign(weighted) * Math.min(absWeighted, input.config.maxAlphaDriftBps);
  return {
    alphaDriftBps,
    updatedAtMs: input.predictionTimestampMs,
    stale: false,
    reason: "ok",
  };
}

function confidenceIntervalWidthBps(
  values: readonly string[],
  fairPrice: number,
): number | undefined {
  const numeric = values.map((value) => Number(value)).filter((value) => Number.isFinite(value));
  if (numeric.length < 2) {
    return undefined;
  }
  return ((Math.max(...numeric) - Math.min(...numeric)) / fairPrice) * 10_000;
}

function failClosed(reason: string, updatedAtMs: number): AlphaDriftSnapshot {
  return { alphaDriftBps: 0, updatedAtMs, stale: false, reason };
}

function normalizePredictionTimestampMs(timestamp: number): number {
  return timestamp < 10_000_000_000 ? timestamp * 1000 : timestamp;
}

function tokenFor(asset: "BTC" | "ETH"): PriceInferenceToken {
  return asset === "BTC" ? PriceInferenceToken.BTC : PriceInferenceToken.ETH;
}

function timeframeFor(timeframe: "5m" | "8h"): PriceInferenceTimeframe {
  return timeframe === "5m"
    ? PriceInferenceTimeframe.FIVE_MIN
    : PriceInferenceTimeframe.EIGHT_HOURS;
}

function chainSlugFor(chainSlug: "testnet" | "mainnet"): ChainSlug {
  return chainSlug === "testnet" ? ChainSlug.TESTNET : ChainSlug.MAINNET;
}
