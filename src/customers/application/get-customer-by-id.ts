import { createCustomerId, type CustomerId } from "../domain/customer-id.js";
import type { Customer } from "../domain/customer.js";
import type { CustomerPersistence } from "./customer-persistence.js";

export function getCustomerByIdUseCase(persistence: CustomerPersistence) {
  return async (id: number | CustomerId): Promise<Customer | null> =>
    persistence.getById(createCustomerId(id));
}
