import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./dist/persistence/schema.js",
  out: "./drizzle",
});
