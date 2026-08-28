import { createInstallmentId, type InstallmentId } from "../../contracts/domain/ids.js";
import { createMoneyCents, type MoneyCents } from "../../contracts/domain/money-cents.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";

export interface RefundAllocationInput {
  readonly installmentId: InstallmentId;
  readonly position: number;
  readonly paymentAllocatedAmountCents: MoneyCents;
  readonly alreadyRefundedAmountCents: number;
}

export interface RefundAllocationPlanItem {
  readonly installmentId: InstallmentId;
  readonly amountCents: MoneyCents;
}

export class RefundExceedsReversibleAmountError extends Error {
  override readonly name = "RefundExceedsReversibleAmountError";

  constructor(
    readonly refundAmountCents: MoneyCents,
    readonly reversibleAmountCents: number,
  ) {
    super("Refund amount exceeds the Payment reversible amount");
  }
}

function validateInputs(
  allocations: ReadonlyArray<Readonly<RefundAllocationInput>>,
): ReadonlyArray<{
  readonly installmentId: InstallmentId;
  readonly position: number;
  readonly remainingReversibleAmountCents: number;
}> {
  const positions = new Set<number>();
  const installmentIds = new Set<number>();

  return allocations.map((allocation) => {
    const installmentId = createInstallmentId(allocation.installmentId);
    if (!Number.isSafeInteger(allocation.position) || allocation.position < 1) {
      throw new DomainValidationError(
        "INVALID_REFUND_ALLOCATION_INPUT",
        "Installment position must be a positive safe integer",
      );
    }
    if (positions.has(allocation.position)) {
      throw new DomainValidationError(
        "INVALID_REFUND_ALLOCATION_INPUT",
        "Installment positions must be unique",
      );
    }
    if (installmentIds.has(installmentId)) {
      throw new DomainValidationError(
        "INVALID_REFUND_ALLOCATION_INPUT",
        "Installments must be unique",
      );
    }

    const paymentAllocatedAmountCents = createMoneyCents(
      allocation.paymentAllocatedAmountCents,
    );
    if (
      !Number.isSafeInteger(allocation.alreadyRefundedAmountCents) ||
      allocation.alreadyRefundedAmountCents < 0 ||
      allocation.alreadyRefundedAmountCents > paymentAllocatedAmountCents
    ) {
      throw new DomainValidationError(
        "INVALID_REFUND_ALLOCATION_INPUT",
        "Already-refunded amount must be between zero and the original Payment allocation",
      );
    }

    positions.add(allocation.position);
    installmentIds.add(installmentId);
    return {
      installmentId,
      position: allocation.position,
      remainingReversibleAmountCents:
        paymentAllocatedAmountCents - allocation.alreadyRefundedAmountCents,
    };
  });
}

export function allocateRefund(
  refundAmountCentsValue: MoneyCents,
  allocations: ReadonlyArray<Readonly<RefundAllocationInput>>,
): ReadonlyArray<Readonly<RefundAllocationPlanItem>> {
  const refundAmountCents = createMoneyCents(refundAmountCentsValue);
  const validated = validateInputs(allocations);
  const ordered = [...validated].sort(
    (left, right) => right.position - left.position,
  );
  let totalReversible = 0;

  for (const allocation of ordered) {
    totalReversible += allocation.remainingReversibleAmountCents;
    if (!Number.isSafeInteger(totalReversible)) {
      throw new DomainValidationError(
        "INVALID_REFUND_ALLOCATION_INPUT",
        "Total reversible amount must remain a safe integer",
      );
    }
  }

  if (refundAmountCents > totalReversible) {
    throw new RefundExceedsReversibleAmountError(
      refundAmountCents,
      totalReversible,
    );
  }

  let remaining: number = refundAmountCents;
  const result: RefundAllocationPlanItem[] = [];
  for (const allocation of ordered) {
    if (remaining === 0) {
      break;
    }
    const allocated = Math.min(
      remaining,
      allocation.remainingReversibleAmountCents,
    );
    if (allocated === 0) {
      continue;
    }
    result.push(
      Object.freeze({
        installmentId: allocation.installmentId,
        amountCents: createMoneyCents(allocated),
      }),
    );
    remaining -= allocated;
  }

  if (remaining !== 0) {
    throw new DomainValidationError(
      "INCOHERENT_REFUND_ALLOCATION",
      "Refund allocation must conserve every cent",
    );
  }
  return Object.freeze(result);
}
