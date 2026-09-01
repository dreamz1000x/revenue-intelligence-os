import { describe, expect, it } from "vitest";

import { ApplicationInputValidationError } from "../../../src/application/input-validation.js";
import {
  createContractUseCase,
  MAX_PERSISTED_INSTALLMENT_COUNT,
  validatePersistedInstallmentCount,
} from "../../../src/contracts/application/create-contract.js";
import type { ContractPersistence } from "../../../src/contracts/application/contract-persistence.js";

describe("CreateContract persistence boundary", () => {
  it("accepts the PostgreSQL INTEGER maximum without allocating a schedule", () => {
    expect(
      validatePersistedInstallmentCount(MAX_PERSISTED_INSTALLMENT_COUNT),
    ).toBe(MAX_PERSISTED_INSTALLMENT_COUNT);
  });

  it("rejects an over-limit count before schedule generation or persistence", async () => {
    let persistenceCalled = false;
    const persistence: ContractPersistence = {
      create: async () => {
        persistenceCalled = true;
        throw new Error("Persistence must not be called");
      },
      getById: async () => null,
    };
    const createContract = createContractUseCase({
      clock: { now: () => new Date("2026-08-25T10:11:12.123Z") },
      persistence,
    });

    await expect(
      createContract({
        idempotencyKey: "over-limit-count",
        customerId: 1,
        totalAmountCents: Number.MAX_SAFE_INTEGER,
        currency: "EUR",
        installmentCount: MAX_PERSISTED_INSTALLMENT_COUNT + 1,
        firstDueDate: "2026-01-31",
      }),
    ).rejects.toMatchObject({
      name: "ApplicationInputValidationError",
      cause: { code: "INSTALLMENT_COUNT_EXCEEDS_PERSISTENCE_LIMIT" },
    } satisfies Partial<ApplicationInputValidationError>);
    expect(persistenceCalled).toBe(false);
  });
});
