import { env } from "../env.ts";
import type { AppError } from "./errors.ts";
import { formatAppError } from "./errors.ts";
import { logger } from "./logger.ts";
import { postSlackWebhook } from "../lib/slack/index.ts";

export interface FatalErrorSlackContext {
  mode?: string;
  venue?: string;
  market?: string;
  configPath?: string;
}

function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

function formatUnknownError(error: unknown): string {
  if (isAppError(error)) {
    return formatAppError(error);
  }
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

export async function notifyFatalErrorToSlack(
  error: unknown,
  context: FatalErrorSlackContext,
): Promise<void> {
  const webhookUrl = env.SLACK_WEBHOOK_URL;
  if (webhookUrl === undefined) return;

  const lines: string[] = [];
  lines.push("*simple-mm-bot fatal error*");
  if (context.mode !== undefined) lines.push(`- mode: \`${context.mode}\``);
  if (context.venue !== undefined) lines.push(`- venue: \`${context.venue}\``);
  if (context.market !== undefined) lines.push(`- market: \`${context.market}\``);
  if (context.configPath !== undefined) lines.push(`- configPath: \`${context.configPath}\``);
  lines.push("");
  lines.push("```");
  lines.push(formatUnknownError(error));
  lines.push("```");

  try {
    await postSlackWebhook(webhookUrl, { text: lines.join("\n") });
  } catch (notifyError) {
    logger.warn(`slack_notification_failed: ${String(notifyError)}`);
  }
}
