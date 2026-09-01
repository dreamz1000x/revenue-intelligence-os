import { validateApplicationInput } from "../../application/input-validation.js";
import { createRefundId, type RefundId } from "../domain/ids.js";
import type { Refund } from "../domain/refund.js";
import type { RefundPersistence } from "./refund-persistence.js";

export function getRefundByIdUseCase(persistence: RefundPersistence) {
  return async (id: number | RefundId): Promise<Refund | null> => {
    const refundId = validateApplicationInput(() => createRefundId(id));
    return persistence.getById(refundId);
  };
}
