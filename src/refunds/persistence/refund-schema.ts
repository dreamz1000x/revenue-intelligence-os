import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import {
  paymentAllocations,
  payments,
} from "../../payments/persistence/payment-schema.js";

export const refunds = pgTable(
  "refunds",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    paymentId: integer("payment_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    refundedAt: timestamp("refunded_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    foreignKey({
      name: "refunds_payment_id_payments_id_fk",
      columns: [table.paymentId],
      foreignColumns: [payments.id],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    unique("refunds_id_payment_id_unique").on(table.id, table.paymentId),
    check("refunds_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "refunds_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
  ],
);

export const refundAllocations = pgTable(
  "refund_allocations",
  {
    refundId: integer("refund_id").notNull(),
    paymentId: integer("payment_id").notNull(),
    installmentId: integer("installment_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.refundId, table.installmentId] }),
    foreignKey({
      name: "refund_allocations_refund_payment_fk",
      columns: [table.refundId, table.paymentId],
      foreignColumns: [refunds.id, refunds.paymentId],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    foreignKey({
      name: "refund_allocations_payment_installment_fk",
      columns: [table.paymentId, table.installmentId],
      foreignColumns: [
        paymentAllocations.paymentId,
        paymentAllocations.installmentId,
      ],
    })
      .onDelete("no action")
      .onUpdate("no action"),
    check(
      "refund_allocations_amount_positive",
      sql`${table.amountCents} > 0`,
    ),
    check(
      "refund_allocations_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
  ],
);
