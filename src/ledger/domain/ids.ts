import { validateIntegerId } from "../../domain/integer-id.js";

declare const ledgerEntryIdBrand: unique symbol;

export type LedgerEntryId = number & {
  readonly [ledgerEntryIdBrand]: "LedgerEntryId";
};

export function createLedgerEntryId(value: number): LedgerEntryId {
  return validateIntegerId(value, "LedgerEntryId") as LedgerEntryId;
}
