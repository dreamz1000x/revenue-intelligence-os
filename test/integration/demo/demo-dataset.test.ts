import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { seedDemoDataset } from "../../../src/demo/demo-dataset.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import { resetKnownDemoTables } from "../../../src/demo/reset-demo.js";
import { PostgresReconciliationPersistence } from "../../../src/reconciliation/persistence/postgres-reconciliation-persistence.js";

describe.sequential("deterministic demo dataset", () => {
  let container: StartedPostgreSqlContainer; let database: Database;
  beforeAll(async () => { container = await new PostgreSqlContainer("postgres:18.4").withDatabase("rios_demo").start(); database = createDatabase({ connectionString: container.getConnectionUri() }); await migrate(database.client, { migrationsFolder: "./drizzle" }); }, 120_000);
  afterAll(async () => { await database?.close(); await container?.stop(); }, 30_000);
  it("reproduces exact facts, cents, Findings, and lifecycle state", async () => {
    await resetKnownDemoTables(database); const first = await seedDemoDataset(database);
    const totals = await database.client.execute(sql`select (select sum(total_amount_cents)::int from contracts) contracted, (select sum(amount_cents)::int from installments) scheduled, (select sum(amount_cents)::int from payments) gross_payments, (select sum(amount_cents)::int from refunds) refunds, (select sum(amount_cents)::int from external_source_events where event_type='settlement_credit' and internal_payment_id is not null) bank_gross, (select sum(amount_cents)::int from external_source_events where event_type='refund_debit' and internal_refund_id is not null) bank_refunds`);
    expect(totals.rows[0]).toEqual({ contracted: 27000, scheduled: 27000, gross_payments: 19000, refunds: 3000, bank_gross: 15500, bank_refunds: 3000 });
    const findings = await new PostgresReconciliationPersistence(database).listFindings({ runId: first.runId, limit: 100 });
    expect(findings.map((item) => [item.ruleCode, item.amountDeltaCents, item.status]).sort()).toEqual([
      ["BANK_SETTLEMENT_AMOUNT_MISMATCH", -500, "resolved"], ["INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT", null, "open"], ["ORPHAN_BANK_MOVEMENT", null, "ignored"],
    ].sort());
    await resetKnownDemoTables(database); const second = await seedDemoDataset(database); expect(second).toEqual(first);
  });
});
