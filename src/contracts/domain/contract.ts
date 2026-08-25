import type { CustomerId } from "../../customers/domain/customer-id.js";
import { createCustomerId } from "../../customers/domain/customer-id.js";
import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { createCivilDate, type CivilDate } from "./civil-date.js";
import {
  createContractId,
  createInstallmentId,
  type ContractId,
  type InstallmentId,
} from "./ids.js";
import { generateInstallmentSchedule } from "./installment-schedule.js";
import { createMoneyCents, type MoneyCents } from "./money-cents.js";

export const CONTRACT_CURRENCY = "EUR" as const;
export const CONTRACT_STATUS = "active" as const;
export const INSTALLMENT_STATUSES = [
  "pending",
  "partially_paid",
  "paid",
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUSES)[number];
export const INSTALLMENT_STATUS = "pending" as const satisfies InstallmentStatus;

export interface Installment {
  readonly id: InstallmentId;
  readonly contractId: ContractId;
  readonly position: number;
  readonly amountCents: MoneyCents;
  readonly dueDate: CivilDate;
  readonly status: InstallmentStatus;
  readonly createdAt: Date;
}

export interface Contract {
  readonly id: ContractId;
  readonly customerId: CustomerId;
  readonly totalAmountCents: MoneyCents;
  readonly currency: typeof CONTRACT_CURRENCY;
  readonly installmentCount: number;
  readonly firstDueDate: CivilDate;
  readonly status: typeof CONTRACT_STATUS;
  readonly createdAt: Date;
  readonly installments: ReadonlyArray<Installment>;
}

export interface ReconstituteInstallmentInput {
  readonly id: number;
  readonly contractId: number;
  readonly position: number;
  readonly amountCents: number;
  readonly dueDate: string;
  readonly status: string;
  readonly createdAt: Date;
}

export interface ReconstituteContractInput {
  readonly id: number;
  readonly customerId: number;
  readonly totalAmountCents: number;
  readonly currency: string;
  readonly installmentCount: number;
  readonly firstDueDate: string;
  readonly status: string;
  readonly createdAt: Date;
  readonly installments: ReadonlyArray<ReconstituteInstallmentInput>;
}

function copyValidDate(value: Date, label: string): Date {
  if (Number.isNaN(value.getTime())) {
    throw new DomainValidationError(
      "INVALID_CREATED_AT",
      `${label} creation instant must be valid`,
    );
  }
  return new Date(value.getTime());
}

export function validateContractCurrency(value: string): typeof CONTRACT_CURRENCY {
  if (value !== CONTRACT_CURRENCY) {
    throw new DomainValidationError(
      "INVALID_CONTRACT_CURRENCY",
      "Contract currency must be EUR",
    );
  }
  return value;
}

export function validateInstallmentStatus(value: string): InstallmentStatus {
  if (!(INSTALLMENT_STATUSES as ReadonlyArray<string>).includes(value)) {
    throw new DomainValidationError(
      "INVALID_INSTALLMENT_STATUS",
      "Installment status must be pending, partially_paid, or paid",
    );
  }
  return value as InstallmentStatus;
}

export function reconstituteContract(input: ReconstituteContractInput): Contract {
  const id = createContractId(input.id);
  const customerId = createCustomerId(input.customerId);
  const totalAmountCents = createMoneyCents(input.totalAmountCents);
  const currency = validateContractCurrency(input.currency);
  const firstDueDate = createCivilDate(input.firstDueDate);
  const createdAt = copyValidDate(input.createdAt, "Contract");

  if (input.status !== CONTRACT_STATUS) {
    throw new DomainValidationError(
      "INVALID_CONTRACT_STATUS",
      "Contract status must be active",
    );
  }

  const expectedSchedule = generateInstallmentSchedule(
    totalAmountCents,
    input.installmentCount,
    firstDueDate,
  );

  if (input.installments.length !== expectedSchedule.length) {
    throw new DomainValidationError(
      "INCOHERENT_INSTALLMENT_SCHEDULE",
      "Contract must contain its complete installment schedule",
    );
  }

  const installments = input.installments.map((item, index): Installment => {
    const expected = expectedSchedule[index]!;
    const installmentId = createInstallmentId(item.id);
    const installmentContractId = createContractId(item.contractId);
    const amountCents = createMoneyCents(item.amountCents);
    const dueDate = createCivilDate(item.dueDate);
    const status = validateInstallmentStatus(item.status);
    const installmentCreatedAt = copyValidDate(item.createdAt, "Installment");

    if (
      installmentContractId !== id ||
      item.position !== expected.position ||
      amountCents !== expected.amountCents ||
      dueDate !== expected.dueDate
    ) {
      throw new DomainValidationError(
        "INCOHERENT_INSTALLMENT_SCHEDULE",
        "Persisted installment does not match the contractual schedule",
      );
    }

    return {
      id: installmentId,
      contractId: installmentContractId,
      position: item.position,
      amountCents,
      dueDate,
      status,
      get createdAt() {
        return new Date(installmentCreatedAt.getTime());
      },
    };
  });

  return {
    id,
    customerId,
    totalAmountCents,
    currency,
    installmentCount: input.installmentCount,
    firstDueDate,
    status: CONTRACT_STATUS,
    get createdAt() {
      return new Date(createdAt.getTime());
    },
    installments: Object.freeze(installments),
  };
}
