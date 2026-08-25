import { createContractId, createInstallmentId, type ContractId, type InstallmentId } from "../../contracts/domain/ids.js";
import { createMoneyCents, type MoneyCents } from "../../contracts/domain/money-cents.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createPaymentId, type PaymentId } from "./ids.js";

export interface PaymentAllocation {
  readonly installmentId: InstallmentId;
  readonly amountCents: MoneyCents;
}

export interface Payment {
  readonly id: PaymentId;
  readonly contractId: ContractId;
  readonly amountCents: MoneyCents;
  readonly receivedAt: Date;
  readonly createdAt: Date;
  readonly allocations: ReadonlyArray<Readonly<PaymentAllocation>>;
}

export function copyPaymentInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainValidationError(
      "INVALID_PAYMENT_INSTANT",
      `${label} must be a valid instant`,
    );
  }
  return new Date(value.getTime());
}

export function reconstitutePayment(input: {
  readonly id: number;
  readonly contractId: number;
  readonly amountCents: number;
  readonly receivedAt: Date;
  readonly createdAt: Date;
  readonly allocations: ReadonlyArray<{
    readonly installmentId: number;
    readonly position: number;
    readonly amountCents: number;
  }>;
}): Payment {
  const id = createPaymentId(input.id);
  const contractId = createContractId(input.contractId);
  const amountCents = createMoneyCents(input.amountCents);
  const receivedAt = copyPaymentInstant(input.receivedAt, "Payment receivedAt");
  const createdAt = copyPaymentInstant(input.createdAt, "Payment createdAt");
  const ordered = [...input.allocations].sort(
    (left, right) => left.position - right.position,
  );
  const installmentIds = new Set<number>();
  const positions = new Set<number>();
  let allocatedTotal = 0;

  const allocations = ordered.map((allocation): PaymentAllocation => {
    if (
      !Number.isSafeInteger(allocation.position) ||
      allocation.position < 1 ||
      positions.has(allocation.position) ||
      installmentIds.has(allocation.installmentId)
    ) {
      throw new DomainValidationError(
        "INCOHERENT_PAYMENT_ALLOCATION",
        "Payment allocations must identify unique ordered Installments",
      );
    }

    const installmentId = createInstallmentId(allocation.installmentId);
    const allocationAmountCents = createMoneyCents(allocation.amountCents);
    allocatedTotal += allocationAmountCents;
    if (!Number.isSafeInteger(allocatedTotal)) {
      throw new DomainValidationError(
        "INCOHERENT_PAYMENT_ALLOCATION",
        "Payment allocation total must remain a safe integer",
      );
    }
    positions.add(allocation.position);
    installmentIds.add(installmentId);

    return Object.freeze({
      installmentId,
      amountCents: allocationAmountCents,
    });
  });

  if (allocatedTotal !== amountCents) {
    throw new DomainValidationError(
      "INCOHERENT_PAYMENT_ALLOCATION",
      "Payment allocations must sum exactly to the Payment amount",
    );
  }

  return {
    id,
    contractId,
    amountCents,
    get receivedAt() {
      return new Date(receivedAt.getTime());
    },
    get createdAt() {
      return new Date(createdAt.getTime());
    },
    allocations: Object.freeze(allocations),
  };
}
