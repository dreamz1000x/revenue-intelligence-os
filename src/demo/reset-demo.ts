import { sql } from "drizzle-orm";
import { createDatabase, type Database } from "../persistence/database.js";
import { seedDemoDataset } from "./demo-dataset.js";

const KNOWN_TABLES = "reconciliation_actions, reconciliation_finding_evidence, reconciliation_findings, reconciliation_runs, external_source_events, stripe_webhook_events, ledger_entries, refund_allocations, refunds, payment_allocations, payments, installments, contracts, idempotency_records, customers";

export interface DemoResetTarget { readonly connectionString: string; readonly displayTarget: string; }

export function resolveDemoResetTarget(input: { readonly databaseUrl: string | undefined; readonly confirmation: string | undefined; readonly allowDisposableHost?: string | undefined }): DemoResetTarget {
  if (input.confirmation !== "YES") throw new Error("RIOS_DEMO_RESET=YES is required");
  if (!input.databaseUrl) throw new Error("DATABASE_URL is required");
  const url = new URL(input.databaseUrl);
  const databaseName = decodeURIComponent(url.pathname.slice(1));
  if (!databaseName.endsWith("_demo")) throw new Error("Demo database name must end with _demo");
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (!local && input.allowDisposableHost !== "YES") throw new Error("Demo reset requires a local host or RIOS_DEMO_DISPOSABLE_HOST=YES");
  return { connectionString: input.databaseUrl, displayTarget: `${url.hostname}:${url.port || "5432"}/${databaseName}` };
}

export async function resetKnownDemoTables(database: Database): Promise<void> {
  await database.client.execute(sql.raw(`truncate ${KNOWN_TABLES} restart identity cascade`));
}

async function main(): Promise<void> {
  const target = resolveDemoResetTarget({ databaseUrl: process.env["DATABASE_URL"], confirmation: process.env["RIOS_DEMO_RESET"], allowDisposableHost: process.env["RIOS_DEMO_DISPOSABLE_HOST"] });
  console.log(`Resetting RIOS demo database: ${target.displayTarget}`);
  const database = createDatabase({ connectionString: target.connectionString });
  try { await resetKnownDemoTables(database); const result = await seedDemoDataset(database); console.log(`Demo seed complete: runId=${result.runId}`); }
  finally { await database.close(); }
}

if (process.argv[1]?.endsWith("reset-demo.js")) await main();
