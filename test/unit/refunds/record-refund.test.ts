import { describe, expect, it } from "vitest";

import {
  canonicalizeRecordRefundPayload,
  fingerprintCanonicalPayload,
} from "../../../src/application/idempotency.js";
import { ApplicationInputValidationError } from "../../../src/application/input-validation.js";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import type {
  RecordRefundPersistenceInput,
  RefundPersistence,
} from "../../../src/refunds/application/refund-persistence.js";
import { recordRefundUseCase } from "../../../src/refunds/application/record-refund.js";
import { reconstituteRefund } from "../../../src/refunds/domain/refund.js";

const REFUNDED_AT = new Date("2026-08-28T08:00:00.123Z");
const CREATED_AT = new Date("2026-08-28T09:00:00.456Z");
const REFUND = reconstituteRefund({
  id: 1,
  paymentId: 2,
  amountCents: 300,
  refundedAt: REFUNDED_AT,
  createdAt: CREATED_AT,
  allocations: [{ installmentId: 3, position: 1, amountCents: 300 }],
});

function persistenceReturning(
  outcome: "created" | "replayed",
  capture?: (input: RecordRefundPersistenceInput) => void,
): RefundPersistence {
  return {
    record: async (input) => {
      capture?.(input);
      return { resource: REFUND, outcome };
    },
    getById: async () => null,
  };
}

describe("RecordRefund", () => {
  it("uses the exact canonical payload, Clock, and defensive instant copies", async () => {
    let captured: RecordRefundPersistenceInput | undefined;
    const recordRefund = recordRefundUseCase({
      clock: { now: () => new Date(CREATED_AT) },
      persistence: persistenceReturning("created", (input) => {
        captured = input;
      }),
    });

    const result = await recordRefund({
      idempotencyKey: "record-refund",
      paymentId: 2,
      amountCents: 300,
      refundedAt: new Date(REFUNDED_AT),
    });

    const canonicalPayload = '[2,300,"2026-08-28T08:00:00.123Z"]';
    expect(
      canonicalizeRecordRefundPayload({
        paymentId: 2,
        amountCents: 300,
        refundedAt: REFUNDED_AT,
      }),
    ).toBe(canonicalPayload);
    expect(captured).toMatchObject({
      idempotencyKey: "record-refund",
      paymentId: 2,
      amountCents: 300,
      requestFingerprint: fingerprintCanonicalPayload(canonicalPayload),
    });
    expect(captured?.refundedAt).not.toBe(REFUNDED_AT);
    expect(captured?.createdAt).not.toBe(CREATED_AT);
    expect(result.outcome).toBe("created");
  });

  it("returns the persistence replay outcome unchanged", async () => {
    const recordRefund = recordRefundUseCase({
      clock: { now: () => CREATED_AT },
      persistence: persistenceReturning("replayed"),
    });
    await expect(
      recordRefund({
        idempotencyKey: "refund-replay",
        paymentId: 2,
        amountCents: 300,
        refundedAt: REFUNDED_AT,
      }),
    ).resolves.toEqual({ resource: REFUND, outcome: "replayed" });
  });

  it.each([
    ["Payment ID", { paymentId: 0 }],
    ["amount", { amountCents: 0 }],
    ["refundedAt", { refundedAt: new Date("invalid") }],
    ["idempotency key", { idempotencyKey: "contains space" }],
  ])("rejects invalid %s before persistence", async (_label, override) => {
    let persistenceCalled = false;
    const recordRefund = recordRefundUseCase({
      clock: { now: () => CREATED_AT },
      persistence: {
        record: async () => {
          persistenceCalled = true;
          throw new Error("Persistence must not be called");
        },
        getById: async () => null,
      },
    });

    await expect(
      recordRefund({
        idempotencyKey: "valid-key",
        paymentId: 2,
        amountCents: 300,
        refundedAt: REFUNDED_AT,
        ...override,
      }),
    ).rejects.toBeInstanceOf(ApplicationInputValidationError);
    expect(persistenceCalled).toBe(false);
  });

  it("rejects an invalid Clock instant before persistence", async () => {
    const recordRefund = recordRefundUseCase({
      clock: { now: () => new Date("invalid") },
      persistence: persistenceReturning("created"),
    });
    await expect(
      recordRefund({
        idempotencyKey: "invalid-clock",
        paymentId: 2,
        amountCents: 300,
        refundedAt: REFUNDED_AT,
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });
});
