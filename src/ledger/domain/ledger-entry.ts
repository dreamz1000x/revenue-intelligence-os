import { CONTRACT_CURRENCY } from "../../contracts/domain/contract.js";
import { createMoneyCents, type MoneyCents } from "../../contracts/domain/money-cents.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createPaymentId, type PaymentId } from "../../payments/domain/ids.js";
import type { Payment } from "../../payments/domain/payment.js";
import { createLedgerEntryId, type LedgerEntryId } from "./ids.js";

export const PAYMENT_RECORDED_EFFECT_TYPE = "payment_recorded" as const;

export type FinancialEffectType = typeof PAYMENT_RECORDED_EFFECT_TYPE;

export interface PaymentRecordedLedgerEntryDraft {
  readonly paymentId: PaymentId;
  readonly effectType: FinancialEffectType;
  readonly amountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}

export interface LedgerEntry extends PaymentRecordedLedgerEntryDraft {
  readonly id: LedgerEntryId;
}

function copyLedgerInstant(value: Date, label: string): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new DomainValidationError(
      "INVALID_LEDGER_INSTANT",
      `${label} must be a valid instant`,
    );
  }
  return new Date(value.getTime());
}

function immutableLedgerValues(input: {
  readonly paymentId: PaymentId;
  readonly effectType: FinancialEffectType;
  readonly amountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}): PaymentRecordedLedgerEntryDraft {
  const eventAt = copyLedgerInstant(input.eventAt, "LedgerEntry eventAt");
  const recordedAt = copyLedgerInstant(input.recordedAt, "LedgerEntry recordedAt");

  return Object.freeze({
    paymentId: input.paymentId,
    effectType: input.effectType,
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

export function derivePaymentRecordedLedgerEntry(
  payment: Payment,
): PaymentRecordedLedgerEntryDraft {
  return immutableLedgerValues({
    paymentId: payment.id,
    effectType: PAYMENT_RECORDED_EFFECT_TYPE,
    amountCents: payment.amountCents,
    currency: CONTRACT_CURRENCY,
    eventAt: payment.receivedAt,
    recordedAt: payment.createdAt,
  });
}

export function reconstituteLedgerEntry(input: {
  readonly id: number;
  readonly paymentId: number;
  readonly effectType: string;
  readonly amountCents: number;
  readonly currency: string;
  readonly eventAt: Date;
  readonly recordedAt: Date;
}): LedgerEntry {
  if (input.effectType !== PAYMENT_RECORDED_EFFECT_TYPE) {
    throw new DomainValidationError(
      "INVALID_FINANCIAL_EFFECT_TYPE",
      "LedgerEntry effectType must be payment_recorded",
    );
  }
  if (input.currency !== CONTRACT_CURRENCY) {
    throw new DomainValidationError(
      "INVALID_LEDGER_CURRENCY",
      "LedgerEntry currency must be EUR",
    );
  }

  const id = createLedgerEntryId(input.id);
  const values = immutableLedgerValues({
    paymentId: createPaymentId(input.paymentId),
    effectType: input.effectType,
    amountCents: createMoneyCents(input.amountCents),
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
