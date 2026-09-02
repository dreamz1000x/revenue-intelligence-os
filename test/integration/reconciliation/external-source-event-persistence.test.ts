import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "../../../src/persistence/database.js";
import { ExternalEventEvidenceConflict, ExternalPaymentReferenceNotFoundError, ExternalRefundReferenceNotFoundError } from "../../../src/reconciliation/application/external-source-event-persistence.js";
import { PostgresExternalSourceEventPersistence } from "../../../src/reconciliation/persistence/postgres-external-source-event-persistence.js";

const AT = new Date("2026-09-02T10:00:00.123Z");
const input = { source: "simulated_bank", sourceEventId: "bank-1", eventType: "settlement_credit" as const, amountCents: 100, currency: "EUR" as const, occurredAt: AT, receivedAt: AT, externalReference: "statement-1", internalPaymentId: null, internalRefundId: null, providerPaymentReference: null, rawPayload: Buffer.from('{"id":"bank-1"}'), metadata: { b: 2, a: 1 }, createdAt: AT };
describe.sequential("External source event PostgreSQL persistence", () => {
  let container: StartedPostgreSqlContainer; let database: Database; let persistence: PostgresExternalSourceEventPersistence;
  beforeAll(async () => { container = await new PostgreSqlContainer("postgres:18.4").start(); database = createDatabase({ connectionString: container.getConnectionUri() }); await migrate(database.client, { migrationsFolder: "./drizzle" }); persistence = new PostgresExternalSourceEventPersistence(database); }, 120_000);
  beforeEach(() => database.client.execute(sql`truncate reconciliation_actions, reconciliation_finding_evidence, reconciliation_findings, reconciliation_runs, external_source_events restart identity`));
  afterAll(async () => { await database?.close(); await container?.stop(); }, 30_000);
  it("creates, gets, and exactly replays immutable evidence", async () => { const created = await persistence.record(input); const replayed = await persistence.record({ ...input, metadata: { a: 1, b: 2 } }); expect(created.outcome).toBe("created"); expect(replayed).toMatchObject({ outcome: "replayed", resource: { id: created.resource.id } }); expect(await persistence.getById(created.resource.id)).toMatchObject({ rawPayload: input.rawPayload, metadata: { a: 1, b: 2 } }); });
  it("rejects the same identity with different evidence", async () => { await persistence.record(input); await expect(persistence.record({ ...input, amountCents: 101 })).rejects.toThrow(ExternalEventEvidenceConflict); });
  it("converges concurrent identical delivery and conflicts concurrent different evidence", async () => { const identical = await Promise.all([persistence.record(input), persistence.record(input)]); expect(identical.map((result) => result.resource.id)).toEqual([1, 1]); await database.client.execute(sql`truncate reconciliation_finding_evidence, external_source_events restart identity`); const results = await Promise.allSettled([persistence.record(input), persistence.record({ ...input, amountCents: 101 })]); expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1); expect(results.filter((result) => result.status === "rejected")).toHaveLength(1); });
  it("allows unmatched settlement and refund evidence", async () => { await expect(persistence.record(input)).resolves.toMatchObject({ outcome: "created" }); await expect(persistence.record({ ...input, sourceEventId: "bank-2", eventType: "refund_debit" })).resolves.toMatchObject({ outcome: "created" }); });
  it("reports missing explicit internal references", async () => { await expect(persistence.record({ ...input, internalPaymentId: 999 })).rejects.toThrow(ExternalPaymentReferenceNotFoundError); await expect(persistence.record({ ...input, sourceEventId: "bank-2", eventType: "refund_debit", internalRefundId: 999 })).rejects.toThrow(ExternalRefundReferenceNotFoundError); });
});
