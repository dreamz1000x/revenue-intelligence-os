import type { CreateCommandResult } from "../../application/create-command-result.js";
import type {
  IdempotencyKey,
  RequestFingerprint,
} from "../../application/idempotency.js";
import type { MoneyCents } from "../../contracts/domain/money-cents.js";
import type { PaymentId } from "../../payments/domain/ids.js";
import type { RefundId } from "../domain/ids.js";
import type { Refund } from "../domain/refund.js";

export interface RecordRefundPersistenceInput {
  readonly idempotencyKey: IdempotencyKey;
  readonly requestFingerprint: RequestFingerprint;
  readonly paymentId: PaymentId;
  readonly amountCents: MoneyCents;
  readonly refundedAt: Date;
  readonly createdAt: Date;
}

export interface RefundPersistence {
  record(
    input: RecordRefundPersistenceInput,
  ): Promise<CreateCommandResult<Refund>>;
  getById(id: RefundId): Promise<Refund | null>;
}
