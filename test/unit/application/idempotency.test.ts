import { describe, expect, it } from "vitest";

import {
  canonicalizeCreateContractPayload,
  canonicalizeCreateCustomerPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
} from "../../../src/application/idempotency.js";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";

describe("command idempotency primitives", () => {
  it("uses a fixed positional JSON array as the customer canonical payload", () => {
    expect(canonicalizeCreateCustomerPayload("Acme, Inc.")).toBe(
      '["Acme, Inc."]',
    );
  });

  it("uses the approved fixed positional array for a Contract payload", () => {
    expect(
      canonicalizeCreateContractPayload({
        customerId: 7,
        totalAmountCents: 10_000,
        currency: "EUR",
        installmentCount: 3,
        firstDueDate: "2026-01-31",
      }),
    ).toBe('[7,10000,"EUR",3,"2026-01-31"]');
  });

  it("produces a deterministic lowercase SHA-256 fingerprint", () => {
    const canonicalPayload = canonicalizeCreateCustomerPayload("Acme");
    const first = fingerprintCanonicalPayload(canonicalPayload);
    const second = fingerprintCanonicalPayload(canonicalPayload);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(["", "contains space", "café", "line\nbreak", "a".repeat(129)])(
    "rejects invalid idempotency key %j",
    (value) => {
      expect(() => createIdempotencyKey(value)).toThrowError(
        DomainValidationError,
      );
    },
  );

  it("preserves the exact case-sensitive key", () => {
    expect(createIdempotencyKey("Case-Sensitive_Key!")).toBe(
      "Case-Sensitive_Key!",
    );
  });
});
