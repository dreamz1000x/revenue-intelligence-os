import { describe, expect, it } from "vitest";

import {
  reconstituteContract,
  validateContractCurrency,
} from "../../../src/contracts/domain/contract.js";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";

const CREATED_AT = new Date("2026-08-25T10:11:12.123Z");

function validContractInput() {
  return {
    id: 1,
    customerId: 2,
    totalAmountCents: 100,
    currency: "EUR",
    installmentCount: 2,
    firstDueDate: "2026-01-31",
    status: "active",
    createdAt: CREATED_AT,
    installments: [
      {
        id: 1,
        contractId: 1,
        position: 1,
        amountCents: 50,
        dueDate: "2026-01-31",
        status: "pending",
        createdAt: CREATED_AT,
      },
      {
        id: 2,
        contractId: 1,
        position: 2,
        amountCents: 50,
        dueDate: "2026-02-28",
        status: "pending",
        createdAt: CREATED_AT,
      },
    ],
  };
}

describe("Contract aggregate", () => {
  it("reconstitutes a coherent complete schedule with defensive dates", () => {
    const contract = reconstituteContract(validContractInput());
    const exposedDate = contract.installments[0]!.createdAt;
    exposedDate.setUTCFullYear(2040);

    expect(contract.currency).toBe("EUR");
    expect(contract.status).toBe("active");
    expect(contract.installments.map((item) => item.status)).toEqual([
      "pending",
      "pending",
    ]);
    expect(contract.installments[0]!.createdAt.toISOString()).toBe(
      CREATED_AT.toISOString(),
    );
  });

  it("rejects an incomplete or inconsistent persisted schedule", () => {
    const input = validContractInput();
    expect(() =>
      reconstituteContract({ ...input, installments: input.installments.slice(0, 1) }),
    ).toThrowError(DomainValidationError);
  });

  it("accepts only the approved Contract currency", () => {
    expect(validateContractCurrency("EUR")).toBe("EUR");
    expect(() => validateContractCurrency("USD")).toThrowError(
      DomainValidationError,
    );
  });

  it("accepts only the approved Installment payment-status projection", () => {
    const input = validContractInput();
    const contract = reconstituteContract({
      ...input,
      installments: [
        { ...input.installments[0]!, status: "partially_paid" },
        { ...input.installments[1]!, status: "paid" },
      ],
    });

    expect(contract.installments.map((item) => item.status)).toEqual([
      "partially_paid",
      "paid",
    ]);
    expect(() =>
      reconstituteContract({
        ...input,
        installments: [
          { ...input.installments[0]!, status: "overdue" },
          input.installments[1]!,
        ],
      }),
    ).toThrowError(DomainValidationError);
  });
});
