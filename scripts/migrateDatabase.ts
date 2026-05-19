#!/usr/bin/env bun
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

import { resolveDatabaseUrl } from "../src/utils/databaseUrl";

type Journal = {
  entries: Array<{
    idx: number;
    tag: string;
    when: number;
  }>;
};

const migrationsFolder = "src/infrastructure/db/postgres/migrations";
const migrationsSchema = "drizzle";
const migrationsTable = "__drizzle_migrations";

function migrationFileName(index: number, tag: string): string {
  const prefix = String(index).padStart(4, "0");
  return tag.startsWith(`${prefix}_`) ? `${tag}.sql` : `${prefix}_${tag}.sql`;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function main(): Promise<void> {
  const database = resolveDatabaseUrl(process.env.DATABASE_URL);
  const sql = postgres(database.url, { max: 1 });

  try {
    await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${migrationsSchema}`, [], { prepare: false });
    await sql.unsafe(
      `CREATE TABLE IF NOT EXISTS ${migrationsSchema}.${migrationsTable} (
        id SERIAL PRIMARY KEY,
        hash TEXT NOT NULL,
        created_at BIGINT
      )`,
      [],
      { prepare: false },
    );

    const [lastMigration] = await sql<{ created_at: string }[]>`
      SELECT created_at
      FROM drizzle.__drizzle_migrations
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const lastCreatedAt = lastMigration ? Number(lastMigration.created_at) : undefined;

    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, "meta/_journal.json"), "utf8"),
    ) as Journal;
    const migrationMetas = readMigrationFiles({ migrationsFolder });
    const hashesByCreatedAt = new Map(
      migrationMetas.map((migration) => [migration.folderMillis, migration.hash]),
    );

    for (const entry of journal.entries) {
      if (lastCreatedAt !== undefined && entry.when <= lastCreatedAt) {
        continue;
      }

      const filePath = join(migrationsFolder, migrationFileName(entry.idx, entry.tag));
      const migrationSql = readFileSync(filePath, "utf8");
      const hash = hashesByCreatedAt.get(entry.when) ?? sha256(migrationSql);

      await sql.begin(async (transaction) => {
        await transaction.unsafe(migrationSql, [], { prepare: false });
        await transaction`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${hash}, ${entry.when})
        `;
      });
      console.info(`applied ${entry.tag}`);
    }
  } finally {
    await sql.end();
  }
}

await main();
