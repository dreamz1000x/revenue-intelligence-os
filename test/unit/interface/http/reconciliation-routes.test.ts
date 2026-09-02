import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type HttpUseCases } from "../../../../src/interface/http/app.js";
import { reconstituteExternalSourceEvent } from "../../../../src/reconciliation/domain/external-source-event.js";
import { fingerprintReconciliationRun, reconstituteReconciliationRun } from "../../../../src/reconciliation/domain/reconciliation-run.js";
import { reconstituteReconciliationFinding } from "../../../../src/reconciliation/domain/reconciliation-finding.js";
import { reconstituteReconciliationAction } from "../../../../src/reconciliation/domain/reconciliation-action.js";
import { ExternalEventEvidenceConflict } from "../../../../src/reconciliation/application/external-source-event-persistence.js";
import { IllegalReconciliationTransition, ReconciliationFindingNotFoundError } from "../../../../src/reconciliation/application/reconciliation-action-persistence.js";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const EVENT = reconstituteExternalSourceEvent({ id: 4, source: "test-bank", sourceEventId: "bank-4", eventType: "settlement_credit", amountCents: 2500, currency: "EUR", occurredAt: NOW, receivedAt: NOW, externalReference: "statement-4", internalPaymentId: 7, internalRefundId: null, providerPaymentReference: "pi_test", rawPayload: Buffer.from('{"ok":true}'), metadata: { batch: "golden" }, createdAt: NOW });
const RUN = reconstituteReconciliationRun({ id: 5, scopeType: "global", scopeId: null, cutoff: NOW, ruleSetVersion: "reconciliation-v1", runFingerprint: fingerprintReconciliationRun(NOW), status: "completed", executedAt: NOW, createdAt: NOW });
const FINDING = reconstituteReconciliationFinding({ id: 6, runId: 5, ruleCode: "INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT", ruleVersion: 1, severity: "warning", subjectType: "payment", subjectId: 7, amountDeltaCents: 2500, currency: "EUR", status: "open", fingerprint: "0".repeat(64), createdAt: NOW, statusUpdatedAt: NOW });
const ACTION = reconstituteReconciliationAction({ id: 8, findingId: 6, actionType: "resolve", fromStatus: "open", toStatus: "resolved", actorType: "operator", actorId: "ops-1", reason: "Matched statement", idempotencyKey: "action-key", requestFingerprint: "1".repeat(64), occurredAt: NOW, recordedAt: NOW });
const apps: FastifyInstance[] = [];

function app(overrides: Partial<HttpUseCases> = {}) {
  const unexpected = async () => { throw new Error("Unexpected route"); };
  const built = buildApp({
    createCustomer: unexpected, getCustomerById: unexpected, createContract: unexpected, getContractById: unexpected,
    recordPayment: unexpected, getPaymentById: unexpected, recordRefund: unexpected, getRefundById: unexpected,
    processStripeWebhook: unexpected, stripeWebhookClock: { now: () => NOW }, verifyStripeSignature: () => { throw new Error("Unexpected route"); },
    recordExternalSourceEvent: async () => ({ resource: EVENT, outcome: "created" }), getExternalSourceEventById: async () => EVENT,
    runReconciliation: async () => ({ resource: RUN, outcome: "created" }),
    reconciliationPersistence: { execute: unexpected, getRunById: async () => RUN, listRuns: async () => [RUN], getFindingById: async () => ({ finding: FINDING, evidence: [{ entityType: "payment", entityId: 7, role: "subject" }], actions: [ACTION] }), listFindings: async () => [FINDING] },
    actOnReconciliationFinding: async () => ({ resource: ACTION, outcome: "created" }), ...overrides,
  } as HttpUseCases);
  apps.push(built); return built;
}
afterEach(async () => { await Promise.all(apps.splice(0).map((item) => item.close())); });

