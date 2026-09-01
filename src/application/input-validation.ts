import { DomainValidationError } from "../domain/domain-validation-error.js";

export class ApplicationInputValidationError extends Error {
  override readonly name = "ApplicationInputValidationError";

  constructor(override readonly cause: DomainValidationError) {
    super("Application input validation failed");
  }
}

export function validateApplicationInput<T>(validation: () => T): T {
  try {
    return validation();
  } catch (error) {
    if (error instanceof DomainValidationError) {
      throw new ApplicationInputValidationError(error);
    }
    throw error;
  }
}
