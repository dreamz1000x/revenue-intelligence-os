import type {
  IdempotencyKey,
  RequestFingerprint,
} from "../../application/idempotency.js";
import type { CustomerId } from "../../customers/domain/customer-id.js";
import type { CivilDate } from "../domain/civil-date.js";
import type { Contract } from "../domain/contract.js";
import type { ContractId } from "../domain/ids.js";
import type { InstallmentScheduleItem } from "../domain/installment-schedule.js";
import type { MoneyCents } from "../domain/money-cents.js";

export interface CreateContractPersistenceInput {
  readonly idempotencyKey: IdempotencyKey;
  readonly requestFingerprint: RequestFingerprint;
  readonly customerId: CustomerId;
  readonly totalAmountCents: MoneyCents;
  readonly currency: "EUR";
  readonly installmentCount: number;
  readonly firstDueDate: CivilDate;
  readonly schedule: ReadonlyArray<Readonly<InstallmentScheduleItem>>;
  readonly createdAt: Date;
}

export interface ContractPersistence {
  create(input: CreateContractPersistenceInput): Promise<Contract>;
  getById(id: ContractId): Promise<Contract | null>;
}
