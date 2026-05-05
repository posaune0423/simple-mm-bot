import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    CONFIG_PATH: z.string().min(1).default("config/config.bulk.yml"),
    MODE: z.enum(["live", "paper", "backtest"]).optional(),
    DATABASE_URL: z.url().optional(),
    DB_PATH: z.string().min(1).default("data/mmbot.db"),
    HL_WS_URL: z.url().optional(),
    HL_HTTP_URL: z.url().optional(),
    HL_SECRET_KEY: z.string().min(1).optional(),
    HL_ACCOUNT_ADDRESS: z.string().min(1).optional(),
    BULK_PRIVATE_KEY: z.string().min(1).optional(),
  },
  runtimeEnv: Bun.env,
  emptyStringAsUndefined: true,
});
