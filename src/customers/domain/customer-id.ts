import { validateIntegerId } from "../../domain/integer-id.js";

declare const customerIdBrand: unique symbol;

export type CustomerId = number & {
  readonly [customerIdBrand]: "CustomerId";
};

export function createCustomerId(value: number): CustomerId {
  return validateIntegerId(value, "CustomerId") as CustomerId;
}
