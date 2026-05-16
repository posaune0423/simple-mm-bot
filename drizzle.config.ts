import { defineConfig } from "drizzle-kit";

import { resolveDatabaseUrl } from "./src/utils/databaseUrl.ts";

const database = resolveDatabaseUrl(process.env.DATABASE_URL);

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/db/postgres/schema.ts",
  out: "./src/infrastructure/db/postgres/migrations",
  dbCredentials: {
    url: database.url,
  },
});
