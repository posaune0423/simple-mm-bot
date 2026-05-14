type ShutdownSignal = "SIGINT" | "SIGTERM";

type SignalTarget = {
  exitCode?: number | string | null;
  on(signal: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(signal: string, listener: (...args: unknown[]) => void): unknown;
};

interface InstallShutdownSignalHandlersParams {
  controller: AbortController;
  target: SignalTarget;
  signals?: readonly ShutdownSignal[];
  logInfo: (message: string) => void;
}

const defaultShutdownSignals = ["SIGINT", "SIGTERM"] as const;

function shutdownReason(signal: ShutdownSignal): string {
  return `signal:${signal}`;
}

function signalReason(signal: AbortSignal): string {
  const { reason } = signal;
  if (typeof reason === "string") {
    return reason;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  return reason === undefined ? "aborted" : String(reason);
}

export function installShutdownSignalHandlers({
  controller,
  target,
  signals = defaultShutdownSignals,
  logInfo,
}: InstallShutdownSignalHandlersParams): () => void {
  const handlers = signals.map((signal) => {
    const handler = () => {
      if (controller.signal.aborted) {
        logInfo(
          `[util] Main | SHUTDOWN_ALREADY_REQUESTED | signal=${signal} reason=${signalReason(controller.signal)}`,
        );
        target.exitCode = 0;
        return;
      }

      logInfo(`[util] Main | SIGNAL_RECEIVED | signal=${signal}`);
      controller.abort(shutdownReason(signal));
      target.exitCode = 0;
    };
    target.on(signal, handler);
    return [signal, handler] as const;
  });

  return () => {
    for (const [signal, handler] of handlers) {
      target.removeListener(signal, handler);
    }
  };
}
