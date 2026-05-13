import { SlackWebhookError } from "./error.ts";

interface SlackAttachment {
  color?: string;
  fallback?: string;
  text?: string;
}

export interface SlackWebhookMessage {
  text?: string;
  username?: string;
  icon_emoji?: string;
  blocks?: unknown[];
  attachments?: SlackAttachment[];
}

export async function postSlackWebhook(
  webhookUrl: string,
  message: SlackWebhookMessage,
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: JSON.stringify(message),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new SlackWebhookError(
      `Slack webhook request failed status=${res.status}`,
      res.status,
      text,
    );
  }
}
