import { join } from "node:path";
import { Database } from "bun:sqlite";
import { ResultAsync } from "neverthrow";
import { DIContainer } from "../src/application/di.ts";
import { ConfigLoader } from "../src/config.ts";
import type { ReportMetrics } from "../src/domain/entities/Report.ts";
import type { AppError } from "../src/utils/errors.ts";
import { createAppError, formatAppError } from "../src/utils/errors.ts";
import { ensureDirectory, writeJsonFile, writeTextFile } from "../src/utils/fs.ts";
import { parseFlagOptions } from "../src/utils/args.ts";
import { logger } from "../src/utils/logger.ts";

interface LiveOptimizationLoopSummary {
  verdict: "profitable" | "lossy" | "no_trades";
  metrics: ReportMetrics;
  params: {
    durationMin: number;
    maxFills?: number;
    configPath: string;
  };
}

interface FillRow {
  side: string;
  price: number;
  qty: number;
  trade_pnl: number;
  fee: number;
  filled_at: number;
  mark_price_at_fill: number;
  mark_price_5s: number;
}

function buildLiveBot(configPath: string) {
  return ResultAsync.fromPromise(
    ConfigLoader.load({ configPath }).then(async (config) => {
      config.mode = "live";
      return await new DIContainer(config).buildBot();
    }),
    (error) => createAppError("loop.build_failed", "Failed to build live bot runtime", error),
  );
}

function startMonitor(dbPath: string) {
  const db = new Database(dbPath);
  return setInterval(() => {
    try {
      const now = Date.now();
      const tenMinutesAgo = now - 10 * 60 * 1000;
      const recentFills = db
        .query<FillRow, [number]>("SELECT * FROM fills WHERE filled_at > ? ORDER BY filled_at DESC")
        .all(tenMinutesAgo);

      if (recentFills.length === 0) {
        return;
      }

      let totalPnL = 0;
      let totalMarkout5s = 0;
      let markoutCount = 0;
      let adverseSelectionCount = 0;

      for (const fill of recentFills) {
        totalPnL += fill.trade_pnl - fill.fee;
        if (fill.mark_price_5s && fill.mark_price_at_fill) {
          const m =
            fill.side === "buy"
              ? fill.mark_price_5s - fill.mark_price_at_fill
              : fill.mark_price_at_fill - fill.mark_price_5s;
          totalMarkout5s += m;
          markoutCount++;
          if (m < 0) adverseSelectionCount++;
        }
      }

      const avgMarkout = markoutCount > 0 ? totalMarkout5s / markoutCount : 0;
      const adverseRate = markoutCount > 0 ? (adverseSelectionCount / markoutCount) * 100 : 0;
      const latestFillPrice = recentFills[0]?.price ?? 0;
      const avgMarkoutBps =
        markoutCount > 0 && latestFillPrice > 0 ? (avgMarkout / latestFillPrice) * 10000 : 0;

      // Log a compact summary instead of clearing console to avoid wiping bot logs
      logger.info(
        `[MONITOR] Fills(10m): ${recentFills.length} | Net PnL: ${totalPnL.toFixed(4)} | ` +
          `AvgMarkout: ${avgMarkoutBps.toFixed(2)} bps | ` +
          `Adverse: ${adverseRate.toFixed(1)}%`,
      );
    } catch (err) {
      logger.debug(`live_optimization.monitor_failed ${String(err)}`);
    }
  }, 10000); // Check every 10 seconds
}

function runLiveOptimizationLoop(argv: string[]): ResultAsync<string, AppError> {
  const options = parseFlagOptions(argv);
  const configPath = options.config ?? "config/config.bulk.yml";
  const durationMin = Number(options["duration-min"] ?? "5");
  const maxFills = options["max-fills"] ? Number(options["max-fills"]) : undefined;
  const outputDir = options["output-dir"] ?? join("artifacts", "live-runs", `${Date.now()}`);
  const dbPath = Bun.env.DB_PATH ?? "data/mmbot.db";

  logger.info(
    `Starting live optimization loop: duration=${durationMin}min, maxFills=${maxFills ?? "inf"}, config=${configPath}`,
  );

  return ResultAsync.fromPromise(ensureDirectory(outputDir), (error) =>
    createAppError("loop.prepare_failed", "Failed to prepare output directory", error),
  )
    .andThen(() => buildLiveBot(configPath))
    .andThen((bot) => {
      // Setup auto-stop by duration
      const stopTimer = setTimeout(
        () => {
          logger.info(`Duration reached (${durationMin}min). Stopping bot...`);
          bot.stop();
        },
        durationMin * 60 * 1000,
      );

      // Start the integrated monitor
      const monitorInterval = startMonitor(dbPath);

      // Start the bot
      return ResultAsync.fromPromise(bot.start(), (error) => {
        clearTimeout(stopTimer);
        clearInterval(monitorInterval);
        return createAppError("loop.live_failed", "Live execution failed", error);
      }).map((report) => {
        clearTimeout(stopTimer);
        clearInterval(monitorInterval);
        return report;
      });
    })
    .andThen((report) => {
      const { metrics } = report;
      let verdict: LiveOptimizationLoopSummary["verdict"] = "no_trades";
      if (metrics.fillRate > 0 || metrics.tradePnl !== 0) {
        verdict = metrics.netPnl >= 0 ? "profitable" : "lossy";
      }

      const summary: LiveOptimizationLoopSummary = {
        verdict,
        metrics,
        params: {
          durationMin,
          maxFills,
          configPath,
        },
      };

      return ResultAsync.fromPromise(
        Promise.all([
          writeJsonFile(join(outputDir, "summary.json"), summary),
          writeJsonFile(join(outputDir, "report.json"), report),
          writeTextFile(
            join(outputDir, "run.md"),
            [
              "# Live Optimization Run",
              "",
              `- Verdict: ${summary.verdict}`,
              `- Net PnL: ${metrics.netPnl}`,
              `- Markout 5s: ${metrics.markout5s}`,
              `- Fill Rate: ${metrics.fillRate}`,
              `- Adverse Selection Count: ${report.fillAnalysis.adverseSelectionCount}`,
              `- Output dir: ${outputDir}`,
            ].join("\n"),
          ),
        ]),
        (error) =>
          createAppError("loop.write_failed", "Failed to write live optimization artifacts", error),
      ).map(() => outputDir);
    });
}

void runLiveOptimizationLoop(Bun.argv.slice(2)).match(
  (outputDir) => {
    logger.info(`Live optimization loop completed. Results: ${outputDir}`);
  },
  (error) => {
    logger.error(formatAppError(error));
    process.exitCode = 1;
  },
);
