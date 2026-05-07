import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

import { DEFAULT_CONFIG_PATH, DEFAULT_SQLITE_DB_PATH } from "./runtimePaths.ts";

export const env = createEnv({
  server: {
    CONFIG_PATH: z.string().min(1).default(DEFAULT_CONFIG_PATH),
    MODE: z.enum(["live", "paper", "backtest"]).optional(),
    DATABASE_URL: z.url().optional(),
    DB_PATH: z.string().min(1).default(DEFAULT_SQLITE_DB_PATH),
    SLACK_WEBHOOK_URL: z.url().optional(),
    HL_WS_URL: z.url().optional(),
    HL_HTTP_URL: z.url().optional(),
    HL_SECRET_KEY: z.string().min(1).optional(),
    HL_ACCOUNT_ADDRESS: z.string().min(1).optional(),
    BULK_PRIVATE_KEY: z.string().min(1).optional(),
    LOG_LEVEL: z.enum(["ERROR", "WARN", "LOG", "INFO", "DEBUG"]).default("INFO"),
  },
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
