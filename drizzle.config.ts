import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: [
    "./src/customers/persistence/customer-schema.ts",
    "./src/persistence/idempotency-schema.ts",
  ],
  out: "./drizzle",
});
