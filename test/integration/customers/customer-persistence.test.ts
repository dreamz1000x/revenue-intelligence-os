import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../../../src/application/clock.js";
import {
  canonicalizeCreateCustomerPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
  IdempotencyPayloadConflict,
  type RequestFingerprint,
} from "../../../src/application/idempotency.js";
import { createCustomerUseCase } from "../../../src/customers/application/create-customer.js";
import { getCustomerByIdUseCase } from "../../../src/customers/application/get-customer-by-id.js";
import { PostgresCustomerPersistence } from "../../../src/customers/persistence/postgres-customer-persistence.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";

const POSTGRES_IMAGE = "postgres:18.4";
const FIXED_NOW = new Date("2026-08-25T09:10:11.123Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(FIXED_NOW.getTime());
  }
}

describe.sequential("Customer PostgreSQL persistence", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let persistence: PostgresCustomerPersistence;
  let createCustomer: ReturnType<typeof createCustomerUseCase>;
  let getCustomerById: ReturnType<typeof getCustomerByIdUseCase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });
    persistence = new PostgresCustomerPersistence(database);
    createCustomer = createCustomerUseCase({
      clock: new FixedClock(),
      persistence,
    });
    getCustomerById = getCustomerByIdUseCase(persistence);
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(
      sql`truncate table idempotency_records, customers restart identity cascade`,
    );
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  it("creates and retrieves a customer with the injected UTC instant", async () => {
    const created = await createCustomer({
      idempotencyKey: "create-acme",
      displayName: "Acme",
    });

    expect(created.id).toBe(1);
    expect(created.displayName).toBe("Acme");
    expect(created.createdAt.toISOString()).toBe(FIXED_NOW.toISOString());
    await expect(getCustomerById(created.id)).resolves.toEqual(created);
  });

  it("returns null when the customer does not exist", async () => {
    await expect(getCustomerById(1)).resolves.toBeNull();
  });

  it("rolls back the customer when the later idempotency write fails", async () => {
    await expect(
      persistence.create({
        idempotencyKey: createIdempotencyKey("rollback-test"),
        requestFingerprint: "invalid" as RequestFingerprint,
        displayName: "Must Roll Back",
        createdAt: FIXED_NOW,
      }),
    ).rejects.toThrow();

    const counts = await database.client.execute<{
      customer_count: string;
      idempotency_count: string;
    }>(sql`
      select
        (select count(*) from customers) as customer_count,
        (select count(*) from idempotency_records) as idempotency_count
    `);

    expect(counts.rows[0]).toEqual({
      customer_count: "0",
      idempotency_count: "0",
    });
  });

  it("returns the original customer for the same key and payload", async () => {
    const first = await createCustomer({
      idempotencyKey: "same-command",
      displayName: "Acme",
    });
    const retry = await createCustomer({
      idempotencyKey: "same-command",
      displayName: "Acme",
    });

    expect(retry).toEqual(first);
    const result = await database.client.execute<{ count: string }>(
      sql`select count(*) as count from customers`,
    );
    expect(result.rows[0]?.count).toBe("1");
  });

  it("rejects a reused key with a different payload without another customer", async () => {
    await createCustomer({ idempotencyKey: "conflict", displayName: "Acme" });

    await expect(
      createCustomer({ idempotencyKey: "conflict", displayName: "Other" }),
    ).rejects.toBeInstanceOf(IdempotencyPayloadConflict);

    const result = await database.client.execute<{ count: string }>(
      sql`select count(*) as count from customers`,
    );
    expect(result.rows[0]?.count).toBe("1");
  });

  it("treats different keys with the same payload as independent commands", async () => {
    const first = await createCustomer({
      idempotencyKey: "independent-1",
      displayName: "Acme",
    });
    const second = await createCustomer({
      idempotencyKey: "independent-2",
      displayName: "Acme",
    });

    expect(second.id).not.toBe(first.id);
  });

  it("treats keys as case-sensitive", async () => {
    const lower = await createCustomer({
      idempotencyKey: "case-key",
      displayName: "Acme",
    });
    const upper = await createCustomer({
      idempotencyKey: "Case-Key",
      displayName: "Acme",
    });

    expect(upper.id).not.toBe(lower.id);
  });

  it("commits one effect for concurrent requests with the same key and payload", async () => {
    const requests = Array.from({ length: 8 }, () =>
      createCustomer({
        idempotencyKey: "concurrent-command",
        displayName: "Concurrent Acme",
      }),
    );

    const results = await Promise.all(requests);
    expect(new Set(results.map((customer) => customer.id))).toEqual(
      new Set([results[0]?.id]),
    );

    const canonicalPayload = canonicalizeCreateCustomerPayload("Concurrent Acme");
    const fingerprint = fingerprintCanonicalPayload(canonicalPayload);
    const counts = await database.client.execute<{
      customer_count: string;
      idempotency_count: string;
      fingerprint: string;
    }>(sql`
      select
        (select count(*) from customers) as customer_count,
        (select count(*) from idempotency_records) as idempotency_count,
        (select request_fingerprint from idempotency_records) as fingerprint
    `);

    expect(counts.rows[0]).toEqual({
      customer_count: "1",
      idempotency_count: "1",
      fingerprint,
    });
  });
});
