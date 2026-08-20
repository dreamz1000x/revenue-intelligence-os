import { DomainValidationError } from "./domain-validation-error.js";

export const MAX_INTEGER_ID = 2_147_483_647;

export function validateIntegerId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > MAX_INTEGER_ID) {
    throw new DomainValidationError(
      "INVALID_ID",
      `${label} must be an integer between 1 and ${MAX_INTEGER_ID}`,
    );
  }

  return value;
}
