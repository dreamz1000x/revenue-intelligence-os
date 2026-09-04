import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

function requireDatabaseUrl(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    throw new Error("DATABASE_URL is invalid");
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("DATABASE_URL is invalid");
  }

  return value;
}

export async function runDatabaseMigrations(
  databaseUrl: string,
): Promise<void> {
  const connectionString = requireDatabaseUrl(databaseUrl);
  const pool = new Pool({ connectionString });

  try {
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  try {
    await runDatabaseMigrations(requireDatabaseUrl(process.env.DATABASE_URL));
  } catch {
    console.error("Database migration failed");
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href
) {
  await main();
}
