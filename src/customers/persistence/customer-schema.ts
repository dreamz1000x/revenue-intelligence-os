import { check, integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const customers = pgTable(
  "customers",
  {
    id: integer("id").primaryKey().generatedByDefaultAsIdentity(),
    displayName: text("display_name").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3,
      mode: "date",
    }).notNull(),
  },
  (table) => [
    check(
      "customers_display_name_not_blank",
      sql`length(btrim(${table.displayName})) > 0`,
    ),
  ],
);
