import { describe, expect, it } from "vitest";

import { createInstallmentId } from "../../../src/contracts/domain/ids.js";
import { createMoneyCents } from "../../../src/contracts/domain/money-cents.js";
import {
  allocatePayment,
  PaymentExceedsOutstandingError,
  type InstallmentAllocationInput,
} from "../../../src/payments/domain/payment-allocation.js";

function installment(
  id: number,
  position: number,
  amountCents: number,
  allocatedAmountCents = 0,
): InstallmentAllocationInput {
  return {
    installmentId: createInstallmentId(id),
    position,
    amountCents: createMoneyCents(amountCents),
    allocatedAmountCents,
  };
}

describe("Payment allocation", () => {
  it("allocates an exact single-Installment payment", () => {
    expect(allocatePayment(createMoneyCents(3_334), [installment(1, 1, 3_334)])).toEqual([
      { installmentId: 1, amountCents: 3_334 },
    ]);
  });

  it("allocates a partial payment without creating zero allocations", () => {
    expect(
      allocatePayment(createMoneyCents(1_000), [
        installment(1, 1, 3_334),
        installment(2, 2, 3_333),
      ]),
    ).toEqual([{ installmentId: 1, amountCents: 1_000 }]);
  });

  it("spans two Installments in position order", () => {
    expect(
      allocatePayment(createMoneyCents(5_000), [
        installment(1, 1, 3_334),
        installment(2, 2, 3_333),
        installment(3, 3, 3_333),
      ]),
    ).toEqual([
      { installmentId: 1, amountCents: 3_334 },
      { installmentId: 2, amountCents: 1_666 },
    ]);
  });

  it("spans several Installments and conserves every cent", () => {
    const allocations = allocatePayment(createMoneyCents(8_000), [
      installment(1, 1, 3_334),
      installment(2, 2, 3_333),
      installment(3, 3, 3_333),
    ]);

    expect(allocations).toEqual([
      { installmentId: 1, amountCents: 3_334 },
      { installmentId: 2, amountCents: 3_333 },
      { installmentId: 3, amountCents: 1_333 },
    ]);
    expect(allocations.reduce((sum, item) => sum + item.amountCents, 0)).toBe(8_000);
  });

  it("uses prior allocations and skips completely paid Installments", () => {
    expect(
      allocatePayment(createMoneyCents(2_000), [
        installment(1, 1, 3_334, 3_334),
        installment(2, 2, 3_333, 1_000),
        installment(3, 3, 3_333),
      ]),
    ).toEqual([{ installmentId: 2, amountCents: 2_000 }]);
  });

  it("sorts a copied input by explicit position without mutating the caller", () => {
    const inputs = [
      installment(3, 3, 3_333),
      installment(1, 1, 3_334),
      installment(2, 2, 3_333),
    ];
    const originalOrder = inputs.map((item) => item.installmentId);

    const allocations = allocatePayment(createMoneyCents(5_000), inputs);

    expect(allocations.map((item) => item.installmentId)).toEqual([1, 2]);
    expect(inputs.map((item) => item.installmentId)).toEqual(originalOrder);
    expect(Object.isFrozen(allocations)).toBe(true);
    expect(allocations.every(Object.isFrozen)).toBe(true);
  });

  it("accepts a payment equal to all outstanding cents", () => {
    const allocations = allocatePayment(createMoneyCents(5_666), [
      installment(1, 1, 3_334, 1_000),
      installment(2, 2, 3_332),
    ]);

    expect(allocations.reduce((sum, item) => sum + item.amountCents, 0)).toBe(5_666);
  });

  it("rejects a payment greater than total outstanding, including zero outstanding", () => {
    expect(() =>
      allocatePayment(createMoneyCents(101), [installment(1, 1, 100)]),
    ).toThrowError(PaymentExceedsOutstandingError);
    expect(() =>
      allocatePayment(createMoneyCents(1), [installment(1, 1, 100, 100)]),
    ).toThrowError(PaymentExceedsOutstandingError);
  });
});
