import { describe, expect, test } from "bun:test";

import { createAppError } from "../../../src/utils/errors.ts";

function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

interface SlackBodyForTest {
  text?: string;
  icon_emoji?: string;
  attachments?: Array<{
    color?: string;
    fallback?: string;
    text?: string;
  }>;
}

function parseSlackBody(body: RequestInit["body"] | undefined): SlackBodyForTest {
  if (typeof body !== "string") {
    throw new Error("Expected Slack request body to be a string");
  }
  return JSON.parse(body) as SlackBodyForTest;
}

describe("notifyFatalErrorToSlack", () => {
  test("does nothing when SLACK_WEBHOOK_URL is unset", async () => {
    const previousUrl = Bun.env.SLACK_WEBHOOK_URL;
    delete Bun.env.SLACK_WEBHOOK_URL;

    const calls: Array<Parameters<typeof fetch>> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (...args: Parameters<typeof fetch>) => {
        calls.push(args);
        return new Response("ok", { status: 200 });
      },
      { preconnect() {} },
    );

    try {
      const specifier: string = "../../../src/utils/slackNotification.ts?test=no_webhook";
      const { notifyFatalErrorToSlack } = await import(specifier);
      await notifyFatalErrorToSlack(new Error("boom"), { mode: "live" });
      expect(calls).toHaveLength(0);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) {
        delete Bun.env.SLACK_WEBHOOK_URL;
      } else {
        Bun.env.SLACK_WEBHOOK_URL = previousUrl;
      }
    }
  });

  test("posts a message when SLACK_WEBHOOK_URL is set", async () => {
    const previousUrl = Bun.env.SLACK_WEBHOOK_URL;
    Bun.env.SLACK_WEBHOOK_URL = "https://example.com/webhook";

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        calls.push({ url: fetchUrl(url), init });
        return new Response("ok", { status: 200 });
      },
      { preconnect() {} },
    );

    try {
      const cause = new Error("bad yaml");
      cause.stack = "Error: bad yaml\n    at loadConfig (src/config.ts:1:1)";
      const specifier: string = "../../../src/utils/slackNotification.ts?test=with_webhook";
      const { notifyFatalErrorToSlack } = await import(specifier);
      await notifyFatalErrorToSlack(
        createAppError("config.invalid", "Config validation failed", cause),
        { mode: "paper", venue: "bulk", market: "BTC-USD", configPath: "config/test.yml" },
      );

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://example.com/webhook");
      const body = parseSlackBody(calls[0]?.init?.body);
      expect(body.text).toBeUndefined();
      expect(body.icon_emoji).toBeUndefined();
      expect(body.attachments?.[0]?.color).toBe("#ff0000");
      expect(body.attachments?.[0]?.fallback).toBe("config.invalid: Config validation failed");
      expect(body.attachments?.[0]?.text).toContain("*Notification Level:* 🚨 `error`");
      expect(body.attachments?.[0]?.text).toContain(
        "*Error Title:* `config.invalid` Config validation failed",
      );
      expect(body.attachments?.[0]?.text).toContain(
        "*Bot State:* `paper` `bulk` `BTC-USD` `config/test.yml`",
      );
      expect(body.attachments?.[0]?.text).toContain("*Cause:*\nbad yaml");
      expect(body.attachments?.[0]?.text).toContain("*Stack Trace:*");
      expect(body.attachments?.[0]?.text).toContain("Error: bad yaml");
      expect(body.attachments?.[0]?.text).toContain("at loadConfig (src/config.ts:1:1)");
      expect(body.attachments?.[0]?.text).not.toContain("simple-mm-bot error");
      expect(body.attachments?.[0]?.text).not.toContain("*Context:*");
      expect(body.attachments?.[0]?.text).not.toContain("*Reason:*");
      expect(body.attachments?.[0]?.text).not.toContain("*Error:*");
      expect(body.attachments?.[0]?.text).not.toContain("Trading runtime stopped");
      expect(body.attachments?.[0]?.text).not.toContain("*Details:*");
      expect(body.attachments?.[0]?.text).not.toContain("🟥");
      expect(body.attachments?.[0]).not.toHaveProperty("blocks");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) {
        delete Bun.env.SLACK_WEBHOOK_URL;
      } else {
        Bun.env.SLACK_WEBHOOK_URL = previousUrl;
      }
    }
  });

  test("posts a message without startup context", async () => {
    const previousUrl = Bun.env.SLACK_WEBHOOK_URL;
    Bun.env.SLACK_WEBHOOK_URL = "https://example.com/webhook";

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        calls.push({ url: fetchUrl(url), init });
        return new Response("ok", { status: 200 });
      },
      { preconnect() {} },
    );

    try {
      const specifier: string = "../../../src/utils/slackNotification.ts?test=no_context";
      const { notifyFatalErrorToSlack } = await import(specifier);
      await notifyFatalErrorToSlack("boom");

      expect(calls).toHaveLength(1);
      const body = parseSlackBody(calls[0]?.init?.body);
      expect(body.text).toBeUndefined();
      expect(body.icon_emoji).toBeUndefined();
      expect(body.attachments?.[0]?.text).toContain("*Notification Level:* 🚨 `error`");
      expect(body.attachments?.[0]?.text).toContain("*Error Title:* Error: boom");
      expect(body.attachments?.[0]?.text).not.toContain("*Bot State:*");
      expect(body.attachments?.[0]?.text).not.toContain("mode:");
      expect(body.attachments?.[0]?.text).not.toContain("venue:");
      expect(body.attachments?.[0]?.text).not.toContain("market:");
    } finally {
      globalThis.fetch = previousFetch;
      if (previousUrl === undefined) {
        delete Bun.env.SLACK_WEBHOOK_URL;
      } else {
        Bun.env.SLACK_WEBHOOK_URL = previousUrl;
      }
    }
  });
});
