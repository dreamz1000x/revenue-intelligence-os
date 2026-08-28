import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import { reconstituteRefund } from "../../../src/refunds/domain/refund.js";

const REFUNDED_AT = new Date("2026-08-28T10:00:00.123Z");
const CREATED_AT = new Date("2026-08-28T10:01:00.456Z");

function refundInput() {
  return {
    id: 1,
    paymentId: 2,
    amountCents: 80,
    refundedAt: REFUNDED_AT,
    createdAt: CREATED_AT,
    allocations: [
      { installmentId: 20, position: 2, amountCents: 30 },
      { installmentId: 30, position: 3, amountCents: 50 },
    ],
  };
}

describe("Refund", () => {
  it("reconstitutes the exact immutable fact in descending position order", () => {
    const refund = reconstituteRefund(refundInput());

    expect(refund).toMatchObject({ id: 1, paymentId: 2, amountCents: 80 });
    expect(refund.allocations).toEqual([
      { installmentId: 30, amountCents: 50 },
      { installmentId: 20, amountCents: 30 },
    ]);
    expect(Object.keys(refund).sort()).toEqual(
      ["allocations", "amountCents", "createdAt", "id", "paymentId", "refundedAt"].sort(),
    );
    expect(Object.isFrozen(refund)).toBe(true);
    expect(Object.isFrozen(refund.allocations)).toBe(true);
    expect(refund.allocations.every(Object.isFrozen)).toBe(true);
  });

  it("defensively copies refundedAt and createdAt", () => {
    const refundedAt = new Date(REFUNDED_AT);
    const createdAt = new Date(CREATED_AT);
    const refund = reconstituteRefund({
      ...refundInput(),
      refundedAt,
      createdAt,
    });

    refundedAt.setUTCFullYear(2030);
    createdAt.setUTCFullYear(2030);
    expect(refund.refundedAt.toISOString()).toBe(REFUNDED_AT.toISOString());
    expect(refund.createdAt.toISOString()).toBe(CREATED_AT.toISOString());

    refund.refundedAt.setUTCFullYear(2040);
    refund.createdAt.setUTCFullYear(2040);
    expect(refund.refundedAt.toISOString()).toBe(REFUNDED_AT.toISOString());
    expect(refund.createdAt.toISOString()).toBe(CREATED_AT.toISOString());
  });

  it("rejects allocation totals that do not equal the Refund amount", () => {
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [{ installmentId: 30, position: 3, amountCents: 79 }],
      }),
    ).toThrowError(DomainValidationError);
  });

  it("rejects duplicate Installment allocations and duplicate positions", () => {
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [
          { installmentId: 30, position: 3, amountCents: 50 },
          { installmentId: 30, position: 2, amountCents: 30 },
        ],
      }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [
          { installmentId: 30, position: 3, amountCents: 50 },
          { installmentId: 20, position: 3, amountCents: 30 },
        ],
      }),
    ).toThrowError(DomainValidationError);
  });

  it("rejects invalid Refund and Payment identities", () => {
    expect(() => reconstituteRefund({ ...refundInput(), id: 0 })).toThrowError(
      DomainValidationError,
    );
    expect(() =>
      reconstituteRefund({ ...refundInput(), paymentId: 0 }),
    ).toThrowError(DomainValidationError);
  });

  it("rejects invalid Refund amounts and allocation values", () => {
    expect(() =>
      reconstituteRefund({ ...refundInput(), amountCents: 0 }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [{ installmentId: 30, position: 3, amountCents: 0 }],
      }),
    ).toThrowError(DomainValidationError);
  });

  it("rejects an unsafe cumulative allocation total", () => {
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        amountCents: Number.MAX_SAFE_INTEGER,
        allocations: [
          {
            installmentId: 10,
            position: 1,
            amountCents: Number.MAX_SAFE_INTEGER,
          },
          { installmentId: 20, position: 2, amountCents: 1 },
        ],
      }),
    ).toThrowError(DomainValidationError);
  });

  it("rejects invalid instants and position metadata", () => {
    expect(() =>
      reconstituteRefund({ ...refundInput(), refundedAt: new Date("invalid") }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstituteRefund({ ...refundInput(), createdAt: new Date("invalid") }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [{ installmentId: 30, position: 0, amountCents: 80 }],
      }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [
          {
            installmentId: 30,
            position: Number.MAX_SAFE_INTEGER + 1,
            amountCents: 80,
          },
        ],
      }),
    ).toThrowError(DomainValidationError);
    expect(() =>
      reconstituteRefund({
        ...refundInput(),
        allocations: [{ installmentId: 0, position: 3, amountCents: 80 }],
      }),
    ).toThrowError(DomainValidationError);
  });
});
