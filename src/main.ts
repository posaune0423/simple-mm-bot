import { DIContainer } from "./application/di.ts";
import { ConfigLoader } from "./config.ts";
import type { AppMode } from "./config.ts";
import { env } from "./env.ts";
import { formatUnknownError } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";
import { notifyFatalErrorToSlack } from "./utils/slackNotification.ts";

const shutdownSignals = ["SIGINT", "SIGTERM"] as const;

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

  for (const signal of shutdownSignals) {
    process.once(signal, () => {
      if (shutdownController.signal.aborted) {
        return;
      }
      logger.info(`[util] Main | SIGNAL_RECEIVED | signal=${signal}`);
      shutdownController.abort(`signal:${signal}`);
      process.exitCode = 0;
    });
  }

  await bot.start({ signal: shutdownController.signal });
} catch (error) {
  await notifyFatalErrorToSlack(error);
  logger.error(`[util] Main | FATAL | ${formatUnknownError(error)}`);
  process.exitCode = 1;
}
