import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";

import * as schema from "./schema.js";

export type DatabaseClient = NodePgDatabase<typeof schema>;
export type TransactionClient = Parameters<
  Parameters<DatabaseClient["transaction"]>[0]
>[0];

export interface Database {
  readonly client: DatabaseClient;
  ping(): Promise<void>;
  transaction<T>(work: (transaction: TransactionClient) => Promise<T>): Promise<T>;
  repeatableReadTransaction<T>(work: (transaction: TransactionClient) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabase(config: PoolConfig): Database {
  const pool = new Pool(config);
  const client = drizzle(pool, { schema });

  return {
    client,
    ping: async () => {
      await pool.query("SELECT 1");
    },
    transaction: (work) =>
      client.transaction(work, { isolationLevel: "read committed" }),
    repeatableReadTransaction: (work) =>
      client.transaction(work, { isolationLevel: "repeatable read" }),
    close: () => pool.end(),
  };
}
