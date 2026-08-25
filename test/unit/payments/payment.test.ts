import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import { reconstitutePayment } from "../../../src/payments/domain/payment.js";

const RECEIVED_AT = new Date("2026-08-25T08:00:00.123Z");
const CREATED_AT = new Date("2026-08-25T09:00:00.456Z");

function paymentInput() {
  return {
    id: 1,
    contractId: 2,
    amountCents: 5_000,
    receivedAt: RECEIVED_AT,
    createdAt: CREATED_AT,
    allocations: [
      { installmentId: 22, position: 2, amountCents: 1_666 },
      { installmentId: 21, position: 1, amountCents: 3_334 },
    ],
  };
}

describe("Payment", () => {
  it("reconstitutes immutable allocations in Installment position order", () => {
    const payment = reconstitutePayment(paymentInput());

    expect(payment).toMatchObject({ id: 1, contractId: 2, amountCents: 5_000 });
    expect(payment.allocations).toEqual([
      { installmentId: 21, amountCents: 3_334 },
      { installmentId: 22, amountCents: 1_666 },
    ]);
    expect(Object.isFrozen(payment.allocations)).toBe(true);
    expect(payment.allocations.every(Object.isFrozen)).toBe(true);
  });

  it("validates and defensively copies receivedAt and createdAt", () => {
    const receivedAt = new Date(RECEIVED_AT);
    const createdAt = new Date(CREATED_AT);
    const payment = reconstitutePayment({
      ...paymentInput(),
      receivedAt,
      createdAt,
    });

    receivedAt.setUTCFullYear(2030);
    createdAt.setUTCFullYear(2030);
    expect(payment.receivedAt.toISOString()).toBe(RECEIVED_AT.toISOString());
    expect(payment.createdAt.toISOString()).toBe(CREATED_AT.toISOString());

    payment.receivedAt.setUTCFullYear(2040);
    payment.createdAt.setUTCFullYear(2040);
    expect(payment.receivedAt.toISOString()).toBe(RECEIVED_AT.toISOString());
    expect(payment.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
  });

  it("rejects invalid instants and incoherent allocation totals", () => {
    expect(() =>
      reconstitutePayment({
        ...paymentInput(),
        receivedAt: new Date("invalid"),
      }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstitutePayment({
        ...paymentInput(),
        allocations: [{ installmentId: 21, position: 1, amountCents: 4_999 }],
      }),
    ).toThrowError(DomainValidationError);
  });
});
