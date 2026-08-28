import { validateIntegerId } from "../../domain/integer-id.js";

declare const refundIdBrand: unique symbol;

export type RefundId = number & {
  readonly [refundIdBrand]: "RefundId";
};

export function createRefundId(value: number): RefundId {
  return validateIntegerId(value, "RefundId") as RefundId;
}
