import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

describe("local Docker compose wrapper", () => {
  test("keeps the local development wrapper aligned with Hetzner service names", () => {
    const compose = parseYaml(readFileSync("docker-compose.yml", "utf8")) as {
      services: Record<
        string,
        {
          extends?: unknown;
          image?: string;
          restart?: string;
          ports?: string[];
          build?: { context?: string; dockerfile?: string };
          profiles?: string[];
          environment?: Record<string, string>;
          volumes?: string[];
        }
      >;
    };

    expect(Object.keys(compose.services).sort()).toEqual([
      "external-market-recorder",
      "market-data-recorder-bulk",
      "mmbot-canary",
      "mmbot-main",
      "timescaledb",
    ]);
    const timescaledb = required(compose.services.timescaledb, "timescaledb service");
    const worker = required(
      compose.services["market-data-recorder-bulk"],
      "market-data-recorder-bulk service",
    );
    const externalWorker = required(
      compose.services["external-market-recorder"],
      "external-market-recorder service",
    );
    const main = required(compose.services["mmbot-main"], "mmbot-main service");
    const canary = required(compose.services["mmbot-canary"], "mmbot-canary service");

    for (const service of [timescaledb, worker, externalWorker, main, canary]) {
      expect(service.extends).toBeUndefined();
    }

    expect(timescaledb.image).toBe("timescale/timescaledb:latest-pg17");
    expect(timescaledb.restart).toBe("unless-stopped");
    expect(timescaledb.ports).toContain("127.0.0.1:5432:5432");

    for (const service of [worker, externalWorker, main, canary]) {
      expect(service.build).toEqual({
        context: ".",
        dockerfile: "Dockerfile",
      });
      expect(service.volumes).toContain("./infra/hetzner/configs:/app/configs:ro");
    }

    expect(worker.environment?.RECORDER_CONFIG_PATH).toBe("/app/configs/worker.bulk.btc.yml");
    expect(worker.environment?.SLACK_WEBHOOK_URL).toBe("${SLACK_WEBHOOK_URL:-}");
    expect(externalWorker.environment?.EXTERNAL_MARKET_RECORDER_CONFIG_PATH).toBe(
      "/app/configs/worker.external.btc.yml",
    );
    expect(externalWorker.environment?.SLACK_WEBHOOK_URL).toBe("${SLACK_WEBHOOK_URL:-}");
    expect(main.profiles).toContain("bot");
    expect(canary.profiles).toContain("canary");
  });

  test("resolves local compose without production-only required secrets", async () => {
    const emptyEnvPath = join(tmpdir(), `mmbot-empty-env-${crypto.randomUUID()}`);
    const blankSecretsPath = join(tmpdir(), `mmbot-blank-secrets-env-${crypto.randomUUID()}`);
    writeFileSync(emptyEnvPath, "");
    writeFileSync(
      blankSecretsPath,
      "POSTGRES_PASSWORD=mm\nBULK_PRIVATE_KEY=\nBULK_CANARY_PRIVATE_KEY=\n",
    );

    try {
      expect(await composeConfig(emptyEnvPath)).toBe(0);
      expect(await composeConfig(blankSecretsPath)).toBe(0);
      expect(await composeConfig(emptyEnvPath, "--profile", "bot")).toBe(0);
      expect(await composeConfig(emptyEnvPath, "--profile", "worker")).toBe(0);
      expect(await composeConfig(emptyEnvPath, "--profile", "canary")).toBe(0);
    } finally {
      rmSync(emptyEnvPath, { force: true });
      rmSync(blankSecretsPath, { force: true });
    }
  });

  test("keeps the Dockerfile default command aligned with compose bot commands", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");

    expect(dockerfile).toContain('CMD ["bun", "run", "src/main.ts"]');
    expect(dockerfile).not.toContain('"run"]');
  });

  test("documents concise infra operations under docs/infra", () => {
    expect(existsSync("docs/infra/README.md")).toBe(true);
    expect(existsSync("docs/infra/hetzner.md")).toBe(true);
    expect(existsSync("docs/infra/docker.md")).toBe(true);
  });
});

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}

async function composeConfig(envPath: string, ...args: string[]): Promise<number> {
  const proc = Bun.spawn({
    cmd: ["docker", "compose", "--env-file", envPath, ...args, "config", "-q"],
    stdout: "pipe",
    stderr: "pipe",
  });
  await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  return proc.exited;
}
