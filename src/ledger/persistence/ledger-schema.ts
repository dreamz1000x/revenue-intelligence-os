import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { payments } from "../../payments/persistence/payment-schema.js";
import { refunds } from "../../refunds/persistence/refund-schema.js";

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    paymentId: integer("payment_id"),
    refundId: integer("refund_id"),
    effectType: varchar("effect_type", { length: 32 }).notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    eventAt: timestamp("event_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "ledger_entries_payment_id_payments_id_fk",
      columns: [table.paymentId],
      foreignColumns: [payments.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    unique("ledger_entries_payment_id_unique").on(table.paymentId),
    foreignKey({
      name: "ledger_entries_refund_id_refunds_id_fk",
      columns: [table.refundId],
      foreignColumns: [refunds.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    unique("ledger_entries_refund_id_unique").on(table.refundId),
    check(
      "ledger_entries_effect_type_allowed",
      sql`${table.effectType} in ('payment_recorded', 'refund_recorded')`,
    ),
    check(
      "ledger_entries_source_effect_consistent",
      sql`(
        (${table.effectType} = 'payment_recorded' and ${table.paymentId} is not null and ${table.refundId} is null)
        or (${table.effectType} = 'refund_recorded' and ${table.paymentId} is null and ${table.refundId} is not null)
      )`,
    ),
    check("ledger_entries_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "ledger_entries_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
    check("ledger_entries_currency_eur", sql`${table.currency} = 'EUR'`),
  ],
);
