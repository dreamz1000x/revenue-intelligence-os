import { DomainValidationError } from "../../domain/domain-validation-error.js";

declare const moneyCentsBrand: unique symbol;

export type MoneyCents = number & {
  readonly [moneyCentsBrand]: "MoneyCents";
};

export function createMoneyCents(value: number): MoneyCents {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new DomainValidationError(
      "INVALID_MONEY_CENTS",
      `MoneyCents must be a safe integer between 1 and ${Number.MAX_SAFE_INTEGER}`,
    );
  }

  return value as MoneyCents;
}
