import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../../../src/application/clock.js";
import { createContractUseCase } from "../../../src/contracts/application/create-contract.js";
import { getContractByIdUseCase } from "../../../src/contracts/application/get-contract-by-id.js";
import { PostgresContractPersistence } from "../../../src/contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "../../../src/customers/application/create-customer.js";
import { getCustomerByIdUseCase } from "../../../src/customers/application/get-customer-by-id.js";
import { PostgresCustomerPersistence } from "../../../src/customers/persistence/postgres-customer-persistence.js";
import { buildApp } from "../../../src/interface/http/app.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";

const POSTGRES_IMAGE = "postgres:18.4";
const FIXED_NOW = new Date("2026-08-25T03:00:00.000Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(FIXED_NOW.getTime());
  }
}

describe.sequential("HTTP and PostgreSQL wiring", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let app: FastifyInstance;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });

    const clock = new FixedClock();
    const customerPersistence = new PostgresCustomerPersistence(database);
    const contractPersistence = new PostgresContractPersistence(database);
    app = buildApp({
      createCustomer: createCustomerUseCase({
        clock,
        persistence: customerPersistence,
      }),
      getCustomerById: getCustomerByIdUseCase(customerPersistence),
      createContract: createContractUseCase({
        clock,
        persistence: contractPersistence,
      }),
      getContractById: getContractByIdUseCase(contractPersistence),
    });
    app.addHook("onClose", async () => database.close());
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table installments, contracts, idempotency_records, customers
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();
  }, 30_000);

  it("executes the complete Customer to Contract HTTP flow", async () => {
    const createCustomer = await app.inject({
      method: "POST",
      url: "/customers",
      headers: { "idempotency-key": "http-create-customer" },
      payload: { displayName: "HTTP Customer" },
    });
    expect(createCustomer.statusCode).toBe(201);
    expect(createCustomer.json()).toEqual({
      id: 1,
      displayName: "HTTP Customer",
      createdAt: FIXED_NOW.toISOString(),
    });

    const getCustomer = await app.inject({
      method: "GET",
      url: "/customers/1",
    });
    expect(getCustomer.statusCode).toBe(200);
    expect(getCustomer.json()).toEqual(createCustomer.json());

    const createContract = await app.inject({
      method: "POST",
      url: "/contracts",
      headers: { "idempotency-key": "http-create-contract" },
      payload: {
        customerId: 1,
        totalAmountCents: 10_000,
        currency: "EUR",
        installmentCount: 3,
        firstDueDate: "2026-01-31",
      },
    });
    expect(createContract.statusCode).toBe(201);
    expect(createContract.json()).toMatchObject({
      id: 1,
      customerId: 1,
      totalAmountCents: 10_000,
      currency: "EUR",
      installmentCount: 3,
      firstDueDate: "2026-01-31",
      status: "active",
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(
      createContract
        .json()
        .installments.map(
          (item: { position: number; amountCents: number; dueDate: string }) => ({
            position: item.position,
            amountCents: item.amountCents,
            dueDate: item.dueDate,
          }),
        ),
    ).toEqual([
      { position: 1, amountCents: 3_334, dueDate: "2026-01-31" },
      { position: 2, amountCents: 3_333, dueDate: "2026-02-28" },
      { position: 3, amountCents: 3_333, dueDate: "2026-03-31" },
    ]);

    const getContract = await app.inject({
      method: "GET",
      url: "/contracts/1",
    });
    expect(getContract.statusCode).toBe(200);
    expect(getContract.json()).toEqual(createContract.json());
  });

  it("propagates HTTP idempotency without a duplicate business effect", async () => {
    const request = {
      method: "POST" as const,
      url: "/customers",
      headers: { "idempotency-key": "http-customer-replay" },
      payload: { displayName: "Replay Customer" },
    };

    const first = await app.inject(request);
    const replay = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().id).toBe(first.json().id);

    const counts = await database.client.execute<{
      customer_count: string;
      idempotency_count: string;
    }>(sql`
      select
        (select count(*) from customers) as customer_count,
        (select count(*) from idempotency_records where command_type = 'create_customer') as idempotency_count
    `);
    expect(counts.rows[0]).toEqual({
      customer_count: "1",
      idempotency_count: "1",
    });
  });
});
