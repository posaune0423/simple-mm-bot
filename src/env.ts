import { createEnv } from "@t3-oss/env-core";
import * as v from "valibot";

import { DEFAULT_DATABASE_URL } from "./utils/databaseUrl.ts";

export const env = createEnv({
  server: {
    CONFIG_PATH: v.optional(v.pipe(v.string(), v.minLength(1))),
    CONFIG_VENUE: v.optional(v.pipe(v.string(), v.minLength(1)), "bulk"),
    CONFIG_PRESET: v.optional(v.pipe(v.string(), v.minLength(1)), "beta"),
    MODE: v.optional(v.picklist(["live", "paper", "backtest"])),
    DATABASE_URL: v.optional(v.pipe(v.string(), v.minLength(1)), DEFAULT_DATABASE_URL),
    SLACK_WEBHOOK_URL: v.optional(v.pipe(v.string(), v.url())),
    HL_WS_URL: v.optional(v.pipe(v.string(), v.url())),
    HL_HTTP_URL: v.optional(v.pipe(v.string(), v.url())),
    HL_SECRET_KEY: v.optional(v.pipe(v.string(), v.minLength(1))),
    HL_ACCOUNT_ADDRESS: v.optional(v.pipe(v.string(), v.minLength(1))),
    BULK_PRIVATE_KEY: v.optional(v.pipe(v.string(), v.minLength(1))),
    LOG_LEVEL: v.optional(v.picklist(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]), "INFO"),
  },
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
