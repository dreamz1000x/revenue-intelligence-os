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

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    paymentId: integer("payment_id").notNull(),
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
    check(
      "ledger_entries_effect_type_payment_recorded",
      sql`${table.effectType} = 'payment_recorded'`,
    ),
    check("ledger_entries_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "ledger_entries_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
    check("ledger_entries_currency_eur", sql`${table.currency} = 'EUR'`),
  ],
);
