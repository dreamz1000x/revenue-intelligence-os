import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Clock } from "../../../src/application/clock.js";
import {
  canonicalizeCreateContractPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
  IdempotencyPayloadConflict,
} from "../../../src/application/idempotency.js";
import { createContractUseCase, type CreateContractCommand } from "../../../src/contracts/application/create-contract.js";
import { CustomerNotFoundError } from "../../../src/contracts/application/customer-not-found-error.js";
import { getContractByIdUseCase } from "../../../src/contracts/application/get-contract-by-id.js";
import { createCivilDate } from "../../../src/contracts/domain/civil-date.js";
import { CONTRACT_STATUS, INSTALLMENT_STATUS } from "../../../src/contracts/domain/contract.js";
import { generateInstallmentSchedule } from "../../../src/contracts/domain/installment-schedule.js";
import { createMoneyCents } from "../../../src/contracts/domain/money-cents.js";
import { contracts, installments } from "../../../src/contracts/persistence/contract-schema.js";
import { PostgresContractPersistence } from "../../../src/contracts/persistence/postgres-contract-persistence.js";
import { createCustomerUseCase } from "../../../src/customers/application/create-customer.js";
import { PostgresCustomerPersistence } from "../../../src/customers/persistence/postgres-customer-persistence.js";
import { createCustomerId } from "../../../src/customers/domain/customer-id.js";
import { createDatabase, type Database } from "../../../src/persistence/database.js";

const POSTGRES_IMAGE = "postgres:18.4";
const FIXED_NOW = new Date("2026-08-25T10:11:12.123Z");

class FixedClock implements Clock {
  now(): Date {
    return new Date(FIXED_NOW.getTime());
  }
}

function contractCommand(
  customerId: number,
  overrides: Partial<CreateContractCommand> = {},
): CreateContractCommand {
  return {
    idempotencyKey: "create-contract",
    customerId,
    totalAmountCents: 10_000,
    currency: "EUR",
    installmentCount: 3,
    firstDueDate: "2026-01-31",
    ...overrides,
  };
}

