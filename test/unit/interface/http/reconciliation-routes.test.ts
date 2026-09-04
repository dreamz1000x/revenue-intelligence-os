import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { reconstituteAuditEvent } from "../../../../src/audit/domain/audit-event.js";
import {
  buildApp,
  type BuildAppOptions,
  type HttpUseCases,
} from "../../../../src/interface/http/app.js";
import { ExternalEventEvidenceConflict } from "../../../../src/reconciliation/application/external-source-event-persistence.js";
import {
  IllegalReconciliationTransition,
  ReconciliationFindingNotFoundError,
} from "../../../../src/reconciliation/application/reconciliation-action-persistence.js";
import { reconstituteReconciliationAction } from "../../../../src/reconciliation/domain/reconciliation-action.js";
import { reconstituteExternalSourceEvent } from "../../../../src/reconciliation/domain/external-source-event.js";
import { reconstituteReconciliationFinding } from "../../../../src/reconciliation/domain/reconciliation-finding.js";
import {
  fingerprintReconciliationRun,
  reconstituteReconciliationRun,
} from "../../../../src/reconciliation/domain/reconciliation-run.js";
import {
  authenticateTestRequests,
  TEST_ACCESS_TOKEN_VERIFIER,
} from "../../../helpers/http-auth.js";

const NOW = new Date("2026-09-02T12:00:00.000Z");

const EVENT = reconstituteExternalSourceEvent({
  id: 4,
  source: "test-bank",
  sourceEventId: "bank-4",
  eventType: "settlement_credit",
  amountCents: 2500,
  currency: "EUR",
  occurredAt: NOW,
  receivedAt: NOW,
  externalReference: "statement-4",
  internalPaymentId: 7,
  internalRefundId: null,
  providerPaymentReference: "pi_test",
  rawPayload: Buffer.from('{"ok":true}'),
  metadata: { batch: "golden" },
  createdAt: NOW,
});

const RUN = reconstituteReconciliationRun({
  id: 5,
  scopeType: "global",
  scopeId: null,
  cutoff: NOW,
  ruleSetVersion: "reconciliation-v1",
  runFingerprint: fingerprintReconciliationRun(NOW),
  status: "completed",
  executedAt: NOW,
  createdAt: NOW,
});

const FINDING = reconstituteReconciliationFinding({
  id: 6,
  runId: 5,
  ruleCode: "INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT",
  ruleVersion: 1,
  severity: "warning",
  subjectType: "payment",
  subjectId: 7,
  amountDeltaCents: 2500,
  currency: "EUR",
  status: "open",
  fingerprint: "0".repeat(64),
  createdAt: NOW,
  statusUpdatedAt: NOW,
});

const ACTION = reconstituteReconciliationAction({
  id: 8,
  findingId: 6,
  actionType: "resolve",
  fromStatus: "open",
  toStatus: "resolved",
  actorType: "operator",
  actorId: "auth0|test-admin",
  reason: "Matched statement",
  idempotencyKey: "action-key",
  requestFingerprint: "1".repeat(64),
  occurredAt: NOW,
  recordedAt: NOW,
});

const apps: FastifyInstance[] = [];

function app(
  overrides: Partial<HttpUseCases> = {},
  logLines?: string[],
): FastifyInstance {
  const unexpected = async () => {
    throw new Error("Unexpected route");
  };

  const dependencies = {
    createCustomer: unexpected,
    getCustomerById: unexpected,
    createContract: unexpected,
    getContractById: unexpected,
    recordPayment: unexpected,
    getPaymentById: unexpected,
    recordRefund: unexpected,
    getRefundById: unexpected,
    processStripeWebhook: unexpected,

    stripeWebhookClock: {
      now: () => NOW,
    },

    verifyStripeSignature: () => {
      throw new Error("Unexpected route");
    },

    accessTokenVerifier: TEST_ACCESS_TOKEN_VERIFIER,
    appendAuditEvent: async (input) =>
      reconstituteAuditEvent({
        id: 1,
        actorType: "user",
        recordedAt: NOW,
        ...input,
        reason: input.reason ?? null,
      }),

    recordExternalSourceEvent: async () => ({
      resource: EVENT,
      outcome: "created",
    }),

    getExternalSourceEventById: async () => EVENT,

    runReconciliation: async () => ({
      resource: RUN,
      outcome: "created",
    }),

    reconciliationPersistence: {
      execute: unexpected,
      getRunById: async () => RUN,
      listRuns: async () => [RUN],
      getFindingById: async () => ({
        finding: FINDING,
        evidence: [
          {
            entityType: "payment",
            entityId: 7,
            role: "subject",
          },
        ],
        actions: [ACTION],
      }),
      listFindings: async () => [FINDING],
    },

    actOnReconciliationFinding: async () => ({
      resource: ACTION,
      outcome: "created",
    }),

    ...overrides,
  } as HttpUseCases;
  const logger: BuildAppOptions | undefined = logLines
    ? {
        logger: {
          level: "info",
          stream: { write: (line) => logLines.push(line) },
        },
      }
    : undefined;
  const built = buildApp(dependencies, logger);

  authenticateTestRequests(built);

  apps.push(built);

  return built;
}

