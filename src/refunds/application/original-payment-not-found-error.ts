import type { PaymentId } from "../../payments/domain/ids.js";

export class OriginalPaymentNotFoundError extends Error {
  override readonly name = "OriginalPaymentNotFoundError";

  constructor(readonly paymentId: PaymentId) {
    super(`Original Payment ${paymentId} was not found`);
  }
}