describe.sequential("Contract PostgreSQL persistence", () => {
  let container: StartedPostgreSqlContainer;
  let database: Database;
  let contractPersistence: PostgresContractPersistence;
  let createContract: ReturnType<typeof createContractUseCase>;
  let getContractById: ReturnType<typeof getContractByIdUseCase>;
  let createCustomer: ReturnType<typeof createCustomerUseCase>;

  beforeAll(async () => {
    container = await new PostgreSqlContainer(POSTGRES_IMAGE).start();
    database = createDatabase({ connectionString: container.getConnectionUri() });
    await migrate(database.client, { migrationsFolder: "./drizzle" });

    const clock = new FixedClock();
    const customerPersistence = new PostgresCustomerPersistence(database);
    contractPersistence = new PostgresContractPersistence(database);
    createCustomer = createCustomerUseCase({ clock, persistence: customerPersistence });
    createContract = createContractUseCase({ clock, persistence: contractPersistence });
    getContractById = getContractByIdUseCase(contractPersistence);
  }, 120_000);

  beforeEach(async () => {
    await database.client.execute(sql`
      truncate table payment_allocations, payments, installments, contracts,
        idempotency_records, customers
      restart identity cascade
    `);
  });

  afterAll(async () => {
    await database?.close();
    await container?.stop();
  }, 30_000);

  async function persistedContractCounts() {
    const result = await database.client.execute<{
      contract_count: string;
      installment_count: string;
      idempotency_count: string;
    }>(sql`
      select
        (select count(*) from contracts) as contract_count,
        (select count(*) from installments) as installment_count,
        (select count(*) from idempotency_records where command_type = 'create_contract') as idempotency_count
    `);
    return result.rows[0]!;
  }

  async function existingCustomer() {
    const result = await createCustomer({
      idempotencyKey: "create-customer-for-contract",
      displayName: "Contract Customer",
    });
    return result.resource;
  }

  it("creates one active Contract with its complete ordered pending schedule", async () => {
    const customer = await existingCustomer();
    const result = await createContract(contractCommand(customer.id));
    const contract = result.resource;

    expect(result.outcome).toBe("created");
    expect(contract).toMatchObject({
      id: 1,
      customerId: customer.id,
      totalAmountCents: 10_000,
      currency: "EUR",
      installmentCount: 3,
      firstDueDate: "2026-01-31",
      status: CONTRACT_STATUS,
    });
    expect(contract.createdAt.toISOString()).toBe(FIXED_NOW.toISOString());
    expect(contract.installments.map((item) => ({
      id: item.id,
      contractId: item.contractId,
      position: item.position,
      amountCents: item.amountCents,
      dueDate: item.dueDate,
      status: item.status,
      createdAt: item.createdAt.toISOString(),
    }))).toEqual([
      { id: 1, contractId: 1, position: 1, amountCents: 3_334, dueDate: "2026-01-31", status: INSTALLMENT_STATUS, createdAt: FIXED_NOW.toISOString() },
      { id: 2, contractId: 1, position: 2, amountCents: 3_333, dueDate: "2026-02-28", status: INSTALLMENT_STATUS, createdAt: FIXED_NOW.toISOString() },
      { id: 3, contractId: 1, position: 3, amountCents: 3_333, dueDate: "2026-03-31", status: INSTALLMENT_STATUS, createdAt: FIXED_NOW.toISOString() },
    ]);
  });

  it("retrieves the complete aggregate ordered by position", async () => {
    const customer = await existingCustomer();
    const created = await createContract(contractCommand(customer.id));

    const retrieved = await getContractById(created.resource.id);
    expect(retrieved).toEqual(created.resource);
    expect(retrieved?.installments.map((item) => item.position)).toEqual([1, 2, 3]);
  });

  it("returns null when the Contract does not exist", async () => {
    await expect(getContractById(1)).resolves.toBeNull();
  });

  it("reports a missing Customer without persisting command effects", async () => {
    await expect(createContract(contractCommand(999))).rejects.toBeInstanceOf(
      CustomerNotFoundError,
    );
    expect(await persistedContractCounts()).toEqual({
      contract_count: "0",
      installment_count: "0",
      idempotency_count: "0",
    });
  });

  it("rolls back a provisional Contract on schedule failure and permits retry", async () => {
    const customer = await existingCustomer();
    const command = contractCommand(customer.id, { idempotencyKey: "rollback-contract" });
    const totalAmountCents = createMoneyCents(command.totalAmountCents);
    const firstDueDate = createCivilDate(command.firstDueDate);
    const validSchedule = generateInstallmentSchedule(
      totalAmountCents,
      command.installmentCount,
      firstDueDate,
    );
    const invalidSchedule = validSchedule.map((item, index) =>
      index === 1 ? { ...item, position: 1 } : item,
    );
    const requestFingerprint = fingerprintCanonicalPayload(
      canonicalizeCreateContractPayload({
        customerId: customer.id,
        totalAmountCents,
        currency: "EUR",
        installmentCount: command.installmentCount,
        firstDueDate,
      }),
    );

    await expect(
      contractPersistence.create({
        idempotencyKey: createIdempotencyKey(command.idempotencyKey),
        requestFingerprint,
        customerId: createCustomerId(customer.id),
        totalAmountCents,
        currency: "EUR",
        installmentCount: command.installmentCount,
        firstDueDate,
        schedule: invalidSchedule,
        createdAt: FIXED_NOW,
      }),
    ).rejects.toThrow();
    expect(await persistedContractCounts()).toEqual({
      contract_count: "0",
      installment_count: "0",
      idempotency_count: "0",
    });

    const retry = await createContract(command);
    expect(retry.outcome).toBe("created");
    expect(retry.resource.installments).toHaveLength(3);
    expect(await persistedContractCounts()).toEqual({
      contract_count: "1",
      installment_count: "3",
      idempotency_count: "1",
    });
  });

  it("replays the original Contract and Installment identities", async () => {
    const customer = await existingCustomer();
    const command = contractCommand(customer.id, { idempotencyKey: "replay-contract" });
    const first = await createContract(command);
    const replay = await createContract(command);

    expect(first.outcome).toBe("created");
    expect(replay.outcome).toBe("replayed");
    expect(replay.resource.id).toBe(first.resource.id);
    expect(replay.resource.installments.map((item) => item.id)).toEqual(
      first.resource.installments.map((item) => item.id),
    );
    expect(await persistedContractCounts()).toEqual({
      contract_count: "1",
      installment_count: "3",
      idempotency_count: "1",
    });
  });

  it("rejects a reused key with a different payload without another schedule", async () => {
    const customer = await existingCustomer();
    await createContract(contractCommand(customer.id, { idempotencyKey: "contract-conflict" }));

    await expect(
      createContract(contractCommand(customer.id, {
        idempotencyKey: "contract-conflict",
        totalAmountCents: 10_001,
      })),
    ).rejects.toBeInstanceOf(IdempotencyPayloadConflict);
    expect(await persistedContractCounts()).toEqual({
      contract_count: "1",
      installment_count: "3",
      idempotency_count: "1",
    });
  });

  it("treats different keys as independent Contract commands", async () => {
    const customer = await existingCustomer();
    const first = await createContract(contractCommand(customer.id, { idempotencyKey: "contract-1" }));
    const second = await createContract(contractCommand(customer.id, { idempotencyKey: "contract-2" }));

    expect(second.resource.id).not.toBe(first.resource.id);
    expect(await persistedContractCounts()).toEqual({
      contract_count: "2",
      installment_count: "6",
      idempotency_count: "2",
    });
  });

  it("uses PostgreSQL uniqueness to converge concurrent calls on one aggregate", async () => {
    const customer = await existingCustomer();
    const command = contractCommand(customer.id, {
      idempotencyKey: "concurrent-contract",
      installmentCount: 12,
    });
    let release!: () => void;
    const startGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const calls = Array.from({ length: 8 }, async () => {
      await startGate;
      return createContract(command);
    });
    release();

    const results = await Promise.all(calls);
    expect(new Set(results.map((result) => result.resource.id))).toEqual(
      new Set([results[0]!.resource.id]),
    );
    expect(
      new Set(
        results.map((result) =>
          result.resource.installments.map((item) => item.id).join(","),
        ),
      ).size,
    ).toBe(1);
    expect(results.filter((result) => result.outcome === "created")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "replayed")).toHaveLength(7);
    expect(await persistedContractCounts()).toEqual({
      contract_count: "1",
      installment_count: "12",
      idempotency_count: "1",
    });
  });

  it("round-trips month-end and leap-year CivilDates unchanged", async () => {
    const customer = await existingCustomer();
    const result = await createContract(contractCommand(customer.id, {
      idempotencyKey: "leap-contract",
      installmentCount: 4,
      firstDueDate: "2024-01-31",
    }));
    const contract = result.resource;

    expect(contract.installments.map((item) => item.dueDate)).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
      "2024-04-30",
    ]);
    expect((await getContractById(contract.id))?.firstDueDate).toBe("2024-01-31");
  });

  it("enforces the Contract to Customer foreign key", async () => {
    await expect(database.client.insert(contracts).values({
      customerId: 999,
      totalAmountCents: 100n,
      currency: "EUR",
      installmentCount: 1,
      firstDueDate: "2026-01-31",
      status: CONTRACT_STATUS,
      createdAt: FIXED_NOW,
    })).rejects.toThrow();
  });

  it("enforces the Installment to Contract foreign key", async () => {
    await expect(database.client.insert(installments).values({
      contractId: 999,
      position: 1,
      amountCents: 100n,
      dueDate: "2026-01-31",
      status: INSTALLMENT_STATUS,
      createdAt: FIXED_NOW,
    })).rejects.toThrow();
  });

  it("enforces unique installment positions within a Contract", async () => {
    const customer = await existingCustomer();
    const result = await createContract(contractCommand(customer.id));
    const contract = result.resource;

    await expect(database.client.insert(installments).values({
      contractId: contract.id,
      position: 1,
      amountCents: 1n,
      dueDate: "2026-01-31",
      status: INSTALLMENT_STATUS,
      createdAt: FIXED_NOW,
    })).rejects.toThrow();
  });
});
