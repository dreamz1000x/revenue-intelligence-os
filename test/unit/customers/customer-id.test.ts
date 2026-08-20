import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import { createCustomerId } from "../../../src/customers/domain/customer-id.js";

describe("CustomerId", () => {
  it.each([1, 2_147_483_647])("accepts valid ID %s", (value) => {
    expect(createCustomerId(value)).toBe(value);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    "rejects invalid ID %s",
    (value) => {
      expect(() => createCustomerId(value)).toThrow(DomainValidationError);
    },
  );
});
