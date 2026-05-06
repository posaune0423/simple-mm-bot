import { defineConfig } from "drizzle-kit";

import { env } from "./src/env.ts";
import {
  POSTGRES_MIGRATIONS_DIR,
  POSTGRES_SCHEMA_PATH,
  SQLITE_MIGRATIONS_DIR,
  SQLITE_SCHEMA_PATH,
} from "./src/runtimePaths.ts";

const databaseUrl = env.DATABASE_URL;

export default defineConfig(
  databaseUrl
    ? {
        dialect: "postgresql",
        schema: POSTGRES_SCHEMA_PATH,
        out: POSTGRES_MIGRATIONS_DIR,
        dbCredentials: {
          url: databaseUrl,
        },
      }
    : {
        dialect: "sqlite",
        schema: SQLITE_SCHEMA_PATH,
        out: SQLITE_MIGRATIONS_DIR,
        dbCredentials: {
          url: env.DB_PATH,
        },
      },
);
