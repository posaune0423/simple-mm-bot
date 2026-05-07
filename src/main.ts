import { DIContainer } from "./application/di.ts";
import { ConfigLoader } from "./config.ts";
import type { AppMode } from "./config.ts";
import { env } from "./env.ts";
import { registerShutdownHandlers } from "./application/shutdown.ts";
import type { AppError } from "./utils/errors.ts";
import { formatAppError } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";
import { notifyFatalErrorToSlack } from "./utils/slack-notification.ts";

function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

function marketName(config: Awaited<ReturnType<typeof ConfigLoader.load>>): string {
  return config.venue === "bulk"
    ? config.connections.bulk.market
    : config.connections.hyperliquid.market;
}

const slackContext: {
  mode?: string;
  venue?: string;
  market?: string;
  configPath?: string;
} = { configPath: env.CONFIG_PATH, mode: env.MODE };

try {
  // Startup stays intentionally thin: load config, build the bot, then run it.
  const config = await ConfigLoader.load();
  const mode: AppMode = env.MODE ?? config.mode;
  config.mode = mode;
  slackContext.mode = config.mode;
  slackContext.venue = config.venue;
  slackContext.market = marketName(config);
  logger.info(`starting mode=${config.mode} venue=${config.venue} market=${marketName(config)}`);

  const bot = await new DIContainer(config).buildBot();
  registerShutdownHandlers(
    bot,
    process as unknown as Parameters<typeof registerShutdownHandlers>[1],
  );

  await bot.start();
} catch (error) {
  await notifyFatalErrorToSlack(error, slackContext);
  if (isAppError(error)) {
    logger.error(formatAppError(error));
  } else if (error instanceof Error) {
    logger.error(error.message);
  } else {
    logger.error(String(error));
  }
  process.exitCode = 1;
}
