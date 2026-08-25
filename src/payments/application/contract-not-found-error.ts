import type { ContractId } from "../../contracts/domain/ids.js";

export class ContractNotFoundError extends Error {
  override readonly name = "ContractNotFoundError";

  constructor(readonly contractId: ContractId) {
    super(`Contract ${contractId} was not found`);
  }
}
