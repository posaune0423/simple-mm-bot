import { ERROR_LEVEL_TO_EMOJI, ERROR_LEVEL_TO_SLACK_COLOR, getErrorLevel } from "./error.ts";
import { postSlackWebhook, type SlackWebhookMessage } from "./SlackWebhook.ts";
import { describeError, type ErrorDescription, stringifyError } from "../../utils/errors.ts";
import { logger } from "../../utils/logger.ts";

export interface FatalErrorSlackContext {
  component?: string;
  worker?: string;
  event?: string;
  mode?: string;
  venue?: string;
  market?: string;
  symbol?: string;
  kind?: string;
  source?: string;
  configPath?: string;
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

function formatBotStateValues(context: FatalErrorSlackContext): string[] {
  return [context.mode, context.venue, context.market, context.configPath]
    .filter((value): value is string => value !== undefined)
    .map((value) => `\`${escapeSlackText(truncateText(value, MAX_FIELD))}\``);
}

function formatRuntimeStateValues(context: FatalErrorSlackContext): string[] {
  return [
    context.component,
    context.worker,
    context.event,
    context.venue,
    context.symbol,
    context.kind,
    context.market,
    context.source,
    context.configPath,
  ]
    .filter((value): value is string => value !== undefined)
    .map((value) => `\`${escapeSlackText(truncateText(value, MAX_FIELD))}\``);
}

function shouldUseRuntimeStateLabel(context: FatalErrorSlackContext): boolean {
  return (
    context.component !== undefined ||
    context.worker !== undefined ||
    context.event !== undefined ||
    context.symbol !== undefined ||
    context.kind !== undefined ||
    context.source !== undefined
  );
}

function fallbackAttachmentText(reason: ErrorDescription): string {
  return truncateText(`${reason.title}: ${reason.reason}`, MAX_TEXT);
}

function buildAttachmentText(input: {
  emoji: string;
  level: string;
  reason: ErrorDescription;
  context: FatalErrorSlackContext;
}): string {
  const useRuntimeState = shouldUseRuntimeStateLabel(input.context);
  const stateValues = useRuntimeState
    ? formatRuntimeStateValues(input.context)
    : formatBotStateValues(input.context);
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

  if (stateValues.length > 0) {
    lines.push(`*${useRuntimeState ? "Runtime" : "Bot"} State:* ${stateValues.join(" ")}`);
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
  const reason = describeError(error);

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
  const webhookUrl = Bun.env.SLACK_WEBHOOK_URL?.trim();
  if (webhookUrl === undefined || webhookUrl === "") return;

  try {
    await postSlackWebhook(webhookUrl, buildFatalErrorSlackMessage(error, context));
  } catch (notifyError) {
    logger.warn(`[lib] SlackNotification | NOTIFY_FAILED | error=${stringifyError(notifyError)}`);
  }
}
