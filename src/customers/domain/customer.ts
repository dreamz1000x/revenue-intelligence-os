import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createCustomerId, type CustomerId } from "./customer-id.js";

export interface Customer {
  readonly id: CustomerId;
  readonly displayName: string;
  readonly createdAt: Date;
}

export function validateCustomerDisplayName(value: string): string {
  if (value.trim().length === 0) {
    throw new DomainValidationError(
      "INVALID_CUSTOMER_DISPLAY_NAME",
      "Customer display name must not be empty",
    );
  }

  return value;
}

export function reconstituteCustomer(input: {
  id: number;
  displayName: string;
  createdAt: Date;
}): Customer {
  if (Number.isNaN(input.createdAt.getTime())) {
    throw new DomainValidationError(
      "INVALID_CREATED_AT",
      "Customer creation instant must be valid",
    );
  }

  const createdAt = new Date(input.createdAt.getTime());

  return {
    id: createCustomerId(input.id),
    displayName: validateCustomerDisplayName(input.displayName),
    get createdAt() {
      return new Date(createdAt.getTime());
    },
  };
}
