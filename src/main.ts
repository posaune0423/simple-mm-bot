import { DIContainer } from "./application/di.ts";
import { ConfigLoader } from "./config.ts";
import type { AppMode } from "./config.ts";
import { env } from "./env.ts";
import { registerShutdownHandlers } from "./application/shutdown.ts";
import { formatUnknownError } from "./utils/errors.ts";
import { logger } from "./utils/logger.ts";
import { notifyFatalErrorToSlack } from "./utils/slackNotification.ts";

try {
  // Startup stays intentionally thin: load config, build the bot, then run it.
  const config = await ConfigLoader.load();
  const mode: AppMode = env.MODE ?? config.mode;
  config.mode = mode;

  logger.info(`starting mode=${config.mode} venue=${config.venue} market=${config.market}`);

  const bot = await new DIContainer(config).buildBot();

  registerShutdownHandlers(
    bot,
    process as unknown as Parameters<typeof registerShutdownHandlers>[1],
  );

  await bot.start();
} catch (error) {
  await notifyFatalErrorToSlack(error);
  logger.error(formatUnknownError(error));
  process.exitCode = 1;
}
