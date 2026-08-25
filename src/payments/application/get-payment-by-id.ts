import { createPaymentId, type PaymentId } from "../domain/ids.js";
import type { Payment } from "../domain/payment.js";
import type { PaymentPersistence } from "./payment-persistence.js";

export function getPaymentByIdUseCase(persistence: PaymentPersistence) {
  return async (id: number | PaymentId): Promise<Payment | null> =>
    persistence.getById(createPaymentId(id));
}
