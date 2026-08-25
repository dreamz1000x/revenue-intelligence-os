import { validateIntegerId } from "../../domain/integer-id.js";

declare const paymentIdBrand: unique symbol;

export type PaymentId = number & {
  readonly [paymentIdBrand]: "PaymentId";
};

export function createPaymentId(value: number): PaymentId {
  return validateIntegerId(value, "PaymentId") as PaymentId;
}
