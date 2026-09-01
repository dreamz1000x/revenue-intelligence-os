import { validateApplicationInput } from "../../application/input-validation.js";
import { createPaymentId, type PaymentId } from "../domain/ids.js";
import type { Payment } from "../domain/payment.js";
import type { PaymentPersistence } from "./payment-persistence.js";

export function getPaymentByIdUseCase(persistence: PaymentPersistence) {
  return async (id: number | PaymentId): Promise<Payment | null> => {
    const paymentId = validateApplicationInput(() => createPaymentId(id));
    return persistence.getById(paymentId);
  };
}
