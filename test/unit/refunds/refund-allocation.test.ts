import { describe, expect, it } from "vitest";

import { createInstallmentId } from "../../../src/contracts/domain/ids.js";
import { createMoneyCents } from "../../../src/contracts/domain/money-cents.js";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import {
  allocateRefund,
  RefundExceedsReversibleAmountError,
  type RefundAllocationInput,
} from "../../../src/refunds/domain/refund-allocation.js";

function allocation(
  id: number,
  position: number,
  paymentAllocatedAmountCents: number,
  alreadyRefundedAmountCents = 0,
): RefundAllocationInput {
  return {
    installmentId: createInstallmentId(id),
    position,
    paymentAllocatedAmountCents: createMoneyCents(paymentAllocatedAmountCents),
    alreadyRefundedAmountCents,
  };
}

function captureError(work: () => void): unknown {
  try {
    work();
  } catch (error) {
    return error;
  }
  throw new Error("Expected work to throw");
}

describe("Refund allocation", () => {
  it("allocates a partial Refund against one original allocation", () => {
    expect(allocateRefund(createMoneyCents(30), [allocation(1, 1, 100)])).toEqual([
      { installmentId: 1, amountCents: 30 },
    ]);
  });

  it("spans original allocations in descending Installment position", () => {
    expect(
      allocateRefund(createMoneyCents(80), [
        allocation(1, 1, 100),
        allocation(2, 2, 100),
        allocation(3, 3, 50),
      ]),
    ).toEqual([
      { installmentId: 3, amountCents: 50 },
      { installmentId: 2, amountCents: 30 },
    ]);
  });

  it("uses prior Refunds and skips fully refunded allocations", () => {
    expect(
      allocateRefund(createMoneyCents(90), [
        allocation(1, 1, 100),
        allocation(2, 2, 100, 30),
        allocation(3, 3, 50, 50),
      ]),
    ).toEqual([
      { installmentId: 2, amountCents: 70 },
      { installmentId: 1, amountCents: 20 },
    ]);
  });

  it("supports the remaining state after multiple successful Refunds", () => {
    const first = allocateRefund(createMoneyCents(30), [allocation(3, 3, 50)]);
    const second = allocateRefund(createMoneyCents(20), [allocation(3, 3, 50, 30)]);

    expect(first).toEqual([{ installmentId: 3, amountCents: 30 }]);
    expect(second).toEqual([{ installmentId: 3, amountCents: 20 }]);
  });

  it("allocates an exact full reversal and conserves every cent", () => {
    const result = allocateRefund(createMoneyCents(250), [
      allocation(2, 2, 100),
      allocation(1, 1, 100),
      allocation(3, 3, 50),
    ]);

    expect(result).toEqual([
      { installmentId: 3, amountCents: 50 },
      { installmentId: 2, amountCents: 100 },
      { installmentId: 1, amountCents: 100 },
    ]);
    expect(result.reduce((sum, item) => sum + item.amountCents, 0)).toBe(250);
    expect(result.every((item) => item.amountCents > 0)).toBe(true);
  });

  it("rejects a Refund greater than the total remaining reversible amount", () => {
    const error = captureError(() => {
      allocateRefund(createMoneyCents(51), [allocation(1, 1, 100, 50)]);
    });

    expect(error).toBeInstanceOf(RefundExceedsReversibleAmountError);
    expect(error).toMatchObject({
      name: "RefundExceedsReversibleAmountError",
      refundAmountCents: 51,
      reversibleAmountCents: 50,
    });
  });

  it("reports zero reversible capacity for empty input", () => {
    const error = captureError(() => allocateRefund(createMoneyCents(1), []));

    expect(error).toBeInstanceOf(RefundExceedsReversibleAmountError);
    expect(error).toMatchObject({
      refundAmountCents: 1,
      reversibleAmountCents: 0,
    });
  });

  it("reports zero reversible capacity when every allocation is exhausted", () => {
    const error = captureError(() =>
      allocateRefund(createMoneyCents(1), [allocation(1, 1, 100, 100)]),
    );

    expect(error).toBeInstanceOf(RefundExceedsReversibleAmountError);
    expect(error).toMatchObject({
      refundAmountCents: 1,
      reversibleAmountCents: 0,
    });
  });

  it("rejects zero or otherwise invalid requested amounts", () => {
    for (const amount of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() =>
        allocateRefund(amount as ReturnType<typeof createMoneyCents>, [
          allocation(1, 1, 100),
        ]),
      ).toThrowError(DomainValidationError);
    }
  });

  it("rejects invalid original or already-refunded amounts", () => {
    expect(() =>
      allocateRefund(createMoneyCents(1), [
        {
          ...allocation(1, 1, 100),
          paymentAllocatedAmountCents: 0 as ReturnType<typeof createMoneyCents>,
        },
      ]),
    ).toThrowError(DomainValidationError);

    for (const alreadyRefunded of [
      -1,
      1.5,
      101,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        allocateRefund(createMoneyCents(1), [
          allocation(1, 1, 100, alreadyRefunded),
        ]),
      ).toThrowError(DomainValidationError);
    }
  });

  it("rejects total reversible capacity beyond the safe-integer boundary", () => {
    expect(() =>
      allocateRefund(createMoneyCents(1), [
        allocation(1, 1, Number.MAX_SAFE_INTEGER),
        allocation(2, 2, 1),
      ]),
    ).toThrowError(DomainValidationError);
  });

  it("rejects invalid positions and duplicate Installment identity or position", () => {
    expect(() =>
      allocateRefund(createMoneyCents(1), [allocation(1, 0, 100)]),
    ).toThrowError(DomainValidationError);
    expect(() =>
      allocateRefund(createMoneyCents(1), [
        allocation(1, Number.MAX_SAFE_INTEGER + 1, 100),
      ]),
    ).toThrowError(DomainValidationError);
    expect(() =>
      allocateRefund(createMoneyCents(1), [
        {
          ...allocation(1, 1, 100),
          installmentId: -1 as ReturnType<typeof createInstallmentId>,
        },
      ]),
    ).toThrowError(DomainValidationError);
    expect(() =>
      allocateRefund(createMoneyCents(1), [
        allocation(1, 1, 100),
        allocation(1, 2, 100),
      ]),
    ).toThrowError(DomainValidationError);
    expect(() =>
      allocateRefund(createMoneyCents(1), [
        allocation(1, 1, 100),
        allocation(2, 1, 100),
      ]),
    ).toThrowError(DomainValidationError);
  });

  it("copies and deterministically sorts input without mutating the caller", () => {
    const inputs = [
      allocation(1, 1, 100),
      allocation(3, 3, 50),
      allocation(2, 2, 100),
    ];
    const originalOrder = inputs.map((item) => item.installmentId);
    const result = allocateRefund(createMoneyCents(80), inputs);

    expect(result.map((item) => item.installmentId)).toEqual([3, 2]);
    expect(inputs.map((item) => item.installmentId)).toEqual(originalOrder);
    expect(Object.isFrozen(result)).toBe(true);
    expect(result.every(Object.isFrozen)).toBe(true);
  });

  it("returns the same result independently of caller input ordering", () => {
    const ascending = [
      allocation(1, 1, 100),
      allocation(2, 2, 100),
      allocation(3, 3, 50),
    ];
    expect(allocateRefund(createMoneyCents(180), ascending)).toEqual(
      allocateRefund(createMoneyCents(180), [...ascending].reverse()),
    );
  });
});
