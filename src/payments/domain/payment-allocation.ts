import type { InstallmentId } from "../../contracts/domain/ids.js";
import { createMoneyCents, type MoneyCents } from "../../contracts/domain/money-cents.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";

export interface InstallmentAllocationInput {
  readonly installmentId: InstallmentId;
  readonly position: number;
  readonly amountCents: MoneyCents;
  readonly allocatedAmountCents: number;
}

export interface PaymentAllocationPlanItem {
  readonly installmentId: InstallmentId;
  readonly amountCents: MoneyCents;
}

export class PaymentExceedsOutstandingError extends Error {
  override readonly name = "PaymentExceedsOutstandingError";

  constructor(
    readonly paymentAmountCents: MoneyCents,
    readonly outstandingAmountCents: number,
  ) {
    super("Payment amount exceeds the Contract outstanding amount");
  }
}

function validateInputs(
  installments: ReadonlyArray<Readonly<InstallmentAllocationInput>>,
): void {
  const positions = new Set<number>();
  const installmentIds = new Set<number>();

  for (const installment of installments) {
    if (!Number.isSafeInteger(installment.position) || installment.position < 1) {
      throw new DomainValidationError(
        "INVALID_ALLOCATION_INPUT",
        "Installment position must be a positive safe integer",
      );
    }
    if (positions.has(installment.position)) {
      throw new DomainValidationError(
        "INVALID_ALLOCATION_INPUT",
        "Installment positions must be unique",
      );
    }
    if (installmentIds.has(installment.installmentId)) {
      throw new DomainValidationError(
        "INVALID_ALLOCATION_INPUT",
        "Installments must be unique",
      );
    }
    if (
      !Number.isSafeInteger(installment.allocatedAmountCents) ||
      installment.allocatedAmountCents < 0 ||
      installment.allocatedAmountCents > installment.amountCents
    ) {
      throw new DomainValidationError(
        "INVALID_ALLOCATION_INPUT",
        "Allocated amount must be between zero and the Installment amount",
      );
    }

    positions.add(installment.position);
    installmentIds.add(installment.installmentId);
  }
}

export function allocatePayment(
  paymentAmountCents: MoneyCents,
  installments: ReadonlyArray<Readonly<InstallmentAllocationInput>>,
): ReadonlyArray<Readonly<PaymentAllocationPlanItem>> {
  validateInputs(installments);

  const ordered = [...installments].sort(
    (left, right) => left.position - right.position,
  );
  let totalOutstanding = 0;

  for (const installment of ordered) {
    totalOutstanding +=
      installment.amountCents - installment.allocatedAmountCents;
    if (!Number.isSafeInteger(totalOutstanding)) {
      throw new DomainValidationError(
        "INVALID_ALLOCATION_INPUT",
        "Total outstanding amount must remain a safe integer",
      );
    }
  }

  if (paymentAmountCents > totalOutstanding) {
    throw new PaymentExceedsOutstandingError(
      paymentAmountCents,
      totalOutstanding,
    );
  }

  let remaining: number = paymentAmountCents;
  const allocations: PaymentAllocationPlanItem[] = [];

  for (const installment of ordered) {
    if (remaining === 0) {
      break;
    }

    const outstanding =
      installment.amountCents - installment.allocatedAmountCents;
    const allocated = Math.min(remaining, outstanding);
    if (allocated === 0) {
      continue;
    }

    allocations.push(
      Object.freeze({
        installmentId: installment.installmentId,
        amountCents: createMoneyCents(allocated),
      }),
    );
    remaining -= allocated;
  }

  if (remaining !== 0) {
    throw new DomainValidationError(
      "INCOHERENT_PAYMENT_ALLOCATION",
      "Payment allocation must conserve every cent",
    );
  }

  return Object.freeze(allocations);
}
