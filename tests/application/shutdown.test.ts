import { describe, expect, test } from "bun:test";

import { registerShutdownHandlers } from "../../src/application/shutdown.ts";

describe("registerShutdownHandlers", () => {
  test("stops the bot on SIGINT and SIGTERM so cleanup can close positions", () => {
    const handlers = new Map<string, (signal: string) => void>();
    const calls: string[] = [];
    const processLike = {
      exitCode: undefined as number | undefined,
      on(signal: string, handler: (signal: string) => void) {
        handlers.set(signal, handler);
        return this;
      },
    };

    registerShutdownHandlers(
      {
        stop() {
          calls.push("stop");
        },
      },
      processLike as unknown as Pick<typeof process, "on"> & { exitCode?: number },
    );

    expect([...handlers.keys()].sort()).toEqual(["SIGINT", "SIGTERM"]);

    handlers.get("SIGTERM")?.("SIGTERM");
    expect(calls).toEqual(["stop"]);
    expect(processLike.exitCode).toBe(0);
  });
});
