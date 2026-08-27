import { sql } from "drizzle-orm";
import {
  check,
  customType,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

import { payments } from "../../payments/persistence/payment-schema.js";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

export const stripeWebhookEvents = pgTable(
  "stripe_webhook_events",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    stripeEventId: varchar("stripe_event_id", { length: 255 }).notNull(),
    eventType: varchar("event_type", { length: 64 }).notNull(),
    stripePaymentIntentId: varchar("stripe_payment_intent_id", { length: 255 }),
    rawPayload: bytea("raw_payload").notNull(),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    processingToken: uuid("processing_token"),
    processingStartedAt: timestamp("processing_started_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }),
    processedAt: timestamp("processed_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }),
    paymentId: integer("payment_id"),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
  },
  (table) => [
    unique("stripe_webhook_events_stripe_event_id_unique").on(
      table.stripeEventId,
    ),
    foreignKey({
      name: "stripe_webhook_events_payment_id_payments_id_fk",
      columns: [table.paymentId],
      foreignColumns: [payments.id],
    }),
    check(
      "stripe_webhook_events_event_id_format",
      sql`${table.stripeEventId} ~ '^evt_[A-Za-z0-9]+$'`,
    ),
    check(
      "stripe_webhook_events_event_type_supported",
      sql`${table.eventType} = 'payment_intent.succeeded'`,
    ),
    check(
      "stripe_webhook_events_payment_intent_id_format",
      sql`${table.stripePaymentIntentId} is null or ${table.stripePaymentIntentId} ~ '^pi_[A-Za-z0-9]+$'`,
    ),
    check(
      "stripe_webhook_events_raw_payload_size",
      sql`octet_length(${table.rawPayload}) between 1 and 1048576`,
    ),
    check(
      "stripe_webhook_events_status_supported",
      sql`${table.status} in ('received', 'processing', 'processed', 'failed')`,
    ),
    check(
      "stripe_webhook_events_state_consistency",
      sql`(
        (${table.status} = 'received' and ${table.processingToken} is null and ${table.processingStartedAt} is null and ${table.paymentId} is null and ${table.processedAt} is null and ${table.lastErrorCode} is null)
        or (${table.status} = 'processing' and ${table.processingToken} is not null and ${table.processingStartedAt} is not null and ${table.paymentId} is null and ${table.processedAt} is null and ${table.lastErrorCode} is null)
        or (${table.status} = 'processed' and ${table.processingToken} is null and ${table.processingStartedAt} is null and ${table.paymentId} is not null and ${table.processedAt} is not null and ${table.lastErrorCode} is null and ${table.stripePaymentIntentId} is not null)
        or (${table.status} = 'failed' and ${table.processingToken} is null and ${table.processingStartedAt} is null and ${table.paymentId} is null and ${table.processedAt} is not null and ${table.lastErrorCode} is not null)
      )`,
    ),
  ],
);
