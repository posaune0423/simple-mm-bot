/**
 * Compare Binance spot OHLCV vs Bulk Trade OHLCV: aligned charts, normalized overlay,
 * and cross-correlation of log-returns over lag τ.
 *
 * Usage:
 *   BINANCE_API_KEY=... BINANCE_API_SECRET=... bun run scripts/analyzeLeadLagCharts.ts -- \\
 *     --from 2026-05-10T00:00:00.000Z --to 2026-05-11T00:00:00.000Z \\
 *     --interval 1m --output data/lead-lag
 *
 * Flags: --config, --binance-symbol (default BTCUSDT), --bulk-symbol (default from YAML),
 * --max-lag, --skip-binance-credential-check true (skip signed /api/v3/account; klines still use API key header).
 */
import { BulkClient } from "bulk-ts-sdk";

import { ConfigLoader } from "../src/config.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { logger } from "../src/utils/logger.ts";
import { fetchBinanceKlines, verifyBinanceCredentials } from "./lib/binanceKlines.ts";
import { fetchBulkKlinesRange } from "./lib/bulkKlinesRange.ts";
import { alignByTimestamp, bestLag, crossCorrSeries, logReturns } from "./lib/leadLagMath.ts";
import {
  svgLagCorrelationBar,
  svgLineChartTimeSeries,
  svgOverlayNormalized,
} from "./lib/leadLagSvg.ts";
import { DEFAULT_BULK_BETA_CONFIG_PATH } from "./lib/paths.ts";

const DEFAULT_OUT = "data/lead-lag";

export function binanceCredentials(options: {
  skipCredentialCheck: boolean;
  env?: Record<string, string | undefined>;
}): { apiKey: string; apiSecret?: string } {
  const env = options.env ?? Bun.env;
  const apiKey = env.BINANCE_API_KEY?.trim();
  if (apiKey === undefined || apiKey === "") {
    throw new Error("Missing required environment variable BINANCE_API_KEY");
  }
  if (options.skipCredentialCheck) {
    return { apiKey };
  }
  const apiSecret = env.BINANCE_API_SECRET?.trim();
  if (apiSecret === undefined || apiSecret === "") {
    throw new Error("Missing required environment variable BINANCE_API_SECRET");
  }
  return { apiKey, apiSecret };
}

async function writeText(path: string, content: string): Promise<void> {
  await Bun.write(path, content);
}

function parseIso(name: string, value: string | undefined): number {
  if (value === undefined || value === "") {
    throw new Error(`Missing --${name} (ISO 8601 timestamp)`);
  }
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new Error(`Invalid --${name}: ${value}`);
  }
  return ms;
}

interface CliOptions {
  configPath: string;
  fromMs: number;
  toMs: number;
  interval: string;
  binanceSymbol: string;
  bulkSymbol: string;
  outputDir: string;
  maxLag: number;
  skipBinanceCredentialCheck: boolean;
}

function parseCli(argv: string[]): CliOptions {
  const flags = parseFlagOptions(argv);
  const configPath = flags.config ?? DEFAULT_BULK_BETA_CONFIG_PATH;
  const fromMs = parseIso("from", flags.from);
  const toMs = parseIso("to", flags.to);
  if (toMs <= fromMs) {
    throw new Error("--to must be after --from");
  }
  const interval = flags.interval ?? "1m";
  const binanceSymbol = (flags["binance-symbol"] ?? "BTCUSDT").toUpperCase();
  const bulkSymbol = flags["bulk-symbol"] ?? "";
  const outputDir = flags.output ?? flags["output-dir"] ?? DEFAULT_OUT;
  const maxLag = flags["max-lag"] ? Number(flags["max-lag"]) : 30;
  if (!Number.isInteger(maxLag) || maxLag < 1) {
    throw new Error("--max-lag must be a positive integer");
  }
  const skipBinanceCredentialCheck = flags["skip-binance-credential-check"] === "true";
  return {
    configPath,
    fromMs,
    toMs,
    interval,
    binanceSymbol,
    bulkSymbol,
    outputDir,
    maxLag,
    skipBinanceCredentialCheck,
  };
}

