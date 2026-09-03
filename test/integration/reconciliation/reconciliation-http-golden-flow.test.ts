import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { reconstituteAuditEvent } from "../../../src/audit/domain/audit-event.js";
import {
  buildApp,
  type HttpUseCases,
} from "../../../src/interface/http/app.js";
import {
  createDatabase,
  type Database,
} from "../../../src/persistence/database.js";
import { actOnReconciliationFindingUseCase } from "../../../src/reconciliation/application/act-on-reconciliation-finding.js";
import { getExternalSourceEventByIdUseCase } from "../../../src/reconciliation/application/get-external-source-event-by-id.js";
import { recordExternalSourceEventUseCase } from "../../../src/reconciliation/application/record-external-source-event.js";
import { runReconciliationUseCase } from "../../../src/reconciliation/application/run-reconciliation.js";
import { PostgresExternalSourceEventPersistence } from "../../../src/reconciliation/persistence/postgres-external-source-event-persistence.js";
import { PostgresReconciliationActionPersistence } from "../../../src/reconciliation/persistence/postgres-reconciliation-action-persistence.js";
import { PostgresReconciliationPersistence } from "../../../src/reconciliation/persistence/postgres-reconciliation-persistence.js";
import {
  authenticateTestRequests,
  TEST_ACCESS_TOKEN_VERIFIER,
} from "../../helpers/http-auth.js";

const RECORDED_AT = new Date(
  "2026-09-02T10:00:00.000Z",
);

const CUTOFF = "2026-09-02T12:00:00.000Z";

