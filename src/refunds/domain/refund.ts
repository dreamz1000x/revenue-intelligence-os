import { createInstallmentId, type InstallmentId } from "../../contracts/domain/ids.js";
import { createMoneyCents, type MoneyCents } from "../../contracts/domain/money-cents.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createPaymentId, type PaymentId } from "../../payments/domain/ids.js";
import { createRefundId, type RefundId } from "./ids.js";

export interface RefundAllocation {
  readonly installmentId: InstallmentId;
  readonly amountCents: MoneyCents;
}

export interface Refund {
  readonly id: RefundId;
  readonly paymentId: PaymentId;
  readonly amountCents: MoneyCents;
  readonly refundedAt: Date;
  readonly createdAt: Date;
  readonly allocations: ReadonlyArray<Readonly<RefundAllocation>>;
}

export function copyRefundInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainValidationError(
      "INVALID_REFUND_INSTANT",
      `${label} must be a valid instant`,
    );
  }
  return new Date(value.getTime());
}

export function reconstituteRefund(input: {
  readonly id: number;
  readonly paymentId: number;
  readonly amountCents: number;
  readonly refundedAt: Date;
  readonly createdAt: Date;
  readonly allocations: ReadonlyArray<{
    readonly installmentId: number;
    readonly position: number;
    readonly amountCents: number;
  }>;
}): Refund {
  const id = createRefundId(input.id);
  const paymentId = createPaymentId(input.paymentId);
  const amountCents = createMoneyCents(input.amountCents);
  const refundedAt = copyRefundInstant(input.refundedAt, "Refund refundedAt");
  const createdAt = copyRefundInstant(input.createdAt, "Refund createdAt");
  const ordered = [...input.allocations].sort(
    (left, right) => right.position - left.position,
  );
  const installmentIds = new Set<number>();
  const positions = new Set<number>();
  let allocatedTotal = 0;

  const allocations = ordered.map((allocation): RefundAllocation => {
    if (
      !Number.isSafeInteger(allocation.position) ||
      allocation.position < 1 ||
      positions.has(allocation.position) ||
      installmentIds.has(allocation.installmentId)
    ) {
      throw new DomainValidationError(
        "INCOHERENT_REFUND_ALLOCATION",
        "Refund allocations must identify unique ordered Installments",
      );
    }
    const installmentId = createInstallmentId(allocation.installmentId);
    const allocationAmountCents = createMoneyCents(allocation.amountCents);
    allocatedTotal += allocationAmountCents;
    if (!Number.isSafeInteger(allocatedTotal)) {
      throw new DomainValidationError(
        "INCOHERENT_REFUND_ALLOCATION",
        "Refund allocation total must remain a safe integer",
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
      "INCOHERENT_REFUND_ALLOCATION",
      "Refund allocations must sum exactly to the Refund amount",
    );
  }
  return Object.freeze({
    id,
    paymentId,
    amountCents,
    get refundedAt() {
      return new Date(refundedAt.getTime());
    },
    get createdAt() {
      return new Date(createdAt.getTime());
    },
    allocations: Object.freeze(allocations),
  });
}
