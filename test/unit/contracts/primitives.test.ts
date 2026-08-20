import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import {
  createContractId,
  createInstallmentId,
} from "../../../src/contracts/domain/ids.js";
import { createMoneyCents } from "../../../src/contracts/domain/money-cents.js";

describe("MoneyCents", () => {
  it.each([1, Number.MAX_SAFE_INTEGER])("accepts valid amount %s", (value) => {
    expect(createMoneyCents(value)).toBe(value);
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid amount %s", (value) => {
    expect(() => createMoneyCents(value)).toThrow(DomainValidationError);
  });
});

describe.each([
  ["ContractId", createContractId],
  ["InstallmentId", createInstallmentId],
] as const)("%s", (_name, createId) => {
  it.each([1, 2_147_483_647])("accepts valid ID %s", (value) => {
    expect(createId(value)).toBe(value);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects invalid ID %s",
    (value) => {
      expect(() => createId(value)).toThrow(DomainValidationError);
    },
  );
});
