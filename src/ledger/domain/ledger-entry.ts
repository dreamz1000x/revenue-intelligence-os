import { CONTRACT_CURRENCY } from "../../contracts/domain/contract.js";
import { createMoneyCents, type MoneyCents } from "../../contracts/domain/money-cents.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createPaymentId, type PaymentId } from "../../payments/domain/ids.js";
import type { Payment } from "../../payments/domain/payment.js";
import { createRefundId, type RefundId } from "../../refunds/domain/ids.js";
import type { Refund } from "../../refunds/domain/refund.js";
import { createLedgerEntryId, type LedgerEntryId } from "./ids.js";

export const PAYMENT_RECORDED_EFFECT_TYPE = "payment_recorded" as const;
export const REFUND_RECORDED_EFFECT_TYPE = "refund_recorded" as const;

export type FinancialEffectType =
  | typeof PAYMENT_RECORDED_EFFECT_TYPE
  | typeof REFUND_RECORDED_EFFECT_TYPE;

interface LedgerEntryValues {
  readonly amountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}

export interface PaymentRecordedLedgerEntryDraft extends LedgerEntryValues {
  readonly paymentId: PaymentId;
  readonly effectType: typeof PAYMENT_RECORDED_EFFECT_TYPE;
}

export interface RefundRecordedLedgerEntryDraft extends LedgerEntryValues {
  readonly refundId: RefundId;
  readonly effectType: typeof REFUND_RECORDED_EFFECT_TYPE;
}

export type FinancialEffectLedgerEntryDraft =
  | PaymentRecordedLedgerEntryDraft
  | RefundRecordedLedgerEntryDraft;

export type LedgerEntry = FinancialEffectLedgerEntryDraft & {
  readonly id: LedgerEntryId;
};

function copyLedgerInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainValidationError(
      "INVALID_LEDGER_INSTANT",
      `${label} must be a valid instant`,
    );
  }
  return new Date(value.getTime());
}

function immutableCommonValues(input: {
  readonly amountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}): LedgerEntryValues {
  const eventAt = copyLedgerInstant(input.eventAt, "LedgerEntry eventAt");
  const recordedAt = copyLedgerInstant(input.recordedAt, "LedgerEntry recordedAt");

  return Object.freeze({
    amountCents: input.amountCents,
    currency: input.currency,
    get eventAt() {
      return new Date(eventAt.getTime());
    },
    get recordedAt() {
      return new Date(recordedAt.getTime());
    },
  });
}

function immutablePaymentRecordedValues(input: {
  readonly paymentId: PaymentId;
  readonly amountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}): PaymentRecordedLedgerEntryDraft {
  const common = immutableCommonValues(input);
  return Object.freeze({
    paymentId: input.paymentId,
    effectType: PAYMENT_RECORDED_EFFECT_TYPE,
    amountCents: common.amountCents,
    currency: common.currency,
    get eventAt() {
      return common.eventAt;
    },
    get recordedAt() {
      return common.recordedAt;
    },
  });
}

function immutableRefundRecordedValues(input: {
  readonly refundId: RefundId;
  readonly amountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}): RefundRecordedLedgerEntryDraft {
  const common = immutableCommonValues(input);
  return Object.freeze({
    refundId: input.refundId,
    effectType: REFUND_RECORDED_EFFECT_TYPE,
    amountCents: common.amountCents,
    currency: common.currency,
    get eventAt() {
      return common.eventAt;
    },
    get recordedAt() {
      return common.recordedAt;
    },
  });
}

export function derivePaymentRecordedLedgerEntry(
  payment: Payment,
): PaymentRecordedLedgerEntryDraft {
  return immutablePaymentRecordedValues({
    paymentId: payment.id,
    amountCents: payment.amountCents,
    currency: CONTRACT_CURRENCY,
    eventAt: payment.receivedAt,
    recordedAt: payment.createdAt,
  });
}

export function deriveRefundRecordedLedgerEntry(
  refund: Refund,
): RefundRecordedLedgerEntryDraft {
  return immutableRefundRecordedValues({
    refundId: refund.id,
    amountCents: refund.amountCents,
    currency: CONTRACT_CURRENCY,
    eventAt: refund.refundedAt,
    recordedAt: refund.createdAt,
  });
}

export function reconstituteLedgerEntry(input: {
  readonly id: number;
  readonly paymentId?: number | null;
  readonly refundId?: number | null;
  readonly effectType: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}): LedgerEntry {
  if (
    input.effectType !== PAYMENT_RECORDED_EFFECT_TYPE &&
    input.effectType !== REFUND_RECORDED_EFFECT_TYPE
  ) {
    throw new DomainValidationError(
      "INVALID_FINANCIAL_EFFECT_TYPE",
      "LedgerEntry effectType is not supported",
    );
  }
  if (input.currency !== CONTRACT_CURRENCY) {
    throw new DomainValidationError(
      "INVALID_LEDGER_CURRENCY",
      "LedgerEntry currency must be EUR",
    );
  }

  const id = createLedgerEntryId(input.id);
  const amountCents = createMoneyCents(input.amountCents);
  if (input.effectType === PAYMENT_RECORDED_EFFECT_TYPE) {
    if (input.paymentId == null || input.refundId != null) {
      throw new DomainValidationError(
        "INVALID_LEDGER_SOURCE",
        "payment_recorded must have only a Payment source",
      );
    }
    const values = immutablePaymentRecordedValues({
      paymentId: createPaymentId(input.paymentId),
      amountCents,
      currency: input.currency,
      eventAt: input.eventAt,
      recordedAt: input.recordedAt,
    });
    return Object.freeze({
      id,
      paymentId: values.paymentId,
      effectType: values.effectType,
      amountCents: values.amountCents,
      currency: values.currency,
      get eventAt() {
        return values.eventAt;
      },
      get recordedAt() {
        return values.recordedAt;
      },
    });
  }

  if (input.refundId == null || input.paymentId != null) {
    throw new DomainValidationError(
      "INVALID_LEDGER_SOURCE",
      "refund_recorded must have only a Refund source",
    );
  }
  const values = immutableRefundRecordedValues({
    refundId: createRefundId(input.refundId),
    amountCents,
    currency: input.currency,
    eventAt: input.eventAt,
    recordedAt: input.recordedAt,
  });
  return Object.freeze({
    id,
    refundId: values.refundId,
    effectType: values.effectType,
    amountCents: values.amountCents,
    currency: values.currency,
    get eventAt() {
      return values.eventAt;
    },
    get recordedAt() {
      return values.recordedAt;
    },
  });
}