describe.sequential(
  "Reconciliation PostgreSQL/HTTP golden flow",
  () => {
    let container: StartedPostgreSqlContainer;
    let database: Database;
    let app: FastifyInstance;

    beforeAll(async () => {
      container = await new PostgreSqlContainer(
        "postgres:18.4",
      ).start();

      database = createDatabase({
        connectionString:
          container.getConnectionUri(),
      });

      await migrate(database.client, {
        migrationsFolder: "./drizzle",
      });

      const clock = {
        now: () => new Date(RECORDED_AT),
      };

      const external =
        new PostgresExternalSourceEventPersistence(
          database,
        );

      const reconciliation =
        new PostgresReconciliationPersistence(
          database,
        );

      const action =
        new PostgresReconciliationActionPersistence(
          database,
        );

      const unexpected = async () => {
        throw new Error("Unexpected route");
      };

      app = buildApp({
        createCustomer: unexpected,
        getCustomerById: unexpected,
        createContract: unexpected,
        getContractById: unexpected,
        recordPayment: unexpected,
        getPaymentById: unexpected,
        recordRefund: unexpected,
        getRefundById: unexpected,
        processStripeWebhook: unexpected,

        stripeWebhookClock: clock,

        verifyStripeSignature: () => {
          throw new Error("Unexpected route");
        },

        accessTokenVerifier:
          TEST_ACCESS_TOKEN_VERIFIER,

        appendAuditEvent: async (input) =>
          reconstituteAuditEvent({
            id: 1,
            actorType: "user",
            recordedAt: clock.now(),
            ...input,
            reason: input.reason ?? null,
          }),

        recordExternalSourceEvent:
          recordExternalSourceEventUseCase({
            clock,
            persistence: external,
          }),

        getExternalSourceEventById:
          getExternalSourceEventByIdUseCase(
            external,
          ),

        runReconciliation:
          runReconciliationUseCase({
            clock,
            persistence: reconciliation,
          }),

        reconciliationPersistence:
          reconciliation,

        actOnReconciliationFinding:
          actOnReconciliationFindingUseCase({
            clock,
            persistence: action,
          }),
      } as HttpUseCases);

      authenticateTestRequests(app);
    }, 120_000);

    beforeEach(async () => {
      await database.client.execute(sql`
        truncate
          reconciliation_actions,
          reconciliation_finding_evidence,
          reconciliation_findings,
          reconciliation_runs,
          external_source_events,
          stripe_webhook_events,
          ledger_entries,
          refund_allocations,
          refunds,
          payment_allocations,
          payments,
          installments,
          contracts,
          idempotency_records,
          customers
        restart identity cascade
      `);

      await database.client.execute(sql`
        insert into customers (
          id,
          display_name,
          created_at
        )
        values (
          1,
          'Golden Customer',
          '2026-09-01T08:00:00Z'
        );

        insert into contracts (
          id,
          customer_id,
          total_amount_cents,
          currency,
          installment_count,
          first_due_date,
          status,
          created_at
        )
        values (
          1,
          1,
          10000,
          'EUR',
          1,
          '2026-09-01',
          'active',
          '2026-09-01T08:00:00Z'
        );

        insert into installments (
          id,
          contract_id,
          position,
          amount_cents,
          due_date,
          status,
          created_at
        )
        values (
          1,
          1,
          1,
          10000,
          '2026-09-01',
          'partially_paid',
          '2026-09-01T08:00:00Z'
        );

        insert into payments (
          id,
          contract_id,
          amount_cents,
          received_at,
          created_at
        )
        values (
          1,
          1,
          10000,
          '2026-09-01T09:00:00Z',
          '2026-09-01T09:00:01Z'
        );

        insert into payment_allocations (
          payment_id,
          installment_id,
          contract_id,
          amount_cents
        )
        values (
          1,
          1,
          1,
          10000
        );

        insert into refunds (
          id,
          payment_id,
          amount_cents,
          refunded_at,
          created_at
        )
        values (
          1,
          1,
          1500,
          '2026-09-01T10:00:00Z',
          '2026-09-01T10:00:01Z'
        );

        insert into refund_allocations (
          refund_id,
          payment_id,
          installment_id,
          amount_cents
        )
        values (
          1,
          1,
          1,
          1500
        );

        insert into ledger_entries (
          id,
          payment_id,
          effect_type,
          amount_cents,
          currency,
          event_at,
          recorded_at
        )
        values (
          1,
          1,
          'payment_recorded',
          10000,
          'EUR',
          '2026-09-01T09:00:00Z',
          '2026-09-01T09:00:01Z'
        );

        insert into ledger_entries (
          id,
          refund_id,
          effect_type,
          amount_cents,
          currency,
          event_at,
          recorded_at
        )
        values (
          2,
          1,
          'refund_recorded',
          1500,
          'EUR',
          '2026-09-01T10:00:00Z',
          '2026-09-01T10:00:01Z'
        );
      `);

      await database.client.execute(sql`
        insert into stripe_webhook_events (
          id,
          stripe_event_id,
          event_type,
          stripe_payment_intent_id,
          raw_payload,
          received_at,
          status,
          processed_at,
          payment_id
        )
        values (
          1,
          'evt_golden1',
          'payment_intent.succeeded',
          'pi_golden1',
          ${Buffer.from('{"id":"evt_golden1"}')},
          '2026-09-01T09:00:00Z',
          'processed',
          '2026-09-01T09:00:02Z',
          1
        )
      `);
    });

    afterAll(async () => {
      await app?.close();
      await database?.close();
      await container?.stop();
    }, 30_000);

    it(
      "proves exact evidence, Run, Finding, resolution history, and replay",
      async () => {
        const evidencePayload = {
          source: "simulated_bank",
          sourceEventId: "bank-golden-1",
          eventType: "settlement_credit",
          amountCents: 10_000,
          currency: "EUR",
          occurredAt:
            "2026-09-01T11:00:00.000Z",
          receivedAt:
            "2026-09-01T11:00:01.000Z",
          externalReference:
            "statement-golden-1",
          internalPaymentId: 1,
          providerPaymentReference:
            "pi_golden1",
          rawPayload:
            '{"id":"bank-golden-1","amount":10000}',
          metadata: {
            fixture: "golden",
          },
        };

        const createdEvidence =
          await app.inject({
            method: "POST",
            url: "/external-source-events",
            payload: evidencePayload,
          });

        expect(
          createdEvidence.statusCode,
        ).toBe(201);

        const evidenceId =
          createdEvidence.json().id as number;

        const replayEvidence =
          await app.inject({
            method: "POST",
            url: "/external-source-events",
            payload: evidencePayload,
          });

        expect(
          replayEvidence.statusCode,
        ).toBe(200);

        expect(
          replayEvidence.json().id,
        ).toBe(evidenceId);

        const createdRun =
          await app.inject({
            method: "POST",
            url: "/reconciliation/runs",
            headers: {
              "idempotency-key":
                "golden-run-1",
            },
            payload: {
              cutoff: CUTOFF,
            },
          });

        expect(
          createdRun.statusCode,
        ).toBe(201);

        const runId =
          createdRun.json().id as number;

        const replayRun =
          await app.inject({
            method: "POST",
            url: "/reconciliation/runs",
            headers: {
              "idempotency-key":
                "golden-run-1",
            },
            payload: {
              cutoff: CUTOFF,
            },
          });

        const convergedRun =
          await app.inject({
            method: "POST",
            url: "/reconciliation/runs",
            headers: {
              "idempotency-key":
                "golden-run-2",
            },
            payload: {
              cutoff: CUTOFF,
            },
          });

        expect([
          replayRun.statusCode,
          convergedRun.statusCode,
        ]).toEqual([200, 200]);

        expect([
          replayRun.json().id,
          convergedRun.json().id,
        ]).toEqual([runId, runId]);

        const listed = await app.inject({
          method: "GET",
          url:
            `/reconciliation/findings?runId=${runId}`,
        });

        expect(
          listed.statusCode,
        ).toBe(200);

        expect(
          listed.json(),
        ).toHaveLength(1);

        expect(
          createdEvidence.json().amountCents,
        ).toBe(10_000);

        expect(
          listed.json()[0],
        ).toMatchObject({
          ruleCode:
            "INTERNAL_REFUND_MISSING_BANK_OUTFLOW",
          subjectType: "refund",
          subjectId: 1,
          amountDeltaCents: null,
          currency: "EUR",
          status: "open",
        });

        const findingId =
          listed.json()[0].id as number;

        const detail = await app.inject({
          method: "GET",
          url:
            `/reconciliation/findings/${findingId}`,
        });

        expect(
          detail.json().evidence,
        ).toEqual(
          expect.arrayContaining([
            {
              entityType: "refund",
              entityId: 1,
              role: "subject",
            },
            {
              entityType: "payment",
              entityId: 1,
              role: "internal_fact",
            },
            {
              entityType: "ledger_entry",
              entityId: 2,
              role: "internal_effect",
            },
          ]),
        );

        const actionPayload = {
          action: "resolve",
          reason:
            "Bank outflow verified outside the simulated feed",
          occurredAt:
            "2026-09-02T11:00:00.000Z",
        };

        const action = await app.inject({
          method: "POST",
          url:
            `/reconciliation/findings/${findingId}/actions`,
          headers: {
            "idempotency-key":
              "golden-action-1",
          },
          payload: actionPayload,
        });

        const actionReplay =
          await app.inject({
            method: "POST",
            url:
              `/reconciliation/findings/${findingId}/actions`,
            headers: {
              "idempotency-key":
                "golden-action-1",
            },
            payload: actionPayload,
          });

        expect([
          action.statusCode,
          actionReplay.statusCode,
        ]).toEqual([201, 200]);

        expect(
          actionReplay.json().id,
        ).toBe(action.json().id);

        expect(
          action.json().actorId,
        ).toBe("auth0|test-admin");

        const resolved = await app.inject({
          method: "GET",
          url:
            `/reconciliation/findings/${findingId}`,
        });

        expect(
          resolved.json(),
        ).toMatchObject({
          status: "resolved",
          actions: [
            {
              action: "resolve",
              fromStatus: "open",
              toStatus: "resolved",
              actorId:
                "auth0|test-admin",
            },
          ],
        });
      },
    );
  },
);
