import type { Clock } from "../../application/clock.js";
import type { CreateCommandResult } from "../../application/create-command-result.js";
import { validateApplicationInput } from "../../application/input-validation.js";
import {
  canonicalizeRecordRefundPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
} from "../../application/idempotency.js";
import { createMoneyCents } from "../../contracts/domain/money-cents.js";
import { createPaymentId } from "../../payments/domain/ids.js";
import { copyRefundInstant, type Refund } from "../domain/refund.js";
import type { RefundPersistence } from "./refund-persistence.js";

export interface RecordRefundCommand {
  readonly idempotencyKey: string;
  readonly paymentId: number;
  readonly amountCents: number;
  readonly refundedAt: Date;
}

export function recordRefundUseCase(dependencies: {
  readonly clock: Clock;
  readonly persistence: RefundPersistence;
}) {
  return async (
    command: RecordRefundCommand,
  ): Promise<CreateCommandResult<Refund>> => {
    const { idempotencyKey, paymentId, amountCents, refundedAt } =
      validateApplicationInput(() => ({
        idempotencyKey: createIdempotencyKey(command.idempotencyKey),
        paymentId: createPaymentId(command.paymentId),
        amountCents: createMoneyCents(command.amountCents),
        refundedAt: copyRefundInstant(command.refundedAt, "Refund refundedAt"),
      }));
    const createdAt = copyRefundInstant(
      dependencies.clock.now(),
      "Refund createdAt",
    );
    const requestFingerprint = fingerprintCanonicalPayload(
      canonicalizeRecordRefundPayload({ paymentId, amountCents, refundedAt }),
    );

    return dependencies.persistence.record({
      idempotencyKey,
      requestFingerprint,
      paymentId,
      amountCents,
      refundedAt,
      createdAt,
    });
  };
}
