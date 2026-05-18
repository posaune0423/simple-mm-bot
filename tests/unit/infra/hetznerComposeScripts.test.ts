import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

describe("Hetzner compose files and scripts", () => {
  test("keeps TimescaleDB private and persistent", () => {
    const compose = readCompose("infra/hetzner/compose.infra.yml");
    const service = required(compose.services.timescaledb, "timescaledb service");

    expect(service.image).toBe("timescale/timescaledb:latest-pg17");
    expect(service.restart).toBe("unless-stopped");
    expect(service.ports).toContain("127.0.0.1:5432:5432");
    expect(service.volumes).toContain("./data/timescaledb:/var/lib/postgresql/data");
    expect(service.healthcheck).toBeDefined();
  });

  test("keeps worker independent from bot lifecycle", () => {
    const compose = readCompose("infra/hetzner/compose.workers.yml");
    const worker = required(
      compose.services["market-data-recorder-bulk"],
      "market-data-recorder-bulk service",
    );
    const externalWorker = required(
      compose.services["external-market-recorder"],
      "external-market-recorder service",
    );

    expect(worker.platform).toBe("linux/amd64");
    expect(worker.restart).toBe("unless-stopped");
    expect(worker.environment.RECORDER_CONFIG_PATH).toBe("/app/configs/worker.bulk.btc.yml");
    expect(worker.command).toEqual(["bun", "run", "record:market-data"]);
    expect(externalWorker.platform).toBe("linux/amd64");
    expect(externalWorker.restart).toBe("unless-stopped");
    expect(externalWorker.environment.EXTERNAL_MARKET_RECORDER_CONFIG_PATH).toBe(
      "/app/configs/worker.external.btc.yml",
    );
    expect(externalWorker.command).toEqual(["bun", "run", "record:external-market"]);
  });

  test("runs main and canary as separate containers with separate configs", () => {
    const compose = readCompose("infra/hetzner/compose.bots.yml");
    const main = required(compose.services["mmbot-main"], "mmbot-main service");
    const canary = required(compose.services["mmbot-canary"], "mmbot-canary service");

    expect(main.restart).toBe("unless-stopped");
    expect(main.environment.CONFIG_PATH).toBe("/app/configs/bot.main.yml");
    expect(canary.restart).toBe("no");
    expect(canary.environment.CONFIG_PATH).toBe("/app/configs/bot.canary.yml");
    expect(Object.keys(compose.services)).toEqual(["mmbot-main", "mmbot-canary"]);
  });

  test("does not allow production scripts to call docker compose down", () => {
    const scripts = readdirSync("infra/hetzner/scripts").filter((file) => file.endsWith(".sh"));
    for (const script of scripts) {
      const source = readFileSync(join("infra/hetzner/scripts", script), "utf8");
      expect(source, script).not.toMatch(/\bdocker\s+compose\b.*\bdown\b/);
    }
  });

  test("restarts main bot without touching TimescaleDB or the worker", () => {
    const source = readFileSync("infra/hetzner/scripts/restart-bot.sh", "utf8");

    expect(source).toContain("--no-deps");
    expect(source).toContain("--force-recreate");
    expect(source).toContain("mmbot-main");
    expect(source).not.toContain("timescaledb");
    expect(source).not.toContain("market-data-recorder-bulk");
  });

  test("hardens database backups against loose permissions and partial files", () => {
    const source = readFileSync("infra/hetzner/scripts/backup-db.sh", "utf8");

    expect(source).toContain("umask 077");
    expect(source).toContain("chmod 700");
    expect(source).toContain("chmod 600");
    expect(source).toContain("tmp_backup_path");
    expect(source).toContain("trap 'rm -f \"$tmp_backup_path\"' EXIT");
    expect(source).toContain('mv "$tmp_backup_path" "$backup_path"');
    expect(source).toContain('[[ "$retention_days" =~ ^[0-9]+$ ]]');
  });
});

function readCompose(path: string): {
  services: Record<
    string,
    {
      image?: string;
      platform?: string;
      restart?: string;
      ports?: string[];
      volumes?: string[];
      healthcheck?: unknown;
      command?: string[];
      environment: Record<string, string>;
    }
  >;
} {
  return parseYaml(readFileSync(path, "utf8")) as {
    services: Record<
      string,
      {
        image?: string;
        platform?: string;
        restart?: string;
        ports?: string[];
        volumes?: string[];
        healthcheck?: unknown;
        command?: string[];
        environment: Record<string, string>;
      }
    >;
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
