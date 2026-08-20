import { DomainValidationError } from "../../domain/domain-validation-error.js";

declare const civilDateBrand: unique symbol;

export type CivilDate = string & {
  readonly [civilDateBrand]: "CivilDate";
};

interface DateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  switch (month) {
    case 2:
      return isLeapYear(year) ? 29 : 28;
    case 4:
    case 6:
    case 9:
    case 11:
      return 30;
    default:
      return 31;
  }
}

function parseCivilDate(value: string): DateParts {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (match === null) {
    throw invalidCivilDate(value);
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    throw invalidCivilDate(value);
  }

  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (
    year < 1 ||
    year > 9_999 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month)
  ) {
    throw invalidCivilDate(value);
  }

  return { year, month, day };
}

function invalidCivilDate(value: string): DomainValidationError {
  return new DomainValidationError(
    "INVALID_CIVIL_DATE",
    `CivilDate must be a valid date in YYYY-MM-DD format: ${JSON.stringify(value)}`,
  );
}

function formatCivilDate(parts: DateParts): CivilDate {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month
    .toString()
    .padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}` as CivilDate;
}

export function createCivilDate(value: string): CivilDate {
  parseCivilDate(value);
  return value as CivilDate;
}

export function addCalendarMonths(
  anchor: CivilDate,
  monthOffset: number,
): CivilDate {
  if (!Number.isSafeInteger(monthOffset) || monthOffset < 0) {
    throw new DomainValidationError(
      "INVALID_MONTH_OFFSET",
      "Month offset must be a non-negative safe integer",
    );
  }

  const { year, month, day } = parseCivilDate(anchor);
  const absoluteMonth = year * 12 + (month - 1) + monthOffset;
  const targetYear = Math.floor(absoluteMonth / 12);
  const targetMonth = (absoluteMonth % 12) + 1;

  if (targetYear < 1 || targetYear > 9_999) {
    throw new DomainValidationError(
      "CIVIL_DATE_OUT_OF_RANGE",
      "Shifted CivilDate must remain between years 0001 and 9999",
    );
  }

  return formatCivilDate({
    year: targetYear,
    month: targetMonth,
    day: Math.min(day, daysInMonth(targetYear, targetMonth)),
  });
}
