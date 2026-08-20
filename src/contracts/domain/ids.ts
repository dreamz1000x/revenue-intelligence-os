import { validateIntegerId } from "../../domain/integer-id.js";

declare const contractIdBrand: unique symbol;
declare const installmentIdBrand: unique symbol;

export type ContractId = number & {
  readonly [contractIdBrand]: "ContractId";
};

export type InstallmentId = number & {
  readonly [installmentIdBrand]: "InstallmentId";
};

export function createContractId(value: number): ContractId {
  return validateIntegerId(value, "ContractId") as ContractId;
}

export function createInstallmentId(value: number): InstallmentId {
  return validateIntegerId(value, "InstallmentId") as InstallmentId;
}
