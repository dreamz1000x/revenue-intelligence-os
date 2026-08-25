import type { CreateCommandResult } from "../../application/create-command-result.js";
import type {
  IdempotencyKey,
  RequestFingerprint,
} from "../../application/idempotency.js";
import type { ContractId } from "../../contracts/domain/ids.js";
import type { MoneyCents } from "../../contracts/domain/money-cents.js";
import type { PaymentId } from "../domain/ids.js";
import type { Payment } from "../domain/payment.js";

export interface RecordPaymentPersistenceInput {
  readonly idempotencyKey: IdempotencyKey;
  readonly requestFingerprint: RequestFingerprint;
  readonly contractId: ContractId;
  readonly amountCents: MoneyCents;
  readonly receivedAt: Date;
  readonly createdAt: Date;
}

export interface PaymentPersistence {
  record(
    input: RecordPaymentPersistenceInput,
  ): Promise<CreateCommandResult<Payment>>;
  getById(id: PaymentId): Promise<Payment | null>;
}
