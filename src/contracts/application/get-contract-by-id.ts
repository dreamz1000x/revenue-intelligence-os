import type { Contract } from "../domain/contract.js";
import { createContractId, type ContractId } from "../domain/ids.js";
import type { ContractPersistence } from "./contract-persistence.js";

export function getContractByIdUseCase(persistence: ContractPersistence) {
  return async (id: number | ContractId): Promise<Contract | null> =>
    persistence.getById(createContractId(id));
}
