import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";

import * as schema from "./schema.ts";

export function createPostgresClient(url: string) {
  const client = postgres(url);
  return {
    client,
    db: drizzle(client, { schema }),
  };
}
