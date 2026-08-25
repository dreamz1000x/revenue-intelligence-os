import type { Clock } from "../../application/clock.js";
import {
  canonicalizeCreateCustomerPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
} from "../../application/idempotency.js";
import { validateCustomerDisplayName, type Customer } from "../domain/customer.js";
import type { CustomerPersistence } from "./customer-persistence.js";

export interface CreateCustomerCommand {
  readonly idempotencyKey: string;
  readonly displayName: string;
}

export function createCustomerUseCase(dependencies: {
  readonly clock: Clock;
  readonly persistence: CustomerPersistence;
}) {
  return async (command: CreateCustomerCommand): Promise<Customer> => {
    const displayName = validateCustomerDisplayName(command.displayName);
    const idempotencyKey = createIdempotencyKey(command.idempotencyKey);
    const requestFingerprint = fingerprintCanonicalPayload(
      canonicalizeCreateCustomerPayload(displayName),
    );
    const createdAt = new Date(dependencies.clock.now().getTime());

    return dependencies.persistence.create({
      idempotencyKey,
      requestFingerprint,
      displayName,
      createdAt,
    });
  };
}
