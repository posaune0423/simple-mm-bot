import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "bun:test";

const tempRoots: string[] = [];

describe("Hetzner dispatch-action.sh", () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("runs only the script mapped to the requested operation", async () => {
    const root = createFakeRuntime();
    const result = await runDispatch(root, { ACTION: "restart-bot", CONFIRM: "yes" });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, "called.log"), "utf8")).toBe("restart-bot.sh\n");
  });

  test("rejects missing yes confirmation before running any operation", async () => {
    const root = createFakeRuntime();
    const result = await runDispatch(root, { ACTION: "restart-bot", CONFIRM: "no" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("confirm=yes");
    expect(readFileSync(join(root, "called.log"), "utf8")).toBe("");
  });

  test("rejects unknown operations", async () => {
    const root = createFakeRuntime();
    const result = await runDispatch(root, { ACTION: "dangerous-down", CONFIRM: "yes" });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("Unknown ACTION");
    expect(readFileSync(join(root, "called.log"), "utf8")).toBe("");
  });

  test("uses finite logs by default for GitHub Actions output", async () => {
    const root = createFakeRuntime();
    const result = await runDispatch(root, { ACTION: "logs-bot", CONFIRM: "yes" });

    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(root, "called.log"), "utf8")).toBe("logs.sh bot\n");
  });
});

function createFakeRuntime(): string {
  const root = join(tmpdir(), `mmbot-dispatch-${crypto.randomUUID()}`);
  const scripts = join(root, "scripts");
  mkdirSync(scripts, { recursive: true });
  tempRoots.push(root);

  cpSync("infra/hetzner/scripts/dispatch-action.sh", join(scripts, "dispatch-action.sh"));
  writeFileSync(join(root, "called.log"), "");

  const fakeScripts = [
    "pull-images.sh",
    "start-infra.sh",
    "start-workers.sh",
    "restart-worker.sh",
    "start-bot.sh",
    "stop-bot.sh",
    "restart-bot.sh",
    "start-canary.sh",
    "stop-canary.sh",
    "restart-canary.sh",
  ];
  for (const script of fakeScripts) {
    writeFileSync(
      join(scripts, script),
      `#!/usr/bin/env bash\necho "${script}" >> "${join(root, "called.log")}"\n`,
    );
  }
  writeFileSync(
    join(scripts, "logs.sh"),
    `#!/usr/bin/env bash\necho "logs.sh $1" >> "${join(root, "called.log")}"\n`,
  );

  return root;
}

async function runDispatch(
  root: string,
  env: Record<"ACTION" | "CONFIRM", string>,
): Promise<{ exitCode: number; stderr: string }> {
  const proc = Bun.spawn({
    cmd: ["bash", "scripts/dispatch-action.sh"],
    cwd: root,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { exitCode, stderr };
}
