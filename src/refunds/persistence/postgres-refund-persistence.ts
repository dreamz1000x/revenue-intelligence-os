import { and, asc, eq, inArray } from "drizzle-orm";

import type { CreateCommandResult } from "../../application/create-command-result.js";
import {
  IdempotencyPayloadConflict,
  RECORD_REFUND_COMMAND,
} from "../../application/idempotency.js";
import type { InstallmentStatus } from "../../contracts/domain/contract.js";
import { createInstallmentId } from "../../contracts/domain/ids.js";
import { createMoneyCents } from "../../contracts/domain/money-cents.js";
import {
  contracts,
  installments,
} from "../../contracts/persistence/contract-schema.js";
import { deriveRefundRecordedLedgerEntry } from "../../ledger/domain/ledger-entry.js";
import { ledgerEntries } from "../../ledger/persistence/ledger-schema.js";
import { paymentAllocations, payments } from "../../payments/persistence/payment-schema.js";
import type {
  Database,
  DatabaseClient,
  TransactionClient,
} from "../../persistence/database.js";
import { idempotencyRecords } from "../../persistence/idempotency-schema.js";
import { OriginalPaymentNotFoundError } from "../application/original-payment-not-found-error.js";
import type {
  RecordRefundPersistenceInput,
  RefundPersistence,
} from "../application/refund-persistence.js";
import {
  allocateRefund,
  RefundExceedsReversibleAmountError,
  type RefundAllocationInput,
} from "../domain/refund-allocation.js";
import type { RefundId } from "../domain/ids.js";
import { reconstituteRefund, type Refund } from "../domain/refund.js";
import { refundAllocations, refunds } from "./refund-schema.js";

type QueryClient = DatabaseClient | TransactionClient;

class IdempotencyRaceLost extends Error {}

function moneyCentsFromDatabase(value: bigint): number {
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Stored monetary value is outside the safe integer range");
  }
  return Number(value);
}

function addStoredMoney(total: number, value: bigint, label: string): number {
  const next = total + moneyCentsFromDatabase(value);
  if (!Number.isSafeInteger(next)) {
    throw new Error(`${label} is outside the safe integer range`);
  }
  return next;
}