describe("Reconciliation HTTP interface", () => {
  it("creates and replays external evidence with explicit UTF-8 serialization", async () => {
    let input: unknown;
    const first = await app({ recordExternalSourceEvent: async (value) => { input = value; return { resource: EVENT, outcome: "created" }; } }).inject({ method: "POST", url: "/external-source-events", payload: { source: "test-bank", sourceEventId: "bank-4", eventType: "settlement_credit", amountCents: 2500, currency: "EUR", occurredAt: NOW.toISOString(), receivedAt: NOW.toISOString(), externalReference: "statement-4", internalPaymentId: 7, providerPaymentReference: "pi_test", rawPayload: '{"ok":true}', metadata: { batch: "golden" } } });
    expect(first.statusCode).toBe(201); expect((input as { rawPayload: Buffer }).rawPayload.toString()).toBe('{"ok":true}'); expect(first.json().rawPayload).toBe('{"ok":true}');
    const replay = await app({ recordExternalSourceEvent: async () => ({ resource: EVENT, outcome: "replayed" }) }).inject({ method: "POST", url: "/external-source-events", payload: { source: "test-bank", sourceEventId: "bank-4", eventType: "settlement_credit", amountCents: 2500, currency: "EUR", occurredAt: NOW.toISOString(), receivedAt: NOW.toISOString(), externalReference: "statement-4", internalPaymentId: 7, providerPaymentReference: "pi_test", rawPayload: "x", metadata: {} } });
    expect(replay.statusCode).toBe(200);
  });

  it("gets external evidence and maps absence and conflicts", async () => {
    expect((await app().inject({ method: "GET", url: "/external-source-events/4" })).json().id).toBe(4);
    const missing = await app({ getExternalSourceEventById: async () => null }).inject({ method: "GET", url: "/external-source-events/99" }); expect(missing.statusCode).toBe(404); expect(missing.json().error.code).toBe("EXTERNAL_SOURCE_EVENT_NOT_FOUND");
    const conflict = await app({ recordExternalSourceEvent: async () => { throw new ExternalEventEvidenceConflict("test-bank", "bank-4"); } }).inject({ method: "POST", url: "/external-source-events", payload: { source: "test-bank", sourceEventId: "bank-4", eventType: "refund_debit", amountCents: 1, currency: "EUR", occurredAt: NOW.toISOString(), receivedAt: NOW.toISOString(), externalReference: "x", rawPayload: "x", metadata: {} } }); expect(conflict.statusCode).toBe(409); expect(conflict.json().error.code).toBe("EXTERNAL_EVENT_EVIDENCE_CONFLICT");
  });

  it("creates and converges reconciliation Runs with Idempotency-Key", async () => {
    let key = ""; const created = await app({ runReconciliation: async (value) => { key = value.idempotencyKey; return { resource: RUN, outcome: "created" }; } }).inject({ method: "POST", url: "/reconciliation/runs", headers: { "idempotency-key": "run-key" }, payload: { cutoff: NOW.toISOString() } }); expect(created.statusCode).toBe(201); expect(key).toBe("run-key");
    const replay = await app({ runReconciliation: async () => ({ resource: RUN, outcome: "replayed" }) }).inject({ method: "POST", url: "/reconciliation/runs", headers: { "idempotency-key": "run-key-2" }, payload: { cutoff: NOW.toISOString() } }); expect(replay.statusCode).toBe(200);
  });

  it("lists and gets Runs and Findings with exact filters and typed details", async () => {
    let filters: unknown; const persistence = { execute: async () => ({ resource: RUN, outcome: "created" as const }), getRunById: async () => RUN, listRuns: async () => [RUN], getFindingById: async () => ({ finding: FINDING, evidence: [{ entityType: "payment" as const, entityId: 7, role: "subject" as const }], actions: [ACTION] }), listFindings: async (value: unknown) => { filters = value; return [FINDING]; } };
    expect((await app({ reconciliationPersistence: persistence }).inject({ method: "GET", url: "/reconciliation/runs?limit=2" })).json()[0].id).toBe(5);
    const listed = await app({ reconciliationPersistence: persistence }).inject({ method: "GET", url: "/reconciliation/findings?runId=5&status=open&severity=warning&ruleCode=INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT&limit=3" }); expect(listed.statusCode).toBe(200); expect(filters).toEqual({ runId: 5, status: "open", severity: "warning", ruleCode: "INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT", limit: 3 });
    const detail = (await app({ reconciliationPersistence: persistence }).inject({ method: "GET", url: "/reconciliation/findings/6" })).json(); expect(detail.evidence).toEqual([{ entityType: "payment", entityId: 7, role: "subject" }]); expect(detail.actions[0].action).toBe("resolve");
  });

  it("creates and replays actions and maps dedicated lifecycle errors", async () => {
    const created = await app().inject({ method: "POST", url: "/reconciliation/findings/6/actions", headers: { "idempotency-key": "action-key" }, payload: { action: "resolve", actorId: "ops-1", reason: "Matched statement", occurredAt: NOW.toISOString() } }); expect(created.statusCode).toBe(201); expect(created.json().toStatus).toBe("resolved");
    const replay = await app({ actOnReconciliationFinding: async () => ({ resource: ACTION, outcome: "replayed" }) }).inject({ method: "POST", url: "/reconciliation/findings/6/actions", headers: { "idempotency-key": "action-key" }, payload: { action: "resolve", actorId: "ops-1", reason: "Matched statement", occurredAt: NOW.toISOString() } }); expect(replay.statusCode).toBe(200);
    for (const [error, code] of [[new ReconciliationFindingNotFoundError(6), "RECONCILIATION_FINDING_NOT_FOUND"], [new IllegalReconciliationTransition(6, "resolved", "resolve"), "ILLEGAL_RECONCILIATION_TRANSITION"]] as const) { const response = await app({ actOnReconciliationFinding: async () => { throw error; } }).inject({ method: "POST", url: "/reconciliation/findings/6/actions", headers: { "idempotency-key": "action-error" }, payload: { action: "resolve", actorId: "ops-1", reason: "Matched statement", occurredAt: NOW.toISOString() } }); expect(response.json().error.code).toBe(code); }
  });

  it("rejects malformed transport data before application", async () => {
    const response = await app().inject({ method: "POST", url: "/reconciliation/runs", headers: { "idempotency-key": "x" }, payload: { cutoff: "not-an-instant", extra: true } }); expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe("INVALID_REQUEST");
    expect((await app().inject({ method: "GET", url: "/reconciliation/findings?status=unknown" })).statusCode).toBe(400);
  });
});
