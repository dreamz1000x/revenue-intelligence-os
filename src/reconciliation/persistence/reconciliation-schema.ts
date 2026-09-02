import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

import { contracts, installments } from "../../contracts/persistence/contract-schema.js";
import { ledgerEntries } from "../../ledger/persistence/ledger-schema.js";
import { payments } from "../../payments/persistence/payment-schema.js";
import { refunds } from "../../refunds/persistence/refund-schema.js";
import { stripeWebhookEvents } from "../../stripe/persistence/stripe-webhook-event-schema.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const instant = (name: string) => timestamp(name, { withTimezone: true, precision: 3, mode: "date" });

export const externalSourceEvents = pgTable(
  "external_source_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    source: varchar("source", { length: 64 }).notNull(),
    sourceEventId: varchar("source_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 32 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    occurredAt: instant("occurred_at").notNull(),
    receivedAt: instant("received_at").notNull(),
    externalReference: varchar("external_reference", { length: 255 }).notNull(),
    internalPaymentId: integer("internal_payment_id"),
    internalRefundId: integer("internal_refund_id"),
    providerPaymentReference: varchar("provider_payment_reference", { length: 255 }),
    rawPayload: bytea("raw_payload").notNull(),
    metadata: jsonb("metadata").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("external_source_events_source_event_id_unique").on(table.source, table.sourceEventId),
    foreignKey({ name: "external_source_events_payment_id_payments_id_fk", columns: [table.internalPaymentId], foreignColumns: [payments.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "external_source_events_refund_id_refunds_id_fk", columns: [table.internalRefundId], foreignColumns: [refunds.id] }).onDelete("no action").onUpdate("no action"),
    check("external_source_events_type_allowed", sql`${table.eventType} in ('settlement_credit', 'refund_debit')`),
    check("external_source_events_amount_positive", sql`${table.amountCents} > 0`),
    check("external_source_events_amount_safe_integer", sql`${table.amountCents} <= 9007199254740991`),
    check("external_source_events_currency_eur", sql`${table.currency} = 'EUR'`),
    check("external_source_events_source_nonblank", sql`btrim(${table.source}) <> ''`),
    check("external_source_events_source_event_id_nonblank", sql`btrim(${table.sourceEventId}) <> ''`),
    check("external_source_events_external_reference_nonblank", sql`btrim(${table.externalReference}) <> ''`),
    check("external_source_events_provider_reference_nonblank", sql`${table.providerPaymentReference} is null or btrim(${table.providerPaymentReference}) <> ''`),
    check("external_source_events_raw_payload_size", sql`octet_length(${table.rawPayload}) between 1 and 1048576`),
    check("external_source_events_metadata_object", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check("external_source_events_metadata_size", sql`octet_length(${table.metadata}::text) <= 16384`),
    check("external_source_events_reference_consistency", sql`(
      (${table.eventType} = 'settlement_credit' and ${table.internalRefundId} is null)
      or (${table.eventType} = 'refund_debit' and ${table.internalPaymentId} is null and ${table.internalRefundId} is not null and ${table.providerPaymentReference} is null)
    )`),
    index("external_source_events_created_at_idx").on(table.createdAt),
    index("external_source_events_internal_payment_id_idx").on(table.internalPaymentId),
    index("external_source_events_internal_refund_id_idx").on(table.internalRefundId),
    index("external_source_events_provider_payment_reference_idx").on(table.providerPaymentReference),
  ],
);

export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    scopeType: varchar("scope_type", { length: 16 }).notNull(),
    scopeId: integer("scope_id"),
    cutoff: instant("cutoff").notNull(),
    ruleSetVersion: varchar("rule_set_version", { length: 32 }).notNull(),
    runFingerprint: varchar("run_fingerprint", { length: 64 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    executedAt: instant("executed_at").notNull(),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    unique("reconciliation_runs_fingerprint_unique").on(table.runFingerprint),
    check("reconciliation_runs_global_scope", sql`${table.scopeType} = 'global' and ${table.scopeId} is null`),
    check("reconciliation_runs_rule_set_v1", sql`${table.ruleSetVersion} = 'reconciliation-v1'`),
    check("reconciliation_runs_status_completed", sql`${table.status} = 'completed'`),
    check("reconciliation_runs_fingerprint_format", sql`${table.runFingerprint} ~ '^[0-9a-f]{64}$'`),
    index("reconciliation_runs_cutoff_idx").on(table.cutoff),
  ],
);

export const reconciliationFindings = pgTable(
  "reconciliation_findings",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    runId: integer("run_id").notNull(),
    ruleCode: varchar("rule_code", { length: 64 }).notNull(),
    ruleVersion: integer("rule_version").notNull(),
    severity: varchar("severity", { length: 16 }).notNull(),
    subjectType: varchar("subject_type", { length: 32 }).notNull(),
    subjectId: integer("subject_id").notNull(),
    amountDeltaCents: bigint("amount_delta_cents", { mode: "bigint" }),
    currency: varchar("currency", { length: 3 }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    fingerprint: varchar("fingerprint", { length: 64 }).notNull(),
    createdAt: instant("created_at").notNull(),
    statusUpdatedAt: instant("status_updated_at").notNull(),
  },
  (table) => [
    foreignKey({ name: "reconciliation_findings_run_id_runs_id_fk", columns: [table.runId], foreignColumns: [reconciliationRuns.id] }).onDelete("no action").onUpdate("no action"),
    unique("reconciliation_findings_run_fingerprint_unique").on(table.runId, table.fingerprint),
    check("reconciliation_findings_rule_allowed", sql`${table.ruleCode} in ('STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT', 'INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT', 'BANK_SETTLEMENT_AMOUNT_MISMATCH', 'INTERNAL_REFUND_MISSING_BANK_OUTFLOW', 'ORPHAN_BANK_MOVEMENT')`),
    check("reconciliation_findings_rule_version_one", sql`${table.ruleVersion} = 1`),
    check("reconciliation_findings_severity_allowed", sql`${table.severity} in ('warning', 'critical')`),
    check("reconciliation_findings_subject_allowed", sql`${table.subjectType} in ('payment', 'refund', 'stripe_webhook_event', 'external_source_event')`),
    check("reconciliation_findings_rule_semantics", sql`(
      (${table.ruleCode} = 'STRIPE_SUCCESS_MISSING_INTERNAL_PAYMENT' and ${table.severity} = 'critical' and ${table.subjectType} = 'stripe_webhook_event')
      or (${table.ruleCode} = 'INTERNAL_PAYMENT_MISSING_BANK_SETTLEMENT' and ${table.severity} = 'warning' and ${table.subjectType} = 'payment')
      or (${table.ruleCode} = 'BANK_SETTLEMENT_AMOUNT_MISMATCH' and ${table.severity} = 'critical' and ${table.subjectType} = 'payment')
      or (${table.ruleCode} = 'INTERNAL_REFUND_MISSING_BANK_OUTFLOW' and ${table.severity} = 'warning' and ${table.subjectType} = 'refund')
      or (${table.ruleCode} = 'ORPHAN_BANK_MOVEMENT' and ${table.severity} = 'warning' and ${table.subjectType} = 'external_source_event')
    )`),
    check("reconciliation_findings_subject_id_positive", sql`${table.subjectId} > 0`),
    check("reconciliation_findings_delta_safe_integer", sql`${table.amountDeltaCents} is null or ${table.amountDeltaCents} between -9007199254740991 and 9007199254740991`),
    check("reconciliation_findings_currency_eur", sql`${table.currency} = 'EUR'`),
    check("reconciliation_findings_status_allowed", sql`${table.status} in ('open', 'acknowledged', 'resolved', 'ignored')`),
    check("reconciliation_findings_fingerprint_format", sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
    index("reconciliation_findings_run_severity_rule_idx").on(table.runId, table.severity, table.ruleCode),
    index("reconciliation_findings_status_severity_idx").on(table.status, table.severity),
    index("reconciliation_findings_subject_idx").on(table.subjectType, table.subjectId),
  ],
);

export const reconciliationFindingEvidence = pgTable(
  "reconciliation_finding_evidence",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    findingId: integer("finding_id").notNull(),
    role: varchar("role", { length: 32 }).notNull(),
    contractId: integer("contract_id"), installmentId: integer("installment_id"),
    paymentId: integer("payment_id"), refundId: integer("refund_id"),
    ledgerEntryId: integer("ledger_entry_id"), stripeWebhookEventId: integer("stripe_webhook_event_id"),
    externalSourceEventId: integer("external_source_event_id"),
    createdAt: instant("created_at").notNull(),
  },
  (table) => [
    foreignKey({ name: "reconciliation_evidence_finding_id_findings_id_fk", columns: [table.findingId], foreignColumns: [reconciliationFindings.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_contract_id_contracts_id_fk", columns: [table.contractId], foreignColumns: [contracts.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_installment_id_installments_id_fk", columns: [table.installmentId], foreignColumns: [installments.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_payment_id_payments_id_fk", columns: [table.paymentId], foreignColumns: [payments.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_refund_id_refunds_id_fk", columns: [table.refundId], foreignColumns: [refunds.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_ledger_id_ledger_entries_id_fk", columns: [table.ledgerEntryId], foreignColumns: [ledgerEntries.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_stripe_id_stripe_events_id_fk", columns: [table.stripeWebhookEventId], foreignColumns: [stripeWebhookEvents.id] }).onDelete("no action").onUpdate("no action"),
    foreignKey({ name: "reconciliation_evidence_external_id_external_events_id_fk", columns: [table.externalSourceEventId], foreignColumns: [externalSourceEvents.id] }).onDelete("no action").onUpdate("no action"),
    check("reconciliation_evidence_role_allowed", sql`${table.role} in ('subject', 'internal_fact', 'internal_effect', 'provider_evidence', 'external_evidence', 'contract_context')`),
    check("reconciliation_evidence_exactly_one_reference", sql`num_nonnulls(${table.contractId}, ${table.installmentId}, ${table.paymentId}, ${table.refundId}, ${table.ledgerEntryId}, ${table.stripeWebhookEventId}, ${table.externalSourceEventId}) = 1`),
    uniqueIndex("reconciliation_evidence_finding_contract_unique").on(table.findingId, table.contractId).where(sql`${table.contractId} is not null`),
    uniqueIndex("reconciliation_evidence_finding_installment_unique").on(table.findingId, table.installmentId).where(sql`${table.installmentId} is not null`),
    uniqueIndex("reconciliation_evidence_finding_payment_unique").on(table.findingId, table.paymentId).where(sql`${table.paymentId} is not null`),
    uniqueIndex("reconciliation_evidence_finding_refund_unique").on(table.findingId, table.refundId).where(sql`${table.refundId} is not null`),
    uniqueIndex("reconciliation_evidence_finding_ledger_unique").on(table.findingId, table.ledgerEntryId).where(sql`${table.ledgerEntryId} is not null`),
    uniqueIndex("reconciliation_evidence_finding_stripe_unique").on(table.findingId, table.stripeWebhookEventId).where(sql`${table.stripeWebhookEventId} is not null`),
    uniqueIndex("reconciliation_evidence_finding_external_unique").on(table.findingId, table.externalSourceEventId).where(sql`${table.externalSourceEventId} is not null`),
  ],
);

export const reconciliationActions = pgTable(
  "reconciliation_actions",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(), findingId: integer("finding_id").notNull(),
    actionType: varchar("action_type", { length: 16 }).notNull(), fromStatus: varchar("from_status", { length: 16 }).notNull(), toStatus: varchar("to_status", { length: 16 }).notNull(),
    actorType: varchar("actor_type", { length: 16 }).notNull(), actorId: varchar("actor_id", { length: 128 }).notNull(), reason: varchar("reason", { length: 1000 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(), requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    occurredAt: instant("occurred_at").notNull(), recordedAt: instant("recorded_at").notNull(),
  },
  (table) => [
    foreignKey({ name: "reconciliation_actions_finding_id_findings_id_fk", columns: [table.findingId], foreignColumns: [reconciliationFindings.id] }).onDelete("no action").onUpdate("no action"),
    unique("reconciliation_actions_finding_idempotency_unique").on(table.findingId, table.idempotencyKey),
    check("reconciliation_actions_transition_allowed", sql`(
      (${table.actionType} = 'acknowledge' and ${table.fromStatus} = 'open' and ${table.toStatus} = 'acknowledged')
      or (${table.actionType} = 'resolve' and ${table.fromStatus} in ('open', 'acknowledged') and ${table.toStatus} = 'resolved')
      or (${table.actionType} = 'ignore' and ${table.fromStatus} in ('open', 'acknowledged') and ${table.toStatus} = 'ignored')
    )`),
    check("reconciliation_actions_actor_operator", sql`${table.actorType} = 'operator'`),
    check("reconciliation_actions_actor_id_nonblank", sql`btrim(${table.actorId}) <> ''`),
    check("reconciliation_actions_reason_nonblank", sql`btrim(${table.reason}) <> ''`),
    check("reconciliation_actions_idempotency_key_format", sql`${table.idempotencyKey} ~ '^[!-~]{1,128}$'`),
    check("reconciliation_actions_fingerprint_format", sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`),
    index("reconciliation_actions_finding_occurred_idx").on(table.findingId, table.occurredAt, table.id),
  ],
);
