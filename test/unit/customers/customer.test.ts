import { describe, expect, it } from "vitest";

import {
  reconstituteCustomer,
  validateCustomerDisplayName,
} from "../../../src/customers/domain/customer.js";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";

describe("Customer", () => {
  it("requires a non-blank display name without normalizing accepted input", () => {
    expect(validateCustomerDisplayName("  Acme  ")).toBe("  Acme  ");
    expect(() => validateCustomerDisplayName("   ")).toThrowError(
      DomainValidationError,
    );
  });

  it("copies the creation instant defensively", () => {
    const createdAt = new Date("2026-08-25T09:10:11.123Z");
    const customer = reconstituteCustomer({
      id: 1,
      displayName: "Acme",
      createdAt,
    });

    createdAt.setUTCFullYear(2030);

    expect(customer.createdAt.toISOString()).toBe("2026-08-25T09:10:11.123Z");
    expect(customer.createdAt).not.toBe(createdAt);

    const exposedDate = customer.createdAt;
    exposedDate.setUTCFullYear(2040);
    expect(customer.createdAt.toISOString()).toBe("2026-08-25T09:10:11.123Z");
  });
});
