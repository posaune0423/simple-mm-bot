import { afterEach, describe, expect, test } from "bun:test";

import { WorkerErrorNotifier } from "../../../src/workers/WorkerErrorNotifier.ts";

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
  attachments?: Array<{
    text?: string;
  }>;
}

function parseSlackBody(body: RequestInit["body"] | undefined): SlackBodyForTest {
  if (typeof body !== "string") {
    throw new Error("Expected Slack request body to be a string");
  }
  return JSON.parse(body) as SlackBodyForTest;
}

describe("WorkerErrorNotifier", () => {
  const previousUrl = Bun.env.SLACK_WEBHOOK_URL;
  const previousFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = previousFetch;
    if (previousUrl === undefined) {
      delete Bun.env.SLACK_WEBHOOK_URL;
    } else {
      Bun.env.SLACK_WEBHOOK_URL = previousUrl;
    }
  });

  test("sends one Slack notification per worker error key", async () => {
    Bun.env.SLACK_WEBHOOK_URL = "https://example.com/webhook";
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = Object.assign(
      async (url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        calls.push({ url: fetchUrl(url), init });
        return new Response("ok", { status: 200 });
      },
      { preconnect() {} },
    );

    const notifier = new WorkerErrorNotifier("external-market-recorder");

    await notifier.notify(new Error("insert failed"), {
      event: "insert_failed",
      kind: "top_of_book",
      venue: "binance_usdm",
      symbol: "BTCUSDT",
    });
    await notifier.notify(new Error("insert failed again"), {
      event: "insert_failed",
      kind: "top_of_book",
      venue: "binance_usdm",
      symbol: "BTCUSDT",
    });
    await notifier.notify(new Error("subscription failed"), {
      event: "subscription_error",
      venue: "binance_usdm",
      symbol: "BTCUSDT",
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toBe("https://example.com/webhook");
    const first = parseSlackBody(calls[0]?.init?.body);
    expect(first.attachments?.[0]?.text).toContain(
      "*Runtime State:* `worker` `external-market-recorder` `insert_failed` `binance_usdm` `BTCUSDT` `top_of_book`",
    );
    const second = parseSlackBody(calls[1]?.init?.body);
    expect(second.attachments?.[0]?.text).toContain("`subscription_error`");
  });
});
