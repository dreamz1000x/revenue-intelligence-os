import { and, asc, eq } from "drizzle-orm";

import {
  IdempotencyPayloadConflict,
  RECORD_PAYMENT_COMMAND,
} from "../../application/idempotency.js";
import type { CreateCommandResult } from "../../application/create-command-result.js";
import {
  type InstallmentStatus,
} from "../../contracts/domain/contract.js";
import { createInstallmentId } from "../../contracts/domain/ids.js";
import { createMoneyCents } from "../../contracts/domain/money-cents.js";
import { contracts, installments } from "../../contracts/persistence/contract-schema.js";
import { derivePaymentRecordedLedgerEntry } from "../../ledger/domain/ledger-entry.js";
import { ledgerEntries } from "../../ledger/persistence/ledger-schema.js";
import type {
  Database,
  DatabaseClient,
  TransactionClient,
} from "../../persistence/database.js";
import { idempotencyRecords } from "../../persistence/idempotency-schema.js";
import { refundAllocations } from "../../refunds/persistence/refund-schema.js";
import { ContractNotFoundError } from "../application/contract-not-found-error.js";
import type {
  PaymentPersistence,
  RecordPaymentPersistenceInput,
} from "../application/payment-persistence.js";
import type { PaymentId } from "../domain/ids.js";
import {
  allocatePayment,
  type InstallmentAllocationInput,
} from "../domain/payment-allocation.js";
import { reconstitutePayment, type Payment } from "../domain/payment.js";
import { paymentAllocations, payments } from "./payment-schema.js";

type QueryClient = DatabaseClient | TransactionClient;

class IdempotencyRaceLost extends Error {}

function moneyCentsFromDatabase(value: bigint): number {
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored monetary value is outside the safe integer range");
  }
  return Number(value);
}

