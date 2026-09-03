import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { FindingReadModel } from "../../reconciliation/application/reconciliation-persistence.js";
import type { ExternalSourceEvent } from "../../reconciliation/domain/external-source-event.js";
import type { ReconciliationAction } from "../../reconciliation/domain/reconciliation-action.js";
import type { ReconciliationFinding } from "../../reconciliation/domain/reconciliation-finding.js";
import type { ReconciliationRun } from "../../reconciliation/domain/reconciliation-run.js";
import { RECONCILIATION_RULE_CODES } from "../../reconciliation/domain/reconciliation-vocabulary.js";
import type { HttpUseCases } from "./app.js";
import { PublicHttpError } from "./error-handler.js";
import { requireIdempotencyKey } from "./request-validation.js";
import {
  OPERATOR_AUTH_POLICY,
  VIEWER_AUTH_POLICY,
} from "./security/auth-policies.js";
import { auditExternalMutation, auditIdempotentMutation } from "./audit-support.js";

type ReconciliationHttpDependencies = Required<
  Pick<
    HttpUseCases,
    | "recordExternalSourceEvent"
    | "getExternalSourceEventById"
    | "runReconciliation"
    | "reconciliationPersistence"
    | "actOnReconciliationFinding"
    | "appendAuditEvent"
  >
>;

const idParams = z.strictObject({
  id: z.string().regex(/^\d+$/),
});

const dateTime = z.iso.datetime({
  offset: true,
});

const externalBody = z.strictObject({
  source: z.string().min(1).max(64),
  sourceEventId: z.string().min(1).max(255),
  eventType: z.enum([
    "settlement_credit",
    "refund_debit",
  ]),
  amountCents: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER),
  currency: z.literal("EUR"),
  occurredAt: dateTime,
  receivedAt: dateTime,
  externalReference: z
    .string()
    .min(1)
    .max(255),
  internalPaymentId: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  internalRefundId: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .nullable()
    .optional(),
  providerPaymentReference: z
    .string()
    .min(1)
    .max(255)
    .nullable()
    .optional(),
  rawPayload: z
    .string()
    .min(1)
    .refine(
      (value) =>
        Buffer.byteLength(value, "utf8") <=
        1_048_576,
    ),
  metadata: z.record(
    z.string(),
    z.unknown(),
  ),
});

const runBody = z.strictObject({
  cutoff: dateTime,
});

const listQuery = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(50),
});

const findingsQuery = z.strictObject({
  runId: z.coerce
    .number()
    .int()
    .positive()
    .optional(),
  status: z
    .enum([
      "open",
      "acknowledged",
      "resolved",
      "ignored",
    ])
    .optional(),
  severity: z
    .enum(["warning", "critical"])
    .optional(),
  ruleCode: z
    .enum(RECONCILIATION_RULE_CODES)
    .optional(),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(100)
    .default(50),
});

const actionBody = z.strictObject({
  action: z.enum([
    "acknowledge",
    "resolve",
    "ignore",
  ]),
  reason: z.string().min(1).max(1000),
  occurredAt: dateTime,
});

const externalJson = (
  event: ExternalSourceEvent,
) => ({
  id: event.id,
  source: event.source,
  sourceEventId: event.sourceEventId,
  eventType: event.eventType,
  amountCents: event.amountCents,
  currency: event.currency,
  occurredAt:
    event.occurredAt.toISOString(),
  receivedAt:
    event.receivedAt.toISOString(),
  externalReference:
    event.externalReference,
  internalPaymentId:
    event.internalPaymentId,
  internalRefundId:
    event.internalRefundId,
  providerPaymentReference:
    event.providerPaymentReference,
  rawPayload:
    event.rawPayload.toString("utf8"),
  metadata: event.metadata,
  createdAt:
    event.createdAt.toISOString(),
});

const runJson = (
  run: ReconciliationRun,
) => ({
  id: run.id,
  scopeType: run.scopeType,
  scopeId: run.scopeId,
  cutoff: run.cutoff.toISOString(),
  ruleSetVersion:
    run.ruleSetVersion,
  runFingerprint:
    run.runFingerprint,
  status: run.status,
  executedAt:
    run.executedAt.toISOString(),
  createdAt:
    run.createdAt.toISOString(),
});

const findingJson = (
  finding: ReconciliationFinding,
) => ({
  id: finding.id,
  runId: finding.runId,
  ruleCode: finding.ruleCode,
  ruleVersion: finding.ruleVersion,
  severity: finding.severity,
  subjectType: finding.subjectType,
  subjectId: finding.subjectId,
  amountDeltaCents:
    finding.amountDeltaCents,
  currency: finding.currency,
  status: finding.status,
  fingerprint: finding.fingerprint,
  createdAt:
    finding.createdAt.toISOString(),
  statusUpdatedAt:
    finding.statusUpdatedAt.toISOString(),
});

const actionJson = (
  action: ReconciliationAction,
) => ({
  id: action.id,
  findingId: action.findingId,
  action: action.actionType,
  fromStatus: action.fromStatus,
  toStatus: action.toStatus,
  actorType: action.actorType,
  actorId: action.actorId,
  reason: action.reason,
  occurredAt:
    action.occurredAt.toISOString(),
  recordedAt:
    action.recordedAt.toISOString(),
});

const findingDetailJson = (
  model: FindingReadModel,
) => ({
  ...findingJson(model.finding),
  evidence: model.evidence.map(
    (item) => ({
      entityType: item.entityType,
      entityId: item.entityId,
      role: item.role,
    }),
  ),
  actions:
    model.actions.map(actionJson),
});

