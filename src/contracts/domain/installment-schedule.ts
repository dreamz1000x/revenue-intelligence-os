import { DomainValidationError } from "../../domain/domain-validation-error.js";
import { addCalendarMonths, type CivilDate } from "./civil-date.js";
import { createMoneyCents, type MoneyCents } from "./money-cents.js";

export interface InstallmentScheduleItem {
  readonly position: number;
  readonly amountCents: MoneyCents;
  readonly dueDate: CivilDate;
}

function validateInstallmentCount(
  installmentCount: number,
  totalAmountCents?: MoneyCents,
): void {
  if (!Number.isSafeInteger(installmentCount) || installmentCount < 1) {
    throw new DomainValidationError(
      "INVALID_INSTALLMENT_COUNT",
      "Installment count must be a positive safe integer",
    );
  }

  if (
    totalAmountCents !== undefined &&
    installmentCount > totalAmountCents
  ) {
    throw new DomainValidationError(
      "INSTALLMENT_COUNT_EXCEEDS_TOTAL",
      "Installment count cannot exceed the total amount in cents",
    );
  }
}

export function allocateInstallmentAmounts(
  totalAmountCents: MoneyCents,
  installmentCount: number,
): ReadonlyArray<MoneyCents> {
  validateInstallmentCount(installmentCount, totalAmountCents);

  const base = Math.floor(totalAmountCents / installmentCount);
  const remainder = totalAmountCents % installmentCount;
  const amounts: MoneyCents[] = [];

  for (let index = 0; index < installmentCount; index += 1) {
    amounts.push(createMoneyCents(base + (index < remainder ? 1 : 0)));
  }

  return amounts;
}

export function generateDueDates(
  firstDueDate: CivilDate,
  installmentCount: number,
): ReadonlyArray<CivilDate> {
  validateInstallmentCount(installmentCount);

  const dueDates: CivilDate[] = [];
  for (let index = 0; index < installmentCount; index += 1) {
    dueDates.push(addCalendarMonths(firstDueDate, index));
  }

  return dueDates;
}

export function generateInstallmentSchedule(
  totalAmountCents: MoneyCents,
  installmentCount: number,
  firstDueDate: CivilDate,
): ReadonlyArray<Readonly<InstallmentScheduleItem>> {
  const amounts = allocateInstallmentAmounts(
    totalAmountCents,
    installmentCount,
  );
  const dueDates = generateDueDates(firstDueDate, installmentCount);

  return amounts.map((amountCents, index) => ({
    position: index + 1,
    amountCents,
    dueDate: dueDates[index]!,
  }));
}
