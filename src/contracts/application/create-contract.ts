import type { Clock } from "../../application/clock.js";
import type { CreateCommandResult } from "../../application/create-command-result.js";
import {
  canonicalizeCreateContractPayload,
  createIdempotencyKey,
  fingerprintCanonicalPayload,
} from "../../application/idempotency.js";
import { createCustomerId } from "../../customers/domain/customer-id.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createCivilDate } from "../domain/civil-date.js";
import {
  CONTRACT_CURRENCY,
  validateContractCurrency,
  type Contract,
} from "../domain/contract.js";
import { generateInstallmentSchedule } from "../domain/installment-schedule.js";
import { createMoneyCents } from "../domain/money-cents.js";
import type { ContractPersistence } from "./contract-persistence.js";

export const MAX_PERSISTED_INSTALLMENT_COUNT = 2_147_483_647;

export function validatePersistedInstallmentCount(value: number): number {
  if (value > MAX_PERSISTED_INSTALLMENT_COUNT) {
    throw new DomainValidationError(
      "INSTALLMENT_COUNT_EXCEEDS_PERSISTENCE_LIMIT",
      `Installment count cannot exceed ${MAX_PERSISTED_INSTALLMENT_COUNT}`,
    );
  }
  return value;
}

export interface CreateContractCommand {
  readonly idempotencyKey: string;
  readonly customerId: number;
  readonly totalAmountCents: number;
  readonly currency: string;
  readonly installmentCount: number;
  readonly firstDueDate: string;
}

export function createContractUseCase(dependencies: {
  readonly clock: Clock;
  readonly persistence: ContractPersistence;
}) {
  return async (
    command: CreateContractCommand,
  ): Promise<CreateCommandResult<Contract>> => {
    const idempotencyKey = createIdempotencyKey(command.idempotencyKey);
    const customerId = createCustomerId(command.customerId);
    const totalAmountCents = createMoneyCents(command.totalAmountCents);
    const currency = validateContractCurrency(command.currency);
    const firstDueDate = createCivilDate(command.firstDueDate);
    const installmentCount = validatePersistedInstallmentCount(
      command.installmentCount,
    );
    const schedule = generateInstallmentSchedule(
      totalAmountCents,
      installmentCount,
      firstDueDate,
    );
    const requestFingerprint = fingerprintCanonicalPayload(
      canonicalizeCreateContractPayload({
        customerId,
        totalAmountCents,
        currency: CONTRACT_CURRENCY,
        installmentCount,
        firstDueDate,
      }),
    );
    const createdAt = new Date(dependencies.clock.now().getTime());

    return dependencies.persistence.create({
      idempotencyKey,
      requestFingerprint,
      customerId,
      totalAmountCents,
      currency,
      installmentCount,
      firstDueDate,
      schedule,
      createdAt,
    });
  };
}