async function loadPaymentAggregate(
  client: QueryClient,
  paymentId: number,
): Promise<Payment | null> {
  const [paymentRow] = await client
    .select()
    .from(payments)
    .where(eq(payments.id, paymentId))
    .limit(1);

  if (paymentRow === undefined) {
    return null;
  }

  const allocationRows = await client
    .select({
      installmentId: paymentAllocations.installmentId,
      position: installments.position,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .innerJoin(
      installments,
      and(
        eq(installments.id, paymentAllocations.installmentId),
        eq(installments.contractId, paymentAllocations.contractId),
      ),
    )
    .where(eq(paymentAllocations.paymentId, paymentRow.id))
    .orderBy(asc(installments.position));

  return reconstitutePayment({
    id: paymentRow.id,
    contractId: paymentRow.contractId,
    amountCents: moneyCentsFromDatabase(paymentRow.amountCents),
    receivedAt: paymentRow.receivedAt,
    createdAt: paymentRow.createdAt,
    allocations: allocationRows.map((row) => ({
      installmentId: row.installmentId,
      position: row.position,
      amountCents: moneyCentsFromDatabase(row.amountCents),
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
        eq(idempotencyRecords.commandType, RECORD_PAYMENT_COMMAND),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);

  return record ?? null;
}

async function loadRecordedPayment(
  client: QueryClient,
  input: RecordPaymentPersistenceInput,
): Promise<Payment | null> {
  const record = await findIdempotencyRecord(client, input.idempotencyKey);
  if (record === null) {
    return null;
  }
  if (record.requestFingerprint !== input.requestFingerprint) {
    throw new IdempotencyPayloadConflict();
  }

  const payment = await loadPaymentAggregate(client, record.resourceId);
  if (payment === null) {
    throw new Error("Idempotency record refers to a missing Payment");
  }
  return payment;
}

async function loadAllocationInputs(
  transaction: TransactionClient,
  contractId: number,
): Promise<{
  readonly inputs: ReadonlyArray<InstallmentAllocationInput>;
  readonly effectiveAllocatedByInstallment: ReadonlyMap<number, number>;
  readonly amountByInstallment: ReadonlyMap<number, number>;
}> {
  const installmentRows = await transaction
    .select({
      id: installments.id,
      position: installments.position,
      amountCents: installments.amountCents,
    })
    .from(installments)
    .where(eq(installments.contractId, contractId))
    .orderBy(asc(installments.position));
  const paymentAllocationRows = await transaction
    .select({
      installmentId: paymentAllocations.installmentId,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .where(eq(paymentAllocations.contractId, contractId));
  const refundAllocationRows = await transaction
    .select({
      installmentId: refundAllocations.installmentId,
      amountCents: refundAllocations.amountCents,
    })
    .from(refundAllocations)
    .innerJoin(
      payments,
      eq(payments.id, refundAllocations.paymentId),
    )
    .where(eq(payments.contractId, contractId));

  const grossAllocatedByInstallment = new Map<number, number>();
  for (const allocation of paymentAllocationRows) {
    const amount = moneyCentsFromDatabase(allocation.amountCents);
    const next =
      (grossAllocatedByInstallment.get(allocation.installmentId) ?? 0) + amount;
    if (!Number.isSafeInteger(next)) {
      throw new Error(
        "Stored gross PaymentAllocation total is outside the safe integer range",
      );
    }
    grossAllocatedByInstallment.set(allocation.installmentId, next);
  }

  const refundedByInstallment = new Map<number, number>();
  for (const allocation of refundAllocationRows) {
    const amount = moneyCentsFromDatabase(allocation.amountCents);
    const next =
      (refundedByInstallment.get(allocation.installmentId) ?? 0) + amount;
    if (!Number.isSafeInteger(next)) {
      throw new Error(
        "Stored RefundAllocation total is outside the safe integer range",
      );
    }
    refundedByInstallment.set(allocation.installmentId, next);
  }

  const amountByInstallment = new Map<number, number>();
  const effectiveAllocatedByInstallment = new Map<number, number>();
  const inputs = installmentRows.map((row): InstallmentAllocationInput => {
    const amountCents = moneyCentsFromDatabase(row.amountCents);
    const grossAllocated = grossAllocatedByInstallment.get(row.id) ?? 0;
    const refunded = refundedByInstallment.get(row.id) ?? 0;
    if (refunded > grossAllocated) {
      throw new Error(
        "Stored RefundAllocation total exceeds PaymentAllocation total",
      );
    }
    const effectiveAllocated = grossAllocated - refunded;
    if (!Number.isSafeInteger(effectiveAllocated) || effectiveAllocated < 0) {
      throw new Error(
        "Stored effective allocation total is outside the safe integer range",
      );
    }
    amountByInstallment.set(row.id, amountCents);
    effectiveAllocatedByInstallment.set(row.id, effectiveAllocated);
    return {
      installmentId: createInstallmentId(row.id),
      position: row.position,
      amountCents: createMoneyCents(amountCents),
      allocatedAmountCents: effectiveAllocated,
    };
  });

  return { inputs, effectiveAllocatedByInstallment, amountByInstallment };
}

export class PostgresPaymentPersistence implements PaymentPersistence {
  constructor(private readonly database: Database) {}

  async record(
    input: RecordPaymentPersistenceInput,
  ): Promise<CreateCommandResult<Payment>> {
    try {
      return await this.database.transaction(async (transaction) => {
        const fastReplay = await loadRecordedPayment(transaction, input);
        if (fastReplay !== null) {
          return { resource: fastReplay, outcome: "replayed" };
        }

        const [lockedContract] = await transaction
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, input.contractId))
          .for("update");
        if (lockedContract === undefined) {
          throw new ContractNotFoundError(input.contractId);
        }

        const replayAfterLock = await loadRecordedPayment(transaction, input);
        if (replayAfterLock !== null) {
          return { resource: replayAfterLock, outcome: "replayed" };
        }

        const {
          inputs,
          effectiveAllocatedByInstallment,
          amountByInstallment,
        } = await loadAllocationInputs(transaction, input.contractId);
        const plan = allocatePayment(input.amountCents, inputs);

        const [insertedPayment] = await transaction
          .insert(payments)
          .values({
            contractId: input.contractId,
            amountCents: BigInt(input.amountCents),
            receivedAt: new Date(input.receivedAt.getTime()),
            createdAt: new Date(input.createdAt.getTime()),
          })
          .returning({ id: payments.id });
        if (insertedPayment === undefined) {
          throw new Error("Payment insert did not return a row");
        }

        await transaction.insert(paymentAllocations).values(
          plan.map((allocation) => ({
            paymentId: insertedPayment.id,
            installmentId: allocation.installmentId,
            contractId: input.contractId,
            amountCents: BigInt(allocation.amountCents),
          })),
        );

        for (const allocation of plan) {
          const prior =
            effectiveAllocatedByInstallment.get(allocation.installmentId) ?? 0;
          const installmentAmount = amountByInstallment.get(
            allocation.installmentId,
          );
          if (installmentAmount === undefined) {
            throw new Error("Allocation refers to an unknown Installment");
          }
          const totalAllocated = prior + allocation.amountCents;
          const status: InstallmentStatus =
            totalAllocated === installmentAmount ? "paid" : "partially_paid";
          const updated = await transaction
            .update(installments)
            .set({ status })
            .where(
              and(
                eq(installments.id, allocation.installmentId),
                eq(installments.contractId, input.contractId),
              ),
            )
            .returning({ id: installments.id });
          if (updated.length !== 1) {
            throw new Error("Installment status projection update failed");
          }
        }

        const payment = await loadPaymentAggregate(
          transaction,
          insertedPayment.id,
        );
        if (payment === null) {
          throw new Error("Inserted Payment could not be loaded");
        }
        const ledgerEntry = derivePaymentRecordedLedgerEntry(payment);
        await transaction.insert(ledgerEntries).values({
          paymentId: ledgerEntry.paymentId,
          effectType: ledgerEntry.effectType,
          amountCents: BigInt(ledgerEntry.amountCents),
          currency: ledgerEntry.currency,
          eventAt: ledgerEntry.eventAt,
          recordedAt: ledgerEntry.recordedAt,
        });

        const insertedRecord = await transaction
          .insert(idempotencyRecords)
          .values({
            commandType: RECORD_PAYMENT_COMMAND,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            resourceId: insertedPayment.id,
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

        return { resource: payment, outcome: "created" };
      });
    } catch (error) {
      if (!(error instanceof IdempotencyRaceLost)) {
        throw error;
      }

      return this.database.transaction(async (transaction) => {
        const existing = await loadRecordedPayment(transaction, input);
        if (existing === null) {
          throw new Error("Concurrent Payment idempotency winner was not found");
        }
        return { resource: existing, outcome: "replayed" };
      });
    }
  }

  getById(id: PaymentId): Promise<Payment | null> {
    return loadPaymentAggregate(this.database.client, id);
  }
}
