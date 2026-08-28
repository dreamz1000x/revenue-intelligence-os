import { sql } from "drizzle-orm";
import {
  check,
  integer,
  pgTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const idempotencyRecords = pgTable(
  "idempotency_records",
  {
    commandType: varchar("command_type", { length: 32 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(),
    resourceId: integer("resource_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.commandType, table.idempotencyKey] }),
    check(
      "idempotency_records_command_type_allowed",
      sql`${table.commandType} in ('create_customer', 'create_contract', 'record_payment', 'record_refund')`,
    ),
    check(
      "idempotency_records_key_format",
      sql`${table.idempotencyKey} ~ '^[!-~]{1,128}$'`,
    ),
    check(
      "idempotency_records_fingerprint_format",
      sql`${table.requestFingerprint} ~ '^[0-9a-f]{64}$'`,
    ),
    check("idempotency_records_resource_id_positive", sql`${table.resourceId} > 0`),
  ],
);
