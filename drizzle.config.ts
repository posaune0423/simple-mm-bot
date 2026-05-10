import { defineConfig } from "drizzle-kit";

import { env } from "./src/env.ts";

const databaseUrl = env.DATABASE_URL;

export default defineConfig(
  databaseUrl
    ? {
        dialect: "postgresql",
        schema: "./src/infrastructure/db/postgres/schema.ts",
        out: "./src/infrastructure/db/postgres/migrations",
        dbCredentials: {
          url: databaseUrl,
        },
      }
    : {
        dialect: "sqlite",
        schema: "./src/infrastructure/db/sqlite/schema.ts",
        out: "./src/infrastructure/db/sqlite/migrations",
        dbCredentials: {
          url: env.DB_PATH,
        },
      },
);
