import { logger } from "../utils/logger.ts";

const shutdownSignals = ["SIGINT", "SIGTERM"] as const;

interface StoppableBot {
  stop(): void;
}

type SignalProcess = Pick<typeof process, "on"> & { exitCode?: number };

export function registerShutdownHandlers(bot: StoppableBot, processLike: SignalProcess): void {
  let stopRequested = false;

  for (const signal of shutdownSignals) {
    processLike.on(signal, () => {
      if (stopRequested) {
        return;
      }
      stopRequested = true;
      logger.info(`[util] Shutdown | SIGNAL_RECEIVED | signal=${signal}`);
      bot.stop();
      processLike.exitCode = 0;
    });
  }
}
