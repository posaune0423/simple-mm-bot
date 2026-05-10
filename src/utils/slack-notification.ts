import {
  ERROR_LEVEL_TO_EMOJI,
  ERROR_LEVEL_TO_SLACK_COLOR,
  getErrorLevel,
  postSlackWebhook,
  type SlackWebhookMessage,
} from "../lib/slack/index.ts";
import type { AppError } from "./errors.ts";
import { formatAppError } from "./errors.ts";
import { logger } from "./logger.ts";

export interface FatalErrorSlackContext {
  mode?: string;
  venue?: string;
  market?: string;
  configPath?: string;
}

function isAppError(error: unknown): error is AppError {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
}

const MAX_TEXT = 3000;
const MAX_FIELD = 2000;

function escapeSlackText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function truncateText(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function errorReason(error: unknown): {
  code?: string;
  title: string;
  reason: string;
  cause?: string;
  details: string;
  stack?: string;
} {
  if (isAppError(error)) {
    return {
      code: error.code,
      title: error.code,
      reason: error.message,
      cause: error.cause === undefined ? undefined : errorCauseText(error.cause),
      details: formatAppError(error),
      stack: error.cause instanceof Error ? error.cause.stack : undefined,
    };
  }

  if (error instanceof Error) {
    return {
      title: error.name || "Error",
      reason: error.message || String(error),
      details: error.stack ?? error.message,
      stack: error.stack,
    };
  }

  const reason = typeof error === "string" ? error : safeStringify(error);
  return {
    title: "Error",
    reason,
    details: reason,
  };
}

function errorCauseText(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  if (typeof cause === "string") {
    return cause;
  }
  return safeStringify(cause);
}

function formatBotStateValues(context: FatalErrorSlackContext): string[] {
  return [context.mode, context.venue, context.market, context.configPath]
    .filter((value): value is string => value !== undefined)
    .map((value) => `\`${escapeSlackText(truncateText(value, MAX_FIELD))}\``);
}

function fallbackAttachmentText(reason: ReturnType<typeof errorReason>): string {
  return truncateText(`${reason.title}: ${reason.reason}`, MAX_TEXT);
}

function buildAttachmentText(input: {
  emoji: string;
  level: string;
  reason: ReturnType<typeof errorReason>;
  context: FatalErrorSlackContext;
}): string {
  const botStateValues = formatBotStateValues(input.context);
  const errorTitle =
    input.reason.code === undefined
      ? `${escapeSlackText(input.reason.title)}: ${escapeSlackText(
          truncateText(input.reason.reason, MAX_FIELD),
        )}`
      : `\`${escapeSlackText(input.reason.code)}\` ${escapeSlackText(
          truncateText(input.reason.reason, MAX_FIELD),
        )}`;
  const lines: string[] = [
    `*Notification Level:* ${input.emoji} \`${escapeSlackText(input.level)}\``,
    `*Error Title:* ${errorTitle}`,
  ];

  if (botStateValues.length > 0) {
    lines.push(`*Bot State:* ${botStateValues.join(" ")}`);
  }

  if (input.reason.cause !== undefined) {
    lines.push(`*Cause:*\n${escapeSlackText(truncateText(input.reason.cause, MAX_FIELD))}`);
  }

  if (input.reason.stack !== undefined) {
    lines.push(
      "*Stack Trace:*",
      "```",
      escapeSlackText(truncateText(input.reason.stack, MAX_TEXT)),
      "```",
    );
  }

  lines.push(`_simple-mm-bot • ${new Date().toISOString()}_`);

  return truncateText(lines.join("\n"), MAX_TEXT);
}

function buildFatalErrorSlackMessage(
  error: unknown,
  context: FatalErrorSlackContext,
): SlackWebhookMessage {
  const level = getErrorLevel(error);
  const emoji = ERROR_LEVEL_TO_EMOJI[level];
  const color = ERROR_LEVEL_TO_SLACK_COLOR[level];
  const reason = errorReason(error);

  return {
    attachments: [
      {
        color,
        fallback: fallbackAttachmentText(reason),
        text: buildAttachmentText({ emoji, level, reason, context }),
      },
    ],
  };
}

export async function notifyFatalErrorToSlack(
  error: unknown,
  context: FatalErrorSlackContext = {},
): Promise<void> {
  const webhookUrl = Bun.env.SLACK_WEBHOOK_URL;
  if (webhookUrl === undefined) return;

  try {
    await postSlackWebhook(webhookUrl, buildFatalErrorSlackMessage(error, context));
  } catch (notifyError) {
    logger.warn(`slack_notification_failed: ${String(notifyError)}`);
  }
}
