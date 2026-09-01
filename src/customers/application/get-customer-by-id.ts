import { validateApplicationInput } from "../../application/input-validation.js";
import { createCustomerId, type CustomerId } from "../domain/customer-id.js";
import type { Customer } from "../domain/customer.js";
import type { CustomerPersistence } from "./customer-persistence.js";

export function getCustomerByIdUseCase(persistence: CustomerPersistence) {
  return async (id: number | CustomerId): Promise<Customer | null> => {
    const customerId = validateApplicationInput(() => createCustomerId(id));
    return persistence.getById(customerId);
  };
}