afterEach(async () => {
  await Promise.all(
    apps.splice(0).map((item) => item.close()),
  );
});

describe("Reconciliation HTTP interface", () => {
  it(
    "creates and replays external evidence with explicit UTF-8 serialization",
    async () => {
      let input: unknown;

      const first = await app({
        recordExternalSourceEvent: async (value) => {
          input = value;

          return {
            resource: EVENT,
            outcome: "created",
          };
        },
      }).inject({
        method: "POST",
        url: "/external-source-events",
        payload: {
          source: "test-bank",
          sourceEventId: "bank-4",
          eventType: "settlement_credit",
          amountCents: 2500,
          currency: "EUR",
          occurredAt: NOW.toISOString(),
          receivedAt: NOW.toISOString(),
          externalReference: "statement-4",
          internalPaymentId: 7,
          providerPaymentReference: "pi_test",
          rawPayload: '{"ok":true}',
          metadata: {
            batch: "golden",
          },
        },
      });

      expect(first.statusCode).toBe(201);

      expect(
        (input as { rawPayload: Buffer }).rawPayload.toString(),
      ).toBe('{"ok":true}');

      expect(first.json().rawPayload).toBe('{"ok":true}');

      const replay = await app({
        recordExternalSourceEvent: async () => ({
          resource: EVENT,
          outcome: "replayed",
        }),
      }).inject({
        method: "POST",
        url: "/external-source-events",
        payload: {
          source: "test-bank",
          sourceEventId: "bank-4",
          eventType: "settlement_credit",
          amountCents: 2500,
          currency: "EUR",
          occurredAt: NOW.toISOString(),
          receivedAt: NOW.toISOString(),
          externalReference: "statement-4",
          internalPaymentId: 7,
          providerPaymentReference: "pi_test",
          rawPayload: "x",
          metadata: {},
        },
      });

      expect(replay.statusCode).toBe(200);
    },
  );

  it(
    "gets external evidence and maps absence and conflicts",
    async () => {
      const existing = await app().inject({
        method: "GET",
        url: "/external-source-events/4",
      });

      expect(existing.json().id).toBe(4);

      const missing = await app({
        getExternalSourceEventById: async () => null,
      }).inject({
        method: "GET",
        url: "/external-source-events/99",
      });

      expect(missing.statusCode).toBe(404);

      expect(missing.json().error.code).toBe(
        "EXTERNAL_SOURCE_EVENT_NOT_FOUND",
      );

      const conflict = await app({
        recordExternalSourceEvent: async () => {
          throw new ExternalEventEvidenceConflict(
            "test-bank",
            "bank-4",
          );
        },
      }).inject({
        method: "POST",
        url: "/external-source-events",
        payload: {
          source: "test-bank",
          sourceEventId: "bank-4",
          eventType: "refund_debit",
          amountCents: 1,
          currency: "EUR",
          occurredAt: NOW.toISOString(),
          receivedAt: NOW.toISOString(),
          externalReference: "x",
          rawPayload: "x",
          metadata: {},
        },
      });

      expect(conflict.statusCode).toBe(409);

      expect(conflict.json().error.code).toBe(
        "EXTERNAL_EVENT_EVIDENCE_CONFLICT",
      );
    },
  );

  it(
    "creates and converges reconciliation Runs with Idempotency-Key",
    async () => {
      let key = "";
      const logLines: string[] = [];

      const created = await app({
        runReconciliation: async (value) => {
          key = value.idempotencyKey;

          return {
            resource: RUN,
            outcome: "created",
          };
        },
      }, logLines).inject({
        method: "POST",
        url: "/reconciliation/runs",
        headers: {
          "idempotency-key": "run-key",
        },
        payload: {
          cutoff: NOW.toISOString(),
        },
      });

      expect(created.statusCode).toBe(201);
      expect(key).toBe("run-key");
      const records = logLines.flatMap((chunk) =>
        chunk.split("\n").filter(Boolean).map((line) => JSON.parse(line)),
      );
      const event = records.find(
        (record) => record.event === "reconciliation_run_completed",
      );
      expect(event).toMatchObject({
        level: 30,
        runId: 5,
        outcome: "created",
      });
      expect(event.requestId).toBe(records[0].requestId);
      expect(logLines.join("")).not.toContain(NOW.toISOString());

      const replay = await app({
        runReconciliation: async () => ({
          resource: RUN,
          outcome: "replayed",
        }),
      }).inject({
        method: "POST",
        url: "/reconciliation/runs",
        headers: {
          "idempotency-key": "run-key-2",
        },
        payload: {
          cutoff: NOW.toISOString(),
        },
      });

      expect(replay.statusCode).toBe(200);
    },
  );

  it(
    "lists and gets Runs and Findings with exact filters and typed details",
    async () => {
      let filters: unknown;

      const persistence = {
        execute: async () => ({
          resource: RUN,
          outcome: "created" as const,
        }),

        getRunById: async () => RUN,

        listRuns: async () => [RUN],

        getFindingById: async () => ({
          finding: FINDING,
          evidence: [
            {
              entityType: "payment" as const,
              entityId: 7,
              role: "subject" as const,
            },
          ],
          actions: [ACTION],
        }),

        listFindings: async (value: unknown) => {
          filters = value;
          return [FINDING];
        },
      };

      const runs = await app({
        reconciliationPersistence: persistence,
      }).inject({
        method: "GET",
        url: "/reconciliation/runs?limit=2",
      });

      expect(runs.json()[0].id).toBe(5);

      const listed = await app({
        reconciliationPersistence: persistence,
      }).inject({
        method: "GET",
        url:
          "/reconciliation/findings?runId=5&status=open&severity=warning&ruleCode=INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT&limit=3",
      });

      expect(listed.statusCode).toBe(200);

      expect(filters).toEqual({
        runId: 5,
        status: "open",
        severity: "warning",
        ruleCode:
          "INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT",
        limit: 3,
      });

      const detail = (
        await app({
          reconciliationPersistence: persistence,
        }).inject({
          method: "GET",
          url: "/reconciliation/findings/6",
        })
      ).json();

      expect(detail.evidence).toEqual([
        {
          entityType: "payment",
          entityId: 7,
          role: "subject",
        },
      ]);

      expect(detail.actions[0].action).toBe("resolve");
    },
  );

  it(
    "derives the reconciliation actor from the authenticated principal",
    async () => {
      let receivedCommand:
        | Parameters<
            NonNullable<
              HttpUseCases["actOnReconciliationFinding"]
            >
          >[0]
        | undefined;

      const created = await app({
        actOnReconciliationFinding: async (command) => {
          receivedCommand = command;

          return {
            resource: ACTION,
            outcome: "created",
          };
        },
      }).inject({
        method: "POST",
        url: "/reconciliation/findings/6/actions",
        headers: {
          "idempotency-key": "action-key",
        },
        payload: {
          action: "resolve",
          reason: "Matched statement",
          occurredAt: NOW.toISOString(),
        },
      });

      expect(created.statusCode).toBe(201);

      expect(receivedCommand).toMatchObject({
        idempotencyKey: "action-key",
        findingId: 6,
        actionType: "resolve",
        actorId: "auth0|test-admin",
        reason: "Matched statement",
      });

      expect(receivedCommand?.occurredAt).toEqual(NOW);

      expect(created.json().toStatus).toBe("resolved");
      expect(created.json().actorId).toBe(
        "auth0|test-admin",
      );

      const replay = await app({
        actOnReconciliationFinding: async () => ({
          resource: ACTION,
          outcome: "replayed",
        }),
      }).inject({
        method: "POST",
        url: "/reconciliation/findings/6/actions",
        headers: {
          "idempotency-key": "action-key",
        },
        payload: {
          action: "resolve",
          reason: "Matched statement",
          occurredAt: NOW.toISOString(),
        },
      });

      expect(replay.statusCode).toBe(200);

      for (const [error, code] of [
        [
          new ReconciliationFindingNotFoundError(6),
          "RECONCILIATION_FINDING_NOT_FOUND",
        ],
        [
          new IllegalReconciliationTransition(
            6,
            "resolved",
            "resolve",
          ),
          "ILLEGAL_RECONCILIATION_TRANSITION",
        ],
      ] as const) {
        const response = await app({
          actOnReconciliationFinding: async () => {
            throw error;
          },
        }).inject({
          method: "POST",
          url: "/reconciliation/findings/6/actions",
          headers: {
            "idempotency-key": "action-error",
          },
          payload: {
            action: "resolve",
            reason: "Matched statement",
            occurredAt: NOW.toISOString(),
          },
        });

        expect(response.json().error.code).toBe(code);
      }
    },
  );

  it(
    "rejects malformed transport data and client-supplied reconciliation actors",
    async () => {
      const response = await app().inject({
        method: "POST",
        url: "/reconciliation/runs",
        headers: {
          "idempotency-key": "x",
        },
        payload: {
          cutoff: "not-an-instant",
          extra: true,
        },
      });

      expect(response.statusCode).toBe(400);

      expect(response.json().error.code).toBe(
        "INVALID_REQUEST",
      );

      const invalidFindings = await app().inject({
        method: "GET",
        url: "/reconciliation/findings?status=unknown",
      });

      expect(invalidFindings.statusCode).toBe(400);

      const forgedActor = await app().inject({
        method: "POST",
        url: "/reconciliation/findings/6/actions",
        headers: {
          "idempotency-key": "forged-actor",
        },
        payload: {
          action: "resolve",
          actorId: "somebody-else",
          reason: "Attempted impersonation",
          occurredAt: NOW.toISOString(),
        },
      });

      expect(forgedActor.statusCode).toBe(400);

      expect(forgedActor.json().error.code).toBe(
        "INVALID_REQUEST",
      );
    },
  );
});