async function loadRefundAggregate(
  client: QueryClient,
  refundId: number,
): Promise<Refund | null> {
  const [refundRow] = await client
    .select()
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .limit(1);
  if (refundRow === undefined) {
    return null;
  }
  const allocationRows = await client
    .select({
      installmentId: refundAllocations.installmentId,
      position: installments.position,
      amountCents: refundAllocations.amountCents,
    })
    .from(refundAllocations)
    .innerJoin(installments, eq(installments.id, refundAllocations.installmentId))
    .where(eq(refundAllocations.refundId, refundRow.id))
    .orderBy(asc(installments.position));

  return reconstituteRefund({
    id: refundRow.id,
    paymentId: refundRow.paymentId,
    amountCents: moneyCentsFromDatabase(refundRow.amountCents),
    refundedAt: refundRow.refundedAt,
    createdAt: refundRow.createdAt,
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
        eq(idempotencyRecords.commandType, RECORD_REFUND_COMMAND),
        eq(idempotencyRecords.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return record ?? null;
}

async function loadRecordedRefund(
  client: QueryClient,
  input: RecordRefundPersistenceInput,
): Promise<Refund | null> {
  const record = await findIdempotencyRecord(client, input.idempotencyKey);
  if (record === null) {
    return null;
  }
  if (record.requestFingerprint !== input.requestFingerprint) {
    throw new IdempotencyPayloadConflict();
  }
  const refund = await loadRefundAggregate(client, record.resourceId);
  if (refund === null) {
    throw new Error("Idempotency record refers to a missing Refund");
  }
  return refund;
}

async function loadRefundPlanInputs(
  transaction: TransactionClient,
  paymentId: number,
  paymentAmountCents: number,
): Promise<{
  readonly inputs: ReadonlyArray<RefundAllocationInput>;
  readonly refundedSoFar: number;
}> {
  const originalAllocationRows = await transaction
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
    .where(eq(paymentAllocations.paymentId, paymentId));
  const priorRefundRows = await transaction
    .select({ amountCents: refunds.amountCents })
    .from(refunds)
    .where(eq(refunds.paymentId, paymentId));
  const priorRefundAllocationRows = await transaction
    .select({
      installmentId: refundAllocations.installmentId,
      amountCents: refundAllocations.amountCents,
    })
    .from(refundAllocations)
    .where(eq(refundAllocations.paymentId, paymentId));

  let originalAllocationTotal = 0;
  for (const row of originalAllocationRows) {
    originalAllocationTotal = addStoredMoney(
      originalAllocationTotal,
      row.amountCents,
      "Stored original PaymentAllocation total",
    );
  }
  if (originalAllocationTotal !== paymentAmountCents) {
    throw new Error("Stored Payment allocations do not match the Payment amount");
  }

  let refundedSoFar = 0;
  for (const row of priorRefundRows) {
    refundedSoFar = addStoredMoney(
      refundedSoFar,
      row.amountCents,
      "Stored Refund total",
    );
  }
  if (refundedSoFar > paymentAmountCents) {
    throw new Error("Stored Refund total exceeds the Payment amount");
  }

  const refundedByInstallment = new Map<number, number>();
  let refundAllocationTotal = 0;
  for (const row of priorRefundAllocationRows) {
    const amount = moneyCentsFromDatabase(row.amountCents);
    refundAllocationTotal += amount;
    if (!Number.isSafeInteger(refundAllocationTotal)) {
      throw new Error(
        "Stored RefundAllocation total is outside the safe integer range",
      );
    }
    const installmentTotal =
      (refundedByInstallment.get(row.installmentId) ?? 0) + amount;
    if (!Number.isSafeInteger(installmentTotal)) {
      throw new Error(
        "Stored installment RefundAllocation total is outside the safe integer range",
      );
    }
    refundedByInstallment.set(row.installmentId, installmentTotal);
  }
  if (refundAllocationTotal !== refundedSoFar) {
    throw new Error("Stored Refund and RefundAllocation totals are inconsistent");
  }

  const originalInstallmentIds = new Set(
    originalAllocationRows.map((row) => row.installmentId),
  );
  for (const installmentId of refundedByInstallment.keys()) {
    if (!originalInstallmentIds.has(installmentId)) {
      throw new Error(
        "Stored RefundAllocation has no original PaymentAllocation",
      );
    }
  }

  return {
    refundedSoFar,
    inputs: originalAllocationRows.map((row) => ({
      installmentId: createInstallmentId(row.installmentId),
      position: row.position,
      paymentAllocatedAmountCents: createMoneyCents(
        moneyCentsFromDatabase(row.amountCents),
      ),
      alreadyRefundedAmountCents:
        refundedByInstallment.get(row.installmentId) ?? 0,
    })),
  };
}

async function updateAffectedInstallmentProjections(
  transaction: TransactionClient,
  contractId: number,
  affectedInstallmentIds: ReadonlyArray<number>,
): Promise<void> {
  const ids = [...affectedInstallmentIds];
  const installmentRows = await transaction
    .select({ id: installments.id, amountCents: installments.amountCents })
    .from(installments)
    .where(
      and(
        eq(installments.contractId, contractId),
        inArray(installments.id, ids),
      ),
    );
  if (installmentRows.length !== ids.length) {
    throw new Error("Refund allocation refers to an unknown Installment");
  }
  const paymentRows = await transaction
    .select({
      installmentId: paymentAllocations.installmentId,
      amountCents: paymentAllocations.amountCents,
    })
    .from(paymentAllocations)
    .where(
      and(
        eq(paymentAllocations.contractId, contractId),
        inArray(paymentAllocations.installmentId, ids),
      ),
    );
  const refundRows = await transaction
    .select({
      installmentId: refundAllocations.installmentId,
      amountCents: refundAllocations.amountCents,
    })
    .from(refundAllocations)
    .innerJoin(payments, eq(payments.id, refundAllocations.paymentId))
    .where(
      and(
        eq(payments.contractId, contractId),
        inArray(refundAllocations.installmentId, ids),
      ),
    );

  const grossByInstallment = new Map<number, number>();
  for (const row of paymentRows) {
    grossByInstallment.set(
      row.installmentId,
      addStoredMoney(
        grossByInstallment.get(row.installmentId) ?? 0,
        row.amountCents,
        "Stored gross PaymentAllocation total",
      ),
    );
  }
  const refundedByInstallment = new Map<number, number>();
  for (const row of refundRows) {
    refundedByInstallment.set(
      row.installmentId,
      addStoredMoney(
        refundedByInstallment.get(row.installmentId) ?? 0,
        row.amountCents,
        "Stored RefundAllocation total",
      ),
    );
  }

  for (const row of installmentRows) {
    const contractual = moneyCentsFromDatabase(row.amountCents);
    const gross = grossByInstallment.get(row.id) ?? 0;
    const refunded = refundedByInstallment.get(row.id) ?? 0;
    if (refunded > gross) {
      throw new Error(
        "Stored RefundAllocation total exceeds PaymentAllocation total",
      );
    }
    const effective = gross - refunded;
    if (!Number.isSafeInteger(effective) || effective > contractual) {
      throw new Error("Stored effective paid total is invalid");
    }
    const status: InstallmentStatus =
      effective === 0
        ? "pending"
        : effective === contractual
          ? "paid"
          : "partially_paid";
    const updated = await transaction
      .update(installments)
      .set({ status })
      .where(
        and(
          eq(installments.id, row.id),
          eq(installments.contractId, contractId),
        ),
      )
      .returning({ id: installments.id });
    if (updated.length !== 1) {
      throw new Error("Installment status projection update failed");
    }
  }
}

export class PostgresRefundPersistence implements RefundPersistence {
  constructor(private readonly database: Database) {}

  async record(
    input: RecordRefundPersistenceInput,
  ): Promise<CreateCommandResult<Refund>> {
    try {
      return await this.database.transaction(async (transaction) => {
        const fastReplay = await loadRecordedRefund(transaction, input);
        if (fastReplay !== null) {
          return { resource: fastReplay, outcome: "replayed" };
        }

        const [discoveredPayment] = await transaction
          .select({ contractId: payments.contractId })
          .from(payments)
          .where(eq(payments.id, input.paymentId))
          .limit(1);
        if (discoveredPayment === undefined) {
          throw new OriginalPaymentNotFoundError(input.paymentId);
        }
        const [lockedContract] = await transaction
          .select({ id: contracts.id })
          .from(contracts)
          .where(eq(contracts.id, discoveredPayment.contractId))
          .for("update");
        if (lockedContract === undefined) {
          throw new Error("Original Payment refers to a missing Contract");
        }

        const replayAfterLock = await loadRecordedRefund(transaction, input);
        if (replayAfterLock !== null) {
          return { resource: replayAfterLock, outcome: "replayed" };
        }
        const [paymentRow] = await transaction
          .select({
            id: payments.id,
            contractId: payments.contractId,
            amountCents: payments.amountCents,
          })
          .from(payments)
          .where(
            and(
              eq(payments.id, input.paymentId),
              eq(payments.contractId, discoveredPayment.contractId),
            ),
          )
          .limit(1);
        if (paymentRow === undefined) {
          throw new OriginalPaymentNotFoundError(input.paymentId);
        }
        const paymentAmountCents = moneyCentsFromDatabase(paymentRow.amountCents);
        const { inputs: allocationInputs, refundedSoFar } =
          await loadRefundPlanInputs(
            transaction,
            paymentRow.id,
            paymentAmountCents,
          );
        const remainingRefundable = paymentAmountCents - refundedSoFar;
        if (input.amountCents > remainingRefundable) {
          throw new RefundExceedsReversibleAmountError(
            input.amountCents,
            remainingRefundable,
          );
        }
        const plan = allocateRefund(input.amountCents, allocationInputs);

        const [insertedRefund] = await transaction
          .insert(refunds)
          .values({
            paymentId: paymentRow.id,
            amountCents: BigInt(input.amountCents),
            refundedAt: new Date(input.refundedAt.getTime()),
            createdAt: new Date(input.createdAt.getTime()),
          })
          .returning({ id: refunds.id });
        if (insertedRefund === undefined) {
          throw new Error("Refund insert did not return a row");
        }
        await transaction.insert(refundAllocations).values(
          plan.map((allocation) => ({
            refundId: insertedRefund.id,
            paymentId: paymentRow.id,
            installmentId: allocation.installmentId,
            amountCents: BigInt(allocation.amountCents),
          })),
        );
        await updateAffectedInstallmentProjections(
          transaction,
          paymentRow.contractId,
          plan.map((allocation) => allocation.installmentId),
        );

        const refund = await loadRefundAggregate(transaction, insertedRefund.id);
        if (refund === null) {
          throw new Error("Inserted Refund could not be loaded");
        }
        const ledgerEntry = deriveRefundRecordedLedgerEntry(refund);
        await transaction.insert(ledgerEntries).values({
          refundId: ledgerEntry.refundId,
          effectType: ledgerEntry.effectType,
          amountCents: BigInt(ledgerEntry.amountCents),
          currency: ledgerEntry.currency,
          eventAt: ledgerEntry.eventAt,
          recordedAt: ledgerEntry.recordedAt,
        });

        const insertedRecord = await transaction
          .insert(idempotencyRecords)
          .values({
            commandType: RECORD_REFUND_COMMAND,
            idempotencyKey: input.idempotencyKey,
            requestFingerprint: input.requestFingerprint,
            resourceId: insertedRefund.id,
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
        return { resource: refund, outcome: "created" };
      });
    } catch (error) {
      if (!(error instanceof IdempotencyRaceLost)) {
        throw error;
      }
      return this.database.transaction(async (transaction) => {
        const existing = await loadRecordedRefund(transaction, input);
        if (existing === null) {
          throw new Error("Concurrent Refund idempotency winner was not found");
        }
        return { resource: existing, outcome: "replayed" };
      });
    }
  }

  getById(id: RefundId): Promise<Refund | null> {
    return loadRefundAggregate(this.database.client, id);
  }
}
