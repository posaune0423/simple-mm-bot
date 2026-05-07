import { describe, expect, test } from "bun:test";

function fetchUrl(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
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
      const specifier: string = "../../src/utils/slack-notification.ts?test=no_webhook";
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
      const specifier: string = "../../src/utils/slack-notification.ts?test=with_webhook";
      const { notifyFatalErrorToSlack } = await import(specifier);
      await notifyFatalErrorToSlack("boom", { mode: "paper", venue: "bulk", market: "BTC-USD" });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.url).toBe("https://example.com/webhook");
      const requestBody = calls[0]?.init?.body;
      if (typeof requestBody !== "string") {
        throw new Error("Expected Slack request body to be a string");
      }
      const body = JSON.parse(requestBody) as { text: string };
      expect(body.text).toContain("fatal error");
      expect(body.text).toContain("mode");
      expect(body.text).toContain("BTC-USD");
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
