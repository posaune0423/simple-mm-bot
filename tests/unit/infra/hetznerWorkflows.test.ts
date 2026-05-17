import { existsSync, readFileSync } from "node:fs";

import { describe, expect, test } from "bun:test";
import { parse as parseYaml } from "yaml";

const requiredOpsActions = [
  "pull-images",
  "start-infra",
  "start-workers",
  "restart-worker",
  "start-bot",
  "stop-bot",
  "restart-bot",
  "start-canary",
  "stop-canary",
  "restart-canary",
  "logs-bot",
  "logs-worker",
];

describe("Hetzner GitHub Actions workflows", () => {
  test("defines the exact manual operations and requires explicit confirmation", () => {
    const workflow = readWorkflow(".github/workflows/ops-hetzner.yml");
    const raw = readFileSync(".github/workflows/ops-hetzner.yml", "utf8");
    const inputs = workflow.on.workflow_dispatch.inputs;
    const action = required(inputs.action, "action input");
    const confirm = required(inputs.confirm, "confirm input");

    expect(action.type).toBe("choice");
    expect(action.required).toBe(true);
    expect(action.options).toEqual(requiredOpsActions);
    expect(confirm.type).toBe("string");
    expect(confirm.required).toBe(true);
    expect(raw).toContain("${{ inputs.confirm }}");
    expect(raw).toContain("!= 'yes'");
    expect(raw).toContain("/opt/mmbot/scripts/dispatch-action.sh");
    expect(raw).toContain("VPS_SSH_KNOWN_HOSTS");
  });

  test("publishes Docker images to GHCR with package write permission", () => {
    const workflow = readWorkflow(".github/workflows/publish-image.yml");
    const raw = readFileSync(".github/workflows/publish-image.yml", "utf8");

    expect(workflow.permissions.contents).toBe("read");
    expect(workflow.permissions.packages).toBe("write");
    expect(raw).toContain("ghcr.io");
    expect(raw).toContain("${{ github.repository }}");
    expect(raw).toContain("docker/build-push-action");
  });

  test("syncs only infra files and protects VPS-local state", () => {
    const raw = readFileSync(".github/workflows/sync-hetzner-infra.yml", "utf8");

    expect(raw).toContain("infra/hetzner/**");
    expect(raw).toContain("--delete");
    expect(raw).toContain("--exclude=.env");
    expect(raw).toContain("--exclude=data/");
    expect(raw).toContain("--exclude=backups/");
    expect(raw).toContain("--exclude=logs/");
    expect(raw).toContain("chmod +x /opt/mmbot/scripts/*.sh");
    expect(raw).toContain("docker compose");
    expect(raw).toContain("config -q");
    expect(raw).toContain("VPS_SSH_KNOWN_HOSTS");
    expect(raw).not.toContain("ssh-keyscan");
  });

  test("keeps CI on Node 24, Bun, repo checks, tests, lint, and actionlint", () => {
    const raw = readFileSync(".github/workflows/ci.yml", "utf8");

    expect(raw).toContain("node-version: 24");
    expect(raw).toContain("timescale/timescaledb:latest-pg17");
    expect(raw).toContain("bun run db:migrate");
    expect(raw).toContain("oven-sh/setup-bun");
    expect(raw).toContain("bun run check");
    expect(raw).toContain("bun run lint");
    expect(raw).toContain("bun run test");
    expect(raw).toContain("actionlint");
    expect(raw).toContain("download-actionlint.bash) 1.7.12");
  });
});

describe("Hetzner infra files", () => {
  test("declares the expected compose, config, script, and local access files", () => {
    const requiredFiles = [
      "infra/hetzner/compose.infra.yml",
      "infra/hetzner/compose.workers.yml",
      "infra/hetzner/compose.bots.yml",
      "infra/hetzner/configs/bot.main.yml",
      "infra/hetzner/configs/bot.canary.yml",
      "infra/hetzner/configs/worker.bulk.btc.yml",
      "infra/hetzner/scripts/dispatch-action.sh",
      "infra/hetzner/scripts/restart-bot.sh",
      "infra/hetzner/scripts/start-canary.sh",
      "infra/hetzner/scripts/stop-canary.sh",
      "infra/hetzner/scripts/backup-db.sh",
      "infra/hetzner/local/open-db-tunnel.sh",
      "infra/hetzner/local/agent-db.env.example",
      "infra/hetzner/README.md",
    ];

    for (const file of requiredFiles) {
      expect(existsSync(file), file).toBe(true);
    }
  });
});

function readWorkflow(path: string): {
  on: {
    workflow_dispatch: {
      inputs: Record<
        string,
        {
          type?: string;
          required?: boolean;
          options?: string[];
        }
      >;
    };
  };
  permissions: Record<string, string>;
} {
  return parseYaml(readFileSync(path, "utf8")) as {
    on: {
      workflow_dispatch: {
        inputs: Record<
          string,
          {
            type?: string;
            required?: boolean;
            options?: string[];
          }
        >;
      };
    };
    permissions: Record<string, string>;
  };
}

function required<T>(value: T | undefined, name: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${name}`);
  }
  return value;
}
