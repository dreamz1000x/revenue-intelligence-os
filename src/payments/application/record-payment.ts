import type { Clock } from "../../application/clock.js";
import type { CreateCommandResult } from "../../application/create-command-result.js";
import { validateApplicationInput } from "../../application/input-validation.js";
import {
  canonicalizeRecordPaymentPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
} from "../../application/idempotency.js";
import { createContractId } from "../../contracts/domain/ids.js";
import { createMoneyCents } from "../../contracts/domain/money-cents.js";
import { copyPaymentInstant, type Payment } from "../domain/payment.js";
import type { PaymentPersistence } from "./payment-persistence.js";

export interface RecordPaymentCommand {
  readonly idempotencyKey: string;
  readonly contractId: number;
  readonly amountCents: number;
  readonly receivedAt: Date;
}

export function recordPaymentUseCase(dependencies: {
  readonly clock: Clock;
  readonly persistence: PaymentPersistence;
}) {
  return async (
    command: RecordPaymentCommand,
  ): Promise<CreateCommandResult<Payment>> => {
    const { idempotencyKey, contractId, amountCents, receivedAt } =
      validateApplicationInput(() => ({
        idempotencyKey: createIdempotencyKey(command.idempotencyKey),
        contractId: createContractId(command.contractId),
        amountCents: createMoneyCents(command.amountCents),
        receivedAt: copyPaymentInstant(command.receivedAt, "Payment receivedAt"),
      }));
    const createdAt = copyPaymentInstant(
      dependencies.clock.now(),
      "Payment createdAt",
    );
    const requestFingerprint = fingerprintCanonicalPayload(
      canonicalizeRecordPaymentPayload({
        contractId,
        amountCents,
        receivedAt,
      }),
    );

    return dependencies.persistence.record({
      idempotencyKey,
      requestFingerprint,
      contractId,
      amountCents,
      receivedAt,
      createdAt,
    });
  };
}
