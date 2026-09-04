import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runDatabaseMigrations } from "../../../src/persistence/migrate.js";

describe.sequential("production migration runner", () => {
  let container: StartedPostgreSqlContainer;
  let connectionString: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:18.4").start();
    connectionString = container.getConnectionUri();
  }, 120_000);

  afterAll(async () => {
    await container?.stop();
  }, 30_000);

  it("applies all committed migrations to a blank database and reruns safely", async () => {
    await runDatabaseMigrations(connectionString);

    const inspectionPool = new Pool({ connectionString });
    try {
      const history = await inspectionPool.query<{ count: string }>(
        "select count(*)::text as count from drizzle.__drizzle_migrations",
      );
      expect(history.rows[0]?.count).toBe("8");

      const relations = await inspectionPool.query<{ relation: string | null }>(`
        select unnest(array[
          to_regclass('public.customers')::text,
          to_regclass('public.payments')::text,
          to_regclass('public.refunds')::text,
          to_regclass('public.reconciliation_runs')::text,
          to_regclass('public.audit_events')::text
        ]) as relation
      `);
      expect(relations.rows.map((row) => row.relation)).toEqual([
        "customers",
        "payments",
        "refunds",
        "reconciliation_runs",
        "audit_events",
      ]);

      await runDatabaseMigrations(connectionString);

      const historyAfterRerun = await inspectionPool.query<{ count: string }>(
        "select count(*)::text as count from drizzle.__drizzle_migrations",
      );
      expect(historyAfterRerun.rows[0]?.count).toBe("8");
    } finally {
      await inspectionPool.end();
    }
  }, 120_000);
});
