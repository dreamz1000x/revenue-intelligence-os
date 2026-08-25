import { and, asc, eq } from "drizzle-orm";

import {
  CREATE_CONTRACT_COMMAND,
  IdempotencyPayloadConflict,
} from "../../application/idempotency.js";
import { customers } from "../../customers/persistence/customer-schema.js";
import type {
  Database,
  DatabaseClient,
  TransactionClient,
} from "../../persistence/database.js";
import { idempotencyRecords } from "../../persistence/idempotency-schema.js";
import { CustomerNotFoundError } from "../application/customer-not-found-error.js";
import type {
  ContractPersistence,
  CreateContractPersistenceInput,
} from "../application/contract-persistence.js";
import {
  CONTRACT_STATUS,
  INSTALLMENT_STATUS,
  reconstituteContract,
  type Contract,
} from "../domain/contract.js";
import type { ContractId } from "../domain/ids.js";
import { createMoneyCents, type MoneyCents } from "../domain/money-cents.js";
import { contracts, installments } from "./contract-schema.js";

type QueryClient = DatabaseClient | TransactionClient;

class IdempotencyRaceLost extends Error {}

function moneyCentsFromDatabase(value: bigint): MoneyCents {
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored monetary value is outside the safe integer range");
  }
  return createMoneyCents(Number(value));
}

async function loadContractAggregate(
  client: QueryClient,
  contractId: number,
): Promise<Contract | null> {
  const [contractRow] = await client
    .select()
    .from(contracts)
    .where(eq(contracts.id, contractId))
    .limit(1);

  if (contractRow === undefined) {
    return null;
  }

  const installmentRows = await client
    .select()
    .from(installments)
    .where(eq(installments.contractId, contractRow.id))
    .orderBy(asc(installments.position));

  return reconstituteContract({
    id: contractRow.id,
    customerId: contractRow.customerId,
    totalAmountCents: moneyCentsFromDatabase(contractRow.totalAmountCents),
    currency: contractRow.currency,
    installmentCount: contractRow.installmentCount,
    firstDueDate: contractRow.firstDueDate,
    status: contractRow.status,
    createdAt: contractRow.createdAt,
    installments: installmentRows.map((row) => ({
      id: row.id,
      contractId: row.contractId,
      position: row.position,
      amountCents: moneyCentsFromDatabase(row.amountCents),
      dueDate: row.dueDate,
      status: row.status,
      createdAt: row.createdAt,
    })),
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
        eq(idempotencyRecords.commandType, CREATE_CONTRACT_COMMAND),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return record ?? null;
}

async function loadRecordedContract(
  client: QueryClient,
  input: CreateContractPersistenceInput,
): Promise<Contract | null> {
  const record = await findIdempotencyRecord(client, input.idempotencyKey);
  if (record === null) {
    return null;
  }

  if (record.requestFingerprint !== input.requestFingerprint) {
    throw new IdempotencyPayloadConflict();
  }

  const contract = await loadContractAggregate(client, record.resourceId);
  if (contract === null) {
    throw new Error("Idempotency record refers to a missing contract");
  }
  return contract;
}

export class PostgresContractPersistence implements ContractPersistence {
  constructor(private readonly database: Database) {}

  async create(input: CreateContractPersistenceInput): Promise<Contract> {
    try {
      return await this.database.transaction(async (transaction) => {
        const existing = await loadRecordedContract(transaction, input);
        if (existing !== null) {
          return existing;
        }

        const [customer] = await transaction
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.id, input.customerId))
          .limit(1);

        if (customer === undefined) {
          throw new CustomerNotFoundError(input.customerId);
        }

        const [insertedContract] = await transaction
          .insert(contracts)
          .values({
            customerId: input.customerId,
            totalAmountCents: BigInt(input.totalAmountCents),
            currency: input.currency,
            installmentCount: input.installmentCount,
            firstDueDate: input.firstDueDate,
            status: CONTRACT_STATUS,
            createdAt: new Date(input.createdAt.getTime()),
          })
          .returning({ id: contracts.id });

        if (insertedContract === undefined) {
          throw new Error("Contract insert did not return a row");
        }

        const insertedInstallments = await transaction
          .insert(installments)
          .values(
            input.schedule.map((item) => ({
              contractId: insertedContract.id,
              position: item.position,
              amountCents: BigInt(item.amountCents),
              dueDate: item.dueDate,
              status: INSTALLMENT_STATUS,
              createdAt: new Date(input.createdAt.getTime()),
            })),
          )
          .returning({ id: installments.id });

        if (insertedInstallments.length !== input.schedule.length) {
          throw new Error("Installment insert did not return the complete schedule");
        }

        const insertedRecord = await transaction
          .insert(idempotencyRecords)
          .values({
            commandType: CREATE_CONTRACT_COMMAND,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            resourceId: insertedContract.id,
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

        const contract = await loadContractAggregate(
          transaction,
          insertedContract.id,
        );
        if (contract === null) {
          throw new Error("Inserted contract could not be loaded");
        }
        return contract;
      });
    } catch (error) {
      if (!(error instanceof IdempotencyRaceLost)) {
        throw error;
      }

      return this.database.transaction(async (transaction) => {
        const existing = await loadRecordedContract(transaction, input);
        if (existing === null) {
          throw new Error("Concurrent idempotency winner could not be resolved");
        }
        return existing;
      });
    }
  }

  getById(id: ContractId): Promise<Contract | null> {
    return loadContractAggregate(this.database.client, id);
  }
}
