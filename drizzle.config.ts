import { defineConfig } from "drizzle-kit";

import { env } from "./src/env.ts";
import { resolveDatabaseUrl } from "./src/utils/databaseUrl.ts";

const database = resolveDatabaseUrl(Bun.env.DATABASE_URL ?? env.DATABASE_URL);

export default defineConfig(
  database.kind === "postgres"
    ? {
        dialect: "postgresql",
        schema: "./src/infrastructure/db/postgres/schema.ts",
        out: "./src/infrastructure/db/postgres/migrations",
        dbCredentials: {
          url: database.url,
        },
      }
    : {
        dialect: "sqlite",
        schema: "./src/infrastructure/db/sqlite/schema.ts",
        out: "./src/infrastructure/db/sqlite/migrations",
        dbCredentials: {
          url: database.path,
        },
      },
);
