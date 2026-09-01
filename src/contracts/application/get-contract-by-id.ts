import { validateApplicationInput } from "../../application/input-validation.js";
import type { Contract } from "../domain/contract.js";
import { createContractId, type ContractId } from "../domain/ids.js";
import type { ContractPersistence } from "./contract-persistence.js";

export function getContractByIdUseCase(persistence: ContractPersistence) {
  return async (id: number | ContractId): Promise<Contract | null> => {
    const contractId = validateApplicationInput(() => createContractId(id));
    return persistence.getById(contractId);
  };
}
