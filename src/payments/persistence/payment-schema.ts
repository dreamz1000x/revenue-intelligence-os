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

import { contracts, installments } from "../../contracts/persistence/contract-schema.js";

export const payments = pgTable(
  "payments",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    contractId: integer("contract_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    receivedAt: timestamp("received_at", {
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
      name: "payments_contract_id_contracts_id_fk",
      columns: [table.contractId],
      foreignColumns: [contracts.id],
    }),
    unique("payments_id_contract_id_unique").on(table.id, table.contractId),
    check("payments_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "payments_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
  ],
);

export const paymentAllocations = pgTable(
  "payment_allocations",
  {
    paymentId: integer("payment_id").notNull(),
    installmentId: integer("installment_id").notNull(),
    contractId: integer("contract_id").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.paymentId, table.installmentId] }),
    foreignKey({
      name: "payment_allocations_payment_contract_fk",
      columns: [table.paymentId, table.contractId],
      foreignColumns: [payments.id, payments.contractId],
    }),
    foreignKey({
      name: "payment_allocations_installment_contract_fk",
      columns: [table.installmentId, table.contractId],
      foreignColumns: [installments.id, installments.contractId],
    }),
    check("payment_allocations_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "payment_allocations_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
  ],
);
