import { describe, expect, it } from "vitest";

import {
  canonicalizeRecordPaymentPayload,
  fingerprintCanonicalPayload,
} from "../../../src/application/idempotency.js";
import { ApplicationInputValidationError } from "../../../src/application/input-validation.js";
import type {
  PaymentPersistence,
  RecordPaymentPersistenceInput,
} from "../../../src/payments/application/payment-persistence.js";
import { recordPaymentUseCase } from "../../../src/payments/application/record-payment.js";
import { reconstitutePayment } from "../../../src/payments/domain/payment.js";

const RECEIVED_AT = new Date("2026-08-25T08:00:00.123Z");
const CREATED_AT = new Date("2026-08-25T09:00:00.456Z");
const PAYMENT = reconstitutePayment({
  id: 1,
  contractId: 2,
  amountCents: 1_000,
  receivedAt: RECEIVED_AT,
  createdAt: CREATED_AT,
  allocations: [{ installmentId: 3, position: 1, amountCents: 1_000 }],
});

describe("RecordPayment", () => {
  it("uses the exact approved canonical payload and fingerprint", async () => {
    let captured: RecordPaymentPersistenceInput | undefined;
    const persistence: PaymentPersistence = {
      record: async (input) => {
        captured = input;
        return { resource: PAYMENT, outcome: "created" };
      },
      getById: async () => null,
    };
    const recordPayment = recordPaymentUseCase({
      clock: { now: () => new Date(CREATED_AT) },
      persistence,
    });

    await recordPayment({
      idempotencyKey: "record-payment",
      contractId: 2,
      amountCents: 1_000,
      receivedAt: new Date(RECEIVED_AT),
    });

    const canonicalPayload = '[2,1000,"2026-08-25T08:00:00.123Z"]';
    expect(
      canonicalizeRecordPaymentPayload({
        contractId: 2,
        amountCents: 1_000,
        receivedAt: RECEIVED_AT,
      }),
    ).toBe(canonicalPayload);
    expect(captured).toMatchObject({
      idempotencyKey: "record-payment",
      contractId: 2,
      amountCents: 1_000,
      requestFingerprint: fingerprintCanonicalPayload(canonicalPayload),
    });
    expect(captured?.receivedAt).not.toBe(RECEIVED_AT);
    expect(captured?.createdAt).not.toBe(CREATED_AT);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid Payment amount %s before persistence",
    async (amountCents) => {
      let persistenceCalled = false;
      const recordPayment = recordPaymentUseCase({
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
        recordPayment({
          idempotencyKey: "invalid-amount",
          contractId: 2,
          amountCents,
          receivedAt: RECEIVED_AT,
        }),
      ).rejects.toBeInstanceOf(ApplicationInputValidationError);
      expect(persistenceCalled).toBe(false);
    },
  );

  it("rejects an invalid receivedAt before persistence", async () => {
    const recordPayment = recordPaymentUseCase({
      clock: { now: () => CREATED_AT },
      persistence: {
        record: async () => {
          throw new Error("Persistence must not be called");
        },
        getById: async () => null,
      },
    });

    await expect(
      recordPayment({
        idempotencyKey: "invalid-received-at",
        contractId: 2,
        amountCents: 1_000,
        receivedAt: new Date("invalid"),
      }),
    ).rejects.toBeInstanceOf(ApplicationInputValidationError);
  });
});
