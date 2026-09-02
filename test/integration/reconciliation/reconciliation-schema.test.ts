import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { idempotencyRecords } from "../../../src/persistence/idempotency-schema.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import {
  externalSourceEvents,
  reconciliationActions,
  reconciliationFindingEvidence,
  reconciliationFindings,
  reconciliationRuns,
} from "../../../src/reconciliation/persistence/reconciliation-schema.js";

const POSTGRES_IMAGE = "postgres:18.4";
const AT = new Date("2026-09-02T10:00:00.123Z");
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

describe.sequential("Reconciliation relational schema", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table reconciliation_actions, reconciliation_finding_evidence,
        reconciliation_findings, reconciliation_runs, external_source_events,
        idempotency_records restart identity cascade
    `);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  async function insertExternal(overrides: Partial<typeof externalSourceEvents.$inferInsert> = {}) {
    const [event] = await database.client.insert(externalSourceEvents).values({
      source: "simulated_bank", sourceEventId: "bank-1", eventType: "settlement_credit",
      amountCents: 10_000n, currency: "EUR", occurredAt: AT, receivedAt: AT,
      externalReference: "statement-1", rawPayload: Buffer.from('{"id":"bank-1"}'),
      metadata: { fixture: "golden" }, createdAt: AT, ...overrides,
    }).returning();
    return event!;
  }

  async function insertRun(overrides: Partial<typeof reconciliationRuns.$inferInsert> = {}) {
    const [run] = await database.client.insert(reconciliationRuns).values({
      scopeType: "global", scopeId: null, cutoff: AT, ruleSetVersion: "reconciliation-v1",
      runFingerprint: HASH_A, status: "completed", executedAt: AT, createdAt: AT,
      ...overrides,
    }).returning();
    return run!;
  }

  async function insertFinding(runId: number, overrides: Partial<typeof reconciliationFindings.$inferInsert> = {}) {
    const [finding] = await database.client.insert(reconciliationFindings).values({
      runId, ruleCode: "ORPHAN_BANK_MOVEMENT", ruleVersion: 1, severity: "warning",
      subjectType: "external_source_event", subjectId: 1, amountDeltaCents: null,
      currency: "EUR", status: "open", fingerprint: HASH_B, createdAt: AT,
      statusUpdatedAt: AT, ...overrides,
    }).returning();
    return finding!;
  }

  it("accepts both external event types and rejects duplicate source identity", async () => {
    await insertExternal();
    await expect(insertExternal({ sourceEventId: "bank-2", eventType: "refund_debit" })).resolves.toMatchObject({ eventType: "refund_debit" });
    await expect(insertExternal()).rejects.toThrow();
  });

  it("enforces external money, currency, references, and foreign keys", async () => {
    for (const overrides of [{ amountCents: 0n }, { amountCents: -1n }, { amountCents: 9_007_199_254_740_992n }, { currency: "USD" }, { eventType: "refund_debit", providerPaymentReference: "pi_demo" }, { internalPaymentId: 999 }]) {
      await expect(insertExternal({ sourceEventId: `bad-${JSON.stringify(overrides, (_, value) => typeof value === "bigint" ? value.toString() : value)}`, ...overrides })).rejects.toThrow();
    }
  });

  it("makes external events immutable", async () => {
    const event = await insertExternal();
    await expect(database.client.update(externalSourceEvents).set({ amountCents: 9_999n }).where(eq(externalSourceEvents.id, event.id))).rejects.toThrow();
    await expect(database.client.delete(externalSourceEvents).where(eq(externalSourceEvents.id, event.id))).rejects.toThrow();
  });

  it("enforces completed global unique immutable Runs", async () => {
    const run = await insertRun();
    await expect(insertRun()).rejects.toThrow();
    await expect(insertRun({ runFingerprint: HASH_B, scopeType: "contract" })).rejects.toThrow();
    await expect(database.client.update(reconciliationRuns).set({ cutoff: new Date(AT.getTime() + 1_000) }).where(eq(reconciliationRuns.id, run.id))).rejects.toThrow();
    await expect(database.client.delete(reconciliationRuns).where(eq(reconciliationRuns.id, run.id))).rejects.toThrow();
  });

  it("enforces Finding vocabulary, signed delta, and per-Run uniqueness", async () => {
    const run = await insertRun();
    await insertFinding(run.id, { amountDeltaCents: -500n });
    await expect(insertFinding(run.id)).rejects.toThrow();
    await expect(insertFinding(run.id, { fingerprint: "c".repeat(64), ruleCode: "UNKNOWN" })).rejects.toThrow();
    await expect(insertFinding(run.id, { fingerprint: "d".repeat(64), amountDeltaCents: -9_007_199_254_740_992n })).rejects.toThrow();
  });

  it("allows only Finding status projection fields to change", async () => {
    const finding = await insertFinding((await insertRun()).id);
    await expect(database.client.update(reconciliationFindings).set({ status: "acknowledged" }).where(eq(reconciliationFindings.id, finding.id))).resolves.toBeDefined();
    await expect(database.client.update(reconciliationFindings).set({ subjectId: 2 }).where(eq(reconciliationFindings.id, finding.id))).rejects.toThrow();
    await expect(database.client.update(reconciliationFindings).set({ status: "resolved", subjectId: 2 }).where(eq(reconciliationFindings.id, finding.id))).rejects.toThrow();
    await expect(database.client.delete(reconciliationFindings).where(eq(reconciliationFindings.id, finding.id))).rejects.toThrow();
  });

  it("enforces exactly one typed Evidence FK and typed uniqueness", async () => {
    const event = await insertExternal();
    const finding = await insertFinding((await insertRun()).id);
    const base = { findingId: finding.id, role: "external_evidence", createdAt: AT };
    await database.client.insert(reconciliationFindingEvidence).values({ ...base, externalSourceEventId: event.id });
    await expect(database.client.insert(reconciliationFindingEvidence).values({ ...base, externalSourceEventId: event.id })).rejects.toThrow();
    await expect(database.client.insert(reconciliationFindingEvidence).values(base)).rejects.toThrow();
    await expect(database.client.insert(reconciliationFindingEvidence).values({ ...base, externalSourceEventId: event.id, contractId: 999 })).rejects.toThrow();
    await expect(database.client.insert(reconciliationFindingEvidence).values({ ...base, externalSourceEventId: 999 })).rejects.toThrow();
  });

  it("makes Finding Evidence immutable", async () => {
    const event = await insertExternal(); const finding = await insertFinding((await insertRun()).id);
    const [evidence] = await database.client.insert(reconciliationFindingEvidence).values({ findingId: finding.id, role: "external_evidence", externalSourceEventId: event.id, createdAt: AT }).returning();
    await expect(database.client.update(reconciliationFindingEvidence).set({ role: "subject" }).where(eq(reconciliationFindingEvidence.id, evidence!.id))).rejects.toThrow();
    await expect(database.client.delete(reconciliationFindingEvidence).where(eq(reconciliationFindingEvidence.id, evidence!.id))).rejects.toThrow();
  });

  it("enforces Action transitions, idempotency, and immutability", async () => {
    const finding = await insertFinding((await insertRun()).id);
    const values = { findingId: finding.id, actionType: "resolve", fromStatus: "open", toStatus: "resolved", actorType: "operator", actorId: "demo-operator", reason: "Evidence verified", idempotencyKey: "action-1", requestFingerprint: HASH_A, occurredAt: AT, recordedAt: AT };
    const [action] = await database.client.insert(reconciliationActions).values(values).returning();
    await expect(database.client.insert(reconciliationActions).values(values)).rejects.toThrow();
    await expect(database.client.insert(reconciliationActions).values({ ...values, idempotencyKey: "action-2", fromStatus: "resolved" })).rejects.toThrow();
    await expect(database.client.update(reconciliationActions).set({ reason: "changed" }).where(eq(reconciliationActions.id, action!.id))).rejects.toThrow();
    await expect(database.client.delete(reconciliationActions).where(eq(reconciliationActions.id, action!.id))).rejects.toThrow();
  });

  it("admits every existing and new idempotency command type", async () => {
    const commands = ["create_customer", "create_contract", "record_payment", "record_refund", "run_reconciliation", "act_on_reconciliation_finding"];
    for (const [index, commandType] of commands.entries()) await expect(database.client.insert(idempotencyRecords).values({ commandType, idempotencyKey: `schema-${index}`, requestFingerprint: HASH_A, resourceId: index + 1, createdAt: AT })).resolves.toBeDefined();
    await expect(database.client.insert(idempotencyRecords).values({ commandType: "unsupported", idempotencyKey: "bad", requestFingerprint: HASH_A, resourceId: 1, createdAt: AT })).rejects.toThrow();
  });
});
