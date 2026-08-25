import type {
  IdempotencyKey,
  RequestFingerprint,
} from "../../application/idempotency.js";
import type { CreateCommandResult } from "../../application/create-command-result.js";
import type { Customer } from "../domain/customer.js";
import type { CustomerId } from "../domain/customer-id.js";

export interface CreateCustomerPersistenceInput {
  readonly idempotencyKey: IdempotencyKey;
  readonly requestFingerprint: RequestFingerprint;
  readonly displayName: string;
  readonly createdAt: Date;
}

export interface CustomerPersistence {
  create(input: CreateCustomerPersistenceInput): Promise<CreateCommandResult<Customer>>;
  getById(id: CustomerId): Promise<Customer | null>;
}
