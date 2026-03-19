import { DIContainer } from "./application/di.ts";
import { ConfigLoader } from "./config.ts";
import type { AppMode } from "./config.ts";
import { env } from "./env.ts";
import type { AppError } from "./utils/errors.ts";
import { formatAppError } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";

function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

try {
  // Startup stays intentionally thin: load config, build the bot, then run it.
  const config = await ConfigLoader.load();
  const mode: AppMode = env.MODE ?? "live";
  config.mode = mode;

  const bot = await new DIContainer(config).buildBot();

  // SIGINT is treated as a graceful shutdown so open connections can unwind.
  process.on("SIGINT", () => {
    bot.stop();
    process.exitCode = 0;
  });

  // Bot.start() owns the runtime loop and returns the final session report.
  const report = await bot.start();
  logger.info(JSON.stringify(report, null, 2));
} catch (error) {
  if (isAppError(error)) {
    logger.error(formatAppError(error));
  } else if (error instanceof Error) {
    logger.error(error.message);
  } else {
    logger.error(String(error));
  }
  process.exitCode = 1;
}
