import { DIContainer } from "./application/di.ts";
import { ConfigLoader } from "./config.ts";
import type { AppMode } from "./config.ts";
import { env } from "./env.ts";
import { notifyFatalErrorToSlack } from "./lib/slack/notification.ts";
import { formatUnknownError } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";
import { installShutdownSignalHandlers } from "./utils/shutdownSignals.ts";

try {
  // Startup stays intentionally thin: load config, build the bot, then run it.
  const config = await ConfigLoader.load();
  const mode: AppMode = env.MODE ?? config.mode;
  config.mode = mode;

  logger.info(
    `[util] Main | STARTING | mode=${config.mode} venue=${config.venue} market=${config.market}`,
  );

  const bot = await new DIContainer(config).buildBot();
  const shutdownController = new AbortController();
  const removeShutdownHandlers = installShutdownSignalHandlers({
    controller: shutdownController,
    target: process,
    logInfo: (message) => logger.info(message),
  });

  try {
    await bot.start({ signal: shutdownController.signal });
  } finally {
    removeShutdownHandlers();
  }
} catch (error) {
  await notifyFatalErrorToSlack(error);
  logger.error(`[util] Main | FATAL | ${formatUnknownError(error)}`);
  process.exitCode = 1;
}
