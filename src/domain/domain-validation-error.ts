export class DomainValidationError extends Error {
  override readonly name = "DomainValidationError";

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
