import { createHash } from "node:crypto";

import { DomainValidationError } from "../domain/domain-validation-error.js";

export const CREATE_CUSTOMER_COMMAND = "create_customer" as const;
export const CREATE_CONTRACT_COMMAND = "create_contract" as const;
export const RECORD_PAYMENT_COMMAND = "record_payment" as const;
export const RECORD_REFUND_COMMAND = "record_refund" as const;
export const RUN_RECONCILIATION_COMMAND = "run_reconciliation" as const;
export const ACT_ON_RECONCILIATION_FINDING_COMMAND =
  "act_on_reconciliation_finding" as const;

export type CommandType =
  | typeof CREATE_CUSTOMER_COMMAND
  | typeof CREATE_CONTRACT_COMMAND
  | typeof RECORD_PAYMENT_COMMAND
  | typeof RECORD_REFUND_COMMAND
  | typeof RUN_RECONCILIATION_COMMAND
  | typeof ACT_ON_RECONCILIATION_FINDING_COMMAND;

declare const idempotencyKeyBrand: unique symbol;
declare const requestFingerprintBrand: unique symbol;

export type IdempotencyKey = string & {
  readonly [idempotencyKeyBrand]: "IdempotencyKey";
};

export type RequestFingerprint = string & {
  readonly [requestFingerprintBrand]: "RequestFingerprint";
};

export class IdempotencyPayloadConflict extends Error {
  override readonly name = "IdempotencyPayloadConflict";

  constructor() {
    super("The idempotency key is already associated with a different payload");
  }
}

export function createIdempotencyKey(value: string): IdempotencyKey {
  if (value.length < 1 || value.length > 128 || !/^[\x21-\x7e]+$/.test(value)) {
    throw new DomainValidationError(
      "INVALID_IDEMPOTENCY_KEY",
      "Idempotency key must contain 1 to 128 visible ASCII characters without spaces",
    );
  }

  return value as IdempotencyKey;
}

export function canonicalizeCreateCustomerPayload(displayName: string): string {
  return JSON.stringify([displayName]);
}

export function canonicalizeCreateContractPayload(input: {
  readonly customerId: number;
  readonly totalAmountCents: number;
  readonly currency: "EUR";
  readonly installmentCount: number;
  readonly firstDueDate: string;
}): string {
  return JSON.stringify([
    input.customerId,
    input.totalAmountCents,
    input.currency,
    input.installmentCount,
    input.firstDueDate,
  ]);
}

export function canonicalizeRecordPaymentPayload(input: {
  readonly contractId: number;
  readonly amountCents: number;
  readonly receivedAt: Date;
}): string {
  return JSON.stringify([
    input.contractId,
    input.amountCents,
    input.receivedAt.toISOString(),
  ]);
}

export function canonicalizeRecordRefundPayload(input: {
  readonly paymentId: number;
  readonly amountCents: number;
  readonly refundedAt: Date;
}): string {
  return JSON.stringify([
    input.paymentId,
    input.amountCents,
    input.refundedAt.toISOString(),
  ]);
}

export function fingerprintCanonicalPayload(
  canonicalPayload: string,
): RequestFingerprint {
  return createHash("sha256")
    .update(canonicalPayload, "utf8")
    .digest("hex") as RequestFingerprint;
}
