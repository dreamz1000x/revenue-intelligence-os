import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import {
  derivePaymentRecordedLedgerEntry,
  deriveRefundRecordedLedgerEntry,
  reconstituteLedgerEntry,
} from "../../../src/ledger/domain/ledger-entry.js";
import { reconstitutePayment } from "../../../src/payments/domain/payment.js";
import { reconstituteRefund } from "../../../src/refunds/domain/refund.js";

const EVENT_AT = new Date("2026-08-25T08:00:00.123Z");
const RECORDED_AT = new Date("2026-08-25T12:00:00.456Z");

function payment() {
  return reconstitutePayment({
    id: 7,
    contractId: 3,
    amountCents: 10_000,
    receivedAt: EVENT_AT,
    createdAt: RECORDED_AT,
    allocations: [
      { installmentId: 11, position: 1, amountCents: 6_000 },
      { installmentId: 12, position: 2, amountCents: 4_000 },
    ],
  });
}

function persistedInput() {
  return {
    id: 5,
    paymentId: 7,
    refundId: null,
    effectType: "payment_recorded",
    amountCents: 10_000,
    currency: "EUR",
    eventAt: EVENT_AT,
    recordedAt: RECORDED_AT,
  };
}

function refund() {
  return reconstituteRefund({
    id: 9,
    paymentId: 7,
    amountCents: 4_000,
    refundedAt: EVENT_AT,
    createdAt: RECORDED_AT,
    allocations: [
      { installmentId: 12, position: 2, amountCents: 3_000 },
      { installmentId: 11, position: 1, amountCents: 1_000 },
    ],
  });
}

describe("LedgerEntry", () => {
  it("derives the exact immutable payment_recorded effect from Payment", () => {
    const source = payment();
    const sourceEventAt = source.receivedAt;
    const sourceRecordedAt = source.createdAt;
    const draft = derivePaymentRecordedLedgerEntry(source);

    expect(draft).toMatchObject({
      paymentId: source.id,
      effectType: "payment_recorded",
      amountCents: source.amountCents,
      currency: "EUR",
    });
    expect(draft.eventAt).toEqual(sourceEventAt);
    expect(draft.recordedAt).toEqual(sourceRecordedAt);
    expect(draft.eventAt).not.toBe(sourceEventAt);
    expect(draft.recordedAt).not.toBe(sourceRecordedAt);
    expect(Object.isFrozen(draft)).toBe(true);

    draft.eventAt.setUTCFullYear(2030);
    draft.recordedAt.setUTCFullYear(2030);
    expect(draft.eventAt).toEqual(EVENT_AT);
    expect(draft.recordedAt).toEqual(RECORDED_AT);
  });

  it("reconstitutes a persisted immutable LedgerEntry", () => {
    const input = persistedInput();
    const entry = reconstituteLedgerEntry(input);

    expect(entry).toMatchObject({
      id: 5,
      paymentId: 7,
      effectType: "payment_recorded",
      amountCents: 10_000,
      currency: "EUR",
    });
    expect(entry.eventAt).toEqual(EVENT_AT);
    expect(entry.recordedAt).toEqual(RECORDED_AT);
    expect(entry.eventAt).not.toBe(input.eventAt);
    expect(entry.recordedAt).not.toBe(input.recordedAt);
    expect(Object.isFrozen(entry)).toBe(true);

    entry.eventAt.setUTCFullYear(2030);
    entry.recordedAt.setUTCFullYear(2030);
    expect(entry.eventAt).toEqual(EVENT_AT);
    expect(entry.recordedAt).toEqual(RECORDED_AT);
  });

  it("derives the exact immutable refund_recorded effect from Refund", () => {
    const source = refund();
    const sourceEventAt = source.refundedAt;
    const sourceRecordedAt = source.createdAt;
    const draft = deriveRefundRecordedLedgerEntry(source);

    expect(draft).toMatchObject({
      refundId: source.id,
      effectType: "refund_recorded",
      amountCents: source.amountCents,
      currency: "EUR",
    });
    expect(draft.eventAt).toEqual(sourceEventAt);
    expect(draft.recordedAt).toEqual(sourceRecordedAt);
    expect(draft.eventAt).not.toBe(sourceEventAt);
    expect(draft.recordedAt).not.toBe(sourceRecordedAt);
    expect(Object.isFrozen(draft)).toBe(true);
  });

  it("reconstitutes a persisted immutable Refund-backed LedgerEntry", () => {
    const input = {
      ...persistedInput(),
      paymentId: null,
      refundId: 9,
      effectType: "refund_recorded",
      amountCents: 4_000,
    };
    const entry = reconstituteLedgerEntry(input);

    expect(entry).toMatchObject({
      id: 5,
      refundId: 9,
      effectType: "refund_recorded",
      amountCents: 4_000,
      currency: "EUR",
    });
    expect("paymentId" in entry).toBe(false);
    expect(Object.isFrozen(entry)).toBe(true);

    entry.eventAt.setUTCFullYear(2030);
    entry.recordedAt.setUTCFullYear(2030);
    expect(entry.eventAt).toEqual(EVENT_AT);
    expect(entry.recordedAt).toEqual(RECORDED_AT);
  });

  it.each([
    ["payment effect without a source", { paymentId: null }],
    ["payment effect with both sources", { refundId: 9 }],
    [
      "Refund effect without a source",
      { paymentId: null, refundId: null, effectType: "refund_recorded" },
    ],
    [
      "Refund effect with a Payment source",
      { paymentId: 7, refundId: 9, effectType: "refund_recorded" },
    ],
    [
      "Refund effect with only a Payment source",
      { paymentId: 7, refundId: null, effectType: "refund_recorded" },
    ],
  ])("rejects an invalid source/effect combination: %s", (_label, override) => {
    expect(() =>
      reconstituteLedgerEntry({ ...persistedInput(), ...override }),
    ).toThrow(DomainValidationError);
  });

  it.each([
    ["LedgerEntry ID", { id: 0 }],
    ["Payment ID", { paymentId: 0 }],
    [
      "Refund ID",
      { paymentId: null, refundId: 0, effectType: "refund_recorded" },
    ],
    ["effect type", { effectType: "unsupported" }],
    ["amount", { amountCents: 0 }],
    ["currency", { currency: "USD" }],
    ["eventAt", { eventAt: new Date(Number.NaN) }],
    ["recordedAt", { recordedAt: new Date(Number.NaN) }],
  ])("rejects an invalid %s", (_label, override) => {
    expect(() =>
      reconstituteLedgerEntry({ ...persistedInput(), ...override }),
    ).toThrow(DomainValidationError);
  });
});
