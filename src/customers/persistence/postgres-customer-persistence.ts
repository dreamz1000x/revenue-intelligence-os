import { and, eq } from "drizzle-orm";

import {
  CREATE_CUSTOMER_COMMAND,
  IdempotencyPayloadConflict,
} from "../../application/idempotency.js";
import { idempotencyRecords } from "../../persistence/idempotency-schema.js";
import type {
  Database,
  DatabaseClient,
  TransactionClient,
} from "../../persistence/database.js";
import type {
  CreateCustomerPersistenceInput,
  CustomerPersistence,
} from "../application/customer-persistence.js";
import { reconstituteCustomer, type Customer } from "../domain/customer.js";
import type { CustomerId } from "../domain/customer-id.js";
import { customers } from "./customer-schema.js";

type QueryClient = DatabaseClient | TransactionClient;

class IdempotencyRaceLost extends Error {}

function mapCustomer(row: typeof customers.$inferSelect): Customer {
  return reconstituteCustomer({
    id: row.id,
    displayName: row.displayName,
    createdAt: row.createdAt,
  });
}

async function findIdempotencyRecord(
  client: QueryClient,
  idempotencyKey: string,
) {
  const [record] = await client
    .select()
    .from(idempotencyRecords)
    .where(
      and(
        eq(idempotencyRecords.commandType, CREATE_CUSTOMER_COMMAND),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return record ?? null;
}

async function loadRecordedCustomer(
  client: QueryClient,
  input: CreateCustomerPersistenceInput,
): Promise<Customer | null> {
  const record = await findIdempotencyRecord(client, input.idempotencyKey);
  if (record === null) {
    return null;
  }

  if (record.requestFingerprint !== input.requestFingerprint) {
    throw new IdempotencyPayloadConflict();
  }

  const [customer] = await client
    .select()
    .from(customers)
    .where(eq(customers.id, record.resourceId))
    .limit(1);

  if (customer === undefined) {
    throw new Error("Idempotency record refers to a missing customer");
  }

  return mapCustomer(customer);
}

export class PostgresCustomerPersistence implements CustomerPersistence {
  constructor(private readonly database: Database) {}

  async create(input: CreateCustomerPersistenceInput): Promise<Customer> {
    try {
      return await this.database.transaction(async (transaction) => {
        const existing = await loadRecordedCustomer(transaction, input);
        if (existing !== null) {
          return existing;
        }

        const [insertedCustomer] = await transaction
          .insert(customers)
          .values({
            displayName: input.displayName,
            createdAt: new Date(input.createdAt.getTime()),
          })
          .returning();

        if (insertedCustomer === undefined) {
          throw new Error("Customer insert did not return a row");
        }

        const insertedRecord = await transaction
          .insert(idempotencyRecords)
          .values({
            commandType: CREATE_CUSTOMER_COMMAND,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            resourceId: insertedCustomer.id,
            createdAt: new Date(input.createdAt.getTime()),
          })
          .onConflictDoNothing({
            target: [
              idempotencyRecords.commandType,
              idempotencyRecords.idempotencyKey,
            ],
          })
          .returning({ commandType: idempotencyRecords.commandType });

        if (insertedRecord.length === 0) {
          throw new IdempotencyRaceLost();
        }

        return mapCustomer(insertedCustomer);
      });
    } catch (error) {
      if (!(error instanceof IdempotencyRaceLost)) {
        throw error;
      }

      return this.database.transaction(async (transaction) => {
        const existing = await loadRecordedCustomer(transaction, input);
        if (existing === null) {
          throw new Error("Concurrent idempotency winner could not be resolved");
        }
        return existing;
      });
    }
  }

  async getById(id: CustomerId): Promise<Customer | null> {
    const [customer] = await this.database.client
      .select()
      .from(customers)
      .where(eq(customers.id, id))
      .limit(1);

    return customer === undefined ? null : mapCustomer(customer);
  }
}
