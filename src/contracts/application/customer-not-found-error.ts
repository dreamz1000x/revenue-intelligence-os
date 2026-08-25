import type { CustomerId } from "../../customers/domain/customer-id.js";

export class CustomerNotFoundError extends Error {
  override readonly name = "CustomerNotFoundError";

  constructor(readonly customerId: CustomerId) {
    super(`Customer ${customerId} was not found`);
  }
}
