export type ErrorLevel = "error";

export const ERROR_LEVEL_TO_EMOJI: Record<ErrorLevel, string> = {
  error: "🚨",
};

export const ERROR_LEVEL_TO_SLACK_COLOR: Record<ErrorLevel, string> = {
  error: "#ff0000",
};

export class SlackWebhookError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseText?: string,
  ) {
    super(message);
    this.name = "SlackWebhookError";
  }
}

export function getErrorLevel(_error: unknown): ErrorLevel {
  return "error";
}
