import { describe, expect, test } from "bun:test";

import { SlackWebhookError } from "../../../../src/lib/slack/error.ts";
import { postSlackWebhook } from "../../../../src/lib/slack/SlackWebhook.ts";

function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe("postSlackWebhook", () => {
  test("posts JSON payload to the webhook url", async () => {
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
      await postSlackWebhook("https://example.com/webhook", { text: "hello" });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://example.com/webhook");
      expect(calls[0]?.init?.method).toBe("POST");
      expect(new Headers(calls[0]?.init?.headers).get("content-type")).toContain(
        "application/json",
      );
      expect(calls[0]?.init?.body).toBe(JSON.stringify({ text: "hello" }));
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  test("throws SlackWebhookError on non-2xx", async () => {
    const previousFetch = globalThis.fetch;
    globalThis.fetch = Object.assign(async () => new Response("bad", { status: 500 }), {
      preconnect() {},
    });
    try {
      expect(
        await postSlackWebhook("https://example.com/webhook", { text: "hello" }).then(
          () => undefined,
          (error: unknown) => error,
        ),
      ).toBeInstanceOf(SlackWebhookError);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });
});
