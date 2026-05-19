import { notifyFatalErrorToSlack, type FatalErrorSlackContext } from "../lib/slack/notification.ts";
import { stringifyError } from "../utils/errors.ts";
import { logger } from "../utils/logger.ts";

export type WorkerErrorContext = {
  event: string;
  venue?: string;
  market?: string;
  symbol?: string;
  kind?: string;
  source?: string;
  configPath?: string;
};

export class WorkerErrorNotifier {
  private readonly sentKeys = new Set<string>();

  constructor(private readonly workerName: string) {}

  async notify(error: unknown, context: WorkerErrorContext): Promise<void> {
    const key = this.keyFor(context);
    if (this.sentKeys.has(key)) {
      return;
    }
    this.sentKeys.add(key);

    const slackContext: FatalErrorSlackContext = {
      component: "worker",
      worker: this.workerName,
      ...context,
    };
    await notifyFatalErrorToSlack(error, slackContext);
  }

  notifySoon(error: unknown, context: WorkerErrorContext): void {
    void this.notify(error, context).catch((notifyError: unknown) => {
      logger.warn(
        `[worker] ${this.workerName} | SLACK_NOTIFY_FAILED | error=${stringifyError(notifyError)}`,
      );
    });
  }

  private keyFor(context: WorkerErrorContext): string {
    return [
      context.event,
      context.venue,
      context.market,
      context.symbol,
      context.kind,
      context.source,
      context.configPath,
    ]
      .filter((value): value is string => value !== undefined)
      .join("|");
  }
}