export function registerReconciliationRoutes(
  app: FastifyInstance,
  dependencies: ReconciliationHttpDependencies,
): void {
  app.post(
    "/external-source-events",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const body = externalBody.parse(
        request.body,
      );

      const result =
        await dependencies.recordExternalSourceEvent({
          ...body,
          internalPaymentId:
            body.internalPaymentId ?? null,
          internalRefundId:
            body.internalRefundId ?? null,
          providerPaymentReference:
            body.providerPaymentReference ??
            null,
          occurredAt: new Date(
            body.occurredAt,
          ),
          receivedAt: new Date(
            body.receivedAt,
          ),
          rawPayload: Buffer.from(
            body.rawPayload,
            "utf8",
          ),
        });
      await auditExternalMutation(dependencies,request,{action:"external_source_event.record",resourceType:"external_source_event",resourceId:result.resource.id,outcome:result.outcome,source:body.source,sourceEventId:body.sourceEventId});

      return reply
        .status(
          result.outcome === "created"
            ? 201
            : 200,
        )
        .send(
          externalJson(result.resource),
        );
    },
  );

  app.get(
    "/external-source-events/:id",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const { id } = idParams.parse(
        request.params,
      );

      const event =
        await dependencies.getExternalSourceEventById(
          Number(id),
        );

      if (!event) {
        throw new PublicHttpError(
          404,
          "EXTERNAL_SOURCE_EVENT_NOT_FOUND",
          "External source event not found",
        );
      }

      return reply.send(
        externalJson(event),
      );
    },
  );

  app.post(
    "/reconciliation/runs",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
        rateLimit: {
          max: 10,
          timeWindow: "1 minute",
        },
      },
    },
    async (request, reply) => {
      const body = runBody.parse(
        request.body,
      );

      const result =
        await dependencies.runReconciliation({
          idempotencyKey:
            requireIdempotencyKey(request),
          cutoff: new Date(
            body.cutoff,
          ),
        });
      const idempotencyKey=requireIdempotencyKey(request);
      await auditIdempotentMutation(dependencies,request,{action:"reconciliation.run",resourceType:"reconciliation_run",resourceId:result.resource.id,outcome:result.outcome,idempotencyKey});

      return reply
        .status(
          result.outcome === "created"
            ? 201
            : 200,
        )
        .send(runJson(result.resource));
    },
  );

  app.get(
    "/reconciliation/runs",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const { limit } =
        listQuery.parse(
          request.query,
        );

      return reply.send(
        (
          await dependencies.reconciliationPersistence.listRuns(
            limit,
          )
        ).map(runJson),
      );
    },
  );

  app.get(
    "/reconciliation/runs/:id",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const { id } = idParams.parse(
        request.params,
      );

      const run =
        await dependencies.reconciliationPersistence.getRunById(
          Number(id),
        );

      if (!run) {
        throw new PublicHttpError(
          404,
          "RECONCILIATION_RUN_NOT_FOUND",
          "Reconciliation Run not found",
        );
      }

      return reply.send(runJson(run));
    },
  );

  app.get(
    "/reconciliation/findings",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const query =
        findingsQuery.parse(
          request.query,
        );

      const filters = {
        limit: query.limit,
        ...(query.runId === undefined
          ? {}
          : {
              runId: query.runId,
            }),
        ...(query.status === undefined
          ? {}
          : {
              status: query.status,
            }),
        ...(query.severity === undefined
          ? {}
          : {
              severity:
                query.severity,
            }),
        ...(query.ruleCode === undefined
          ? {}
          : {
              ruleCode:
                query.ruleCode,
            }),
      };

      return reply.send(
        (
          await dependencies.reconciliationPersistence.listFindings(
            filters,
          )
        ).map(findingJson),
      );
    },
  );

  app.get(
    "/reconciliation/findings/:id",
    {
      config: {
        auth: VIEWER_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const { id } = idParams.parse(
        request.params,
      );

      const finding =
        await dependencies.reconciliationPersistence.getFindingById(
          Number(id),
        );

      if (!finding) {
        throw new PublicHttpError(
          404,
          "RECONCILIATION_FINDING_NOT_FOUND",
          "Reconciliation Finding not found",
        );
      }

      return reply.send(
        findingDetailJson(finding),
      );
    },
  );

  app.post(
    "/reconciliation/findings/:id/actions",
    {
      config: {
        auth: OPERATOR_AUTH_POLICY,
      },
    },
    async (request, reply) => {
      const { id } = idParams.parse(
        request.params,
      );

      const body = actionBody.parse(
        request.body,
      );

      if (request.principal === null) {
        throw new PublicHttpError(
          401,
          "UNAUTHORIZED",
          "Authentication required",
        );
      }

      const result =
        await dependencies.actOnReconciliationFinding({
          idempotencyKey:
            requireIdempotencyKey(request),
          findingId: Number(id),
          actionType: body.action,
          actorId:
            request.principal.subject,
          reason: body.reason,
          occurredAt: new Date(
            body.occurredAt,
          ),
        });
      const idempotencyKey=requireIdempotencyKey(request);
      await auditIdempotentMutation(dependencies,request,{action:`reconciliation.finding.${body.action}`,resourceType:"reconciliation_finding",resourceId:Number(id),outcome:result.outcome,idempotencyKey,reason:body.reason});

      return reply
        .status(
          result.outcome === "created"
            ? 201
            : 200,
        )
        .send(
          actionJson(result.resource),
        );
    },
  );
}
