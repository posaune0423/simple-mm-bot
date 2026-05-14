import { EventEmitter } from "node:events";
import { describe, expect, test } from "bun:test";

import { installShutdownSignalHandlers } from "../../../src/utils/shutdownSignals.ts";

class FakeSignalTarget extends EventEmitter {
  exitCode: number | undefined;
}

describe("installShutdownSignalHandlers", () => {
  test("keeps signal handlers installed during cleanup so repeated signals do not force exit", () => {
    const target = new FakeSignalTarget();
    const controller = new AbortController();
    const messages: string[] = [];

    const removeHandlers = installShutdownSignalHandlers({
      controller,
      target,
      logInfo: (message) => messages.push(message),
    });

    target.emit("SIGTERM");
    target.emit("SIGTERM");

    expect(controller.signal.aborted).toBe(true);
    expect(controller.signal.reason).toBe("signal:SIGTERM");
    expect(target.exitCode).toBe(0);
    expect(messages).toEqual([
      "[util] Main | SIGNAL_RECEIVED | signal=SIGTERM",
      "[util] Main | SHUTDOWN_ALREADY_REQUESTED | signal=SIGTERM reason=signal:SIGTERM",
    ]);

    removeHandlers();
    target.emit("SIGINT");
    expect(messages).toHaveLength(2);
  });
});