async function main(argv: string[]): Promise<void> {
  const opts = parseCli(argv);
  const { apiKey, apiSecret } = binanceCredentials({
    skipCredentialCheck: opts.skipBinanceCredentialCheck,
  });
  if (!opts.skipBinanceCredentialCheck) {
    if (apiSecret === undefined) {
      throw new Error("Missing required environment variable BINANCE_API_SECRET");
    }
    await verifyBinanceCredentials(apiKey, apiSecret);
  } else {
    logger.warn(
      "lead_lag.skip_binance_credential_check=true (signed /api/v3/account was not called)",
    );
  }
  const config = await ConfigLoader.load({ configPath: opts.configPath });
  if (config.venue !== "bulk") {
    throw new Error(`Config must be venue=bulk for Bulk klines: ${opts.configPath}`);
  }
  const bulkMarket = opts.bulkSymbol.length > 0 ? opts.bulkSymbol : config.connections.bulk.market;
  const { bulk } = config.connections;

  logger.info(
    `lead_lag.start binance=${opts.binanceSymbol} bulk=${bulkMarket} interval=${opts.interval} from=${new Date(opts.fromMs).toISOString()} to=${new Date(opts.toMs).toISOString()} out=${opts.outputDir}`,
  );

  const bulkClient = new BulkClient({
    httpUrl: bulk.httpUrl,
    wsUrl: bulk.wsUrl,
    privateKey: bulk.privateKey,
    timeoutMs: bulk.timeoutMs,
  });

  const [binanceBars, bulkBars] = await Promise.all([
    fetchBinanceKlines({
      symbol: opts.binanceSymbol,
      interval: opts.interval,
      startTime: opts.fromMs,
      endTime: opts.toMs,
      apiKey,
    }),
    fetchBulkKlinesRange({
      client: bulkClient,
      symbol: bulkMarket,
      interval: opts.interval,
      startTime: opts.fromMs,
      endTime: opts.toMs,
    }),
  ]);

  logger.info(`lead_lag.fetched binanceBars=${binanceBars.length} bulkBars=${bulkBars.length}`);

  const { left: bnx, right: blk, ts } = alignByTimestamp(binanceBars, bulkBars);
  if (ts.length < 10) {
    throw new Error(
      `Too few aligned candles (${ts.length}). Check symbols, interval, and time range overlap.`,
    );
  }

  const closesBnx = bnx.map((b) => b.close);
  const closesBlk = blk.map((b) => b.close);
  const rBnx = logReturns(closesBnx);
  const rBlk = logReturns(closesBlk);

  const lagSeries = crossCorrSeries(rBnx, rBlk, opts.maxLag);
  const peak = bestLag(lagSeries);

  const summary = {
    generatedAt: new Date().toISOString(),
    interval: opts.interval,
    range: { from: opts.fromMs, to: opts.toMs },
    binance: { symbol: opts.binanceSymbol, bars: binanceBars.length },
    bulk: { symbol: bulkMarket, bars: bulkBars.length },
    alignedBars: ts.length,
    crossCorrelation: {
      maxLag: opts.maxLag,
      interpretation:
        "lag τ > 0 compares Binance log-return at t with Bulk log-return at t+τ (positive peak ⇒ Binance tends to move before Bulk at this bar resolution).",
      peak: peak ?? null,
      series: lagSeries.map((s) => ({ lag: s.lag, correlation: s.correlation })),
    },
    credentials: {
      binanceApiKeyPresent: true,
      binanceApiSecretPresent: apiSecret !== undefined,
    },
  };

  await writeText(`${opts.outputDir}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);

  const svgBinance = svgLineChartTimeSeries(bnx, (b) => b.close, {
    title: `Binance ${opts.binanceSymbol} close (${opts.interval})`,
    stroke: "#2563eb",
    yLabel: "Close",
  });
  const svgBulk = svgLineChartTimeSeries(blk, (b) => b.close, {
    title: `Bulk ${bulkMarket} close (${opts.interval})`,
    stroke: "#ea580c",
    yLabel: "Close",
  });
  const svgOverlay = svgOverlayNormalized(
    `Binance ${opts.binanceSymbol}`,
    bnx,
    `Bulk ${bulkMarket}`,
    blk,
    "Normalized close (aligned candles)",
  );
  const svgCorr = svgLagCorrelationBar(lagSeries, "Cross-correlation: Binance vs Bulk log-returns");

  await writeText(`${opts.outputDir}/binance-close.svg`, svgBinance);
  await writeText(`${opts.outputDir}/bulk-close.svg`, svgBulk);
  await writeText(`${opts.outputDir}/overlay-normalized.svg`, svgOverlay);
  await writeText(`${opts.outputDir}/cross-correlation.svg`, svgCorr);

  logger.info(
    `lead_lag.done output=${opts.outputDir} aligned=${ts.length} peakLag=${peak?.lag ?? "n/a"} peakCorr=${peak?.correlation ?? "n/a"}`,
  );
}

if (import.meta.main) {
  void main(Bun.argv.slice(2)).catch((error) => {
    logger.error(String(error));
    process.exitCode = 1;
  });
}
