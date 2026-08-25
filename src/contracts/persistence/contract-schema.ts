import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from "drizzle-orm/pg-core";

import { customers } from "../../customers/persistence/customer-schema.js";

export const contracts = pgTable(
  "contracts",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => customers.id),
    totalAmountCents: bigint("total_amount_cents", { mode: "bigint" }).notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    installmentCount: integer("installment_count").notNull(),
    firstDueDate: date("first_due_date", { mode: "string" }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    check("contracts_total_amount_positive", sql`${table.totalAmountCents} > 0`),
    check(
      "contracts_total_amount_safe_integer",
      sql`${table.totalAmountCents} <= 9007199254740991`,
    ),
    check("contracts_currency_eur", sql`${table.currency} = 'EUR'`),
    check("contracts_installment_count_positive", sql`${table.installmentCount} > 0`),
    check(
      "contracts_installment_count_within_total",
      sql`${table.installmentCount} <= ${table.totalAmountCents}`,
    ),
    check("contracts_status_active", sql`${table.status} = 'active'`),
  ],
);

export const installments = pgTable(
  "installments",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    contractId: integer("contract_id")
      .notNull()
      .references(() => contracts.id),
    position: integer("position").notNull(),
    amountCents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    status: varchar("status", { length: 16 }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    check("installments_position_positive", sql`${table.position} > 0`),
    check("installments_amount_positive", sql`${table.amountCents} > 0`),
    check(
      "installments_amount_safe_integer",
      sql`${table.amountCents} <= 9007199254740991`,
    ),
    unique("installments_contract_id_position_unique").on(
      table.contractId,
      table.position,
    ),
    unique("installments_id_contract_id_unique").on(
      table.id,
      table.contractId,
    ),
    check(
      "installments_status_allowed",
      sql`${table.status} in ('pending', 'partially_paid', 'paid')`,
    ),
  ],
);
