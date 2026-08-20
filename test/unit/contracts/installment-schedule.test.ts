import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import { createCivilDate } from "../../../src/contracts/domain/civil-date.js";
import {
  allocateInstallmentAmounts,
  generateDueDates,
  generateInstallmentSchedule,
} from "../../../src/contracts/domain/installment-schedule.js";
import { createMoneyCents } from "../../../src/contracts/domain/money-cents.js";

describe("installment allocation", () => {
  it.each([
    [10_000, 3, [3_334, 3_333, 3_333]],
    [100, 6, [17, 17, 17, 17, 16, 16]],
    [3, 3, [1, 1, 1]],
    [1, 1, [1]],
  ] as const)("allocates %s cents across %s installments", (total, count, expected) => {
    expect(allocateInstallmentAmounts(createMoneyCents(total), count)).toEqual(
      expected,
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid count %s",
    (count) => {
      expect(() =>
        allocateInstallmentAmounts(createMoneyCents(100), count),
      ).toThrow(DomainValidationError);
    },
  );

  it("rejects a count greater than the total cents", () => {
    expect(() =>
      allocateInstallmentAmounts(createMoneyCents(3), 4),
    ).toThrow(DomainValidationError);
  });

  it("preserves the exact total with positive amounts", () => {
    const amounts = allocateInstallmentAmounts(createMoneyCents(10_007), 31);

    expect(amounts.every((amount) => amount > 0)).toBe(true);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(10_007);
  });
});

describe("due-date generation", () => {
  it.each([
    [
      "2026-01-31",
      4,
      ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
    ],
    [
      "2024-01-31",
      3,
      ["2024-01-31", "2024-02-29", "2024-03-31"],
    ],
    [
      "2024-01-30",
      4,
      ["2024-01-30", "2024-02-29", "2024-03-30", "2024-04-30"],
    ],
    [
      "2026-05-15",
      3,
      ["2026-05-15", "2026-06-15", "2026-07-15"],
    ],
    ["2026-11-30", 3, ["2026-11-30", "2026-12-30", "2027-01-30"]],
  ] as const)("generates dates from anchor %s", (anchor, count, expected) => {
    expect(generateDueDates(createCivilDate(anchor), count)).toEqual(expected);
  });

  it("handles a leap-day anchor across a year", () => {
    const dates = generateDueDates(createCivilDate("2024-02-29"), 13);

    expect(dates[0]).toBe("2024-02-29");
    expect(dates[1]).toBe("2024-03-29");
    expect(dates[12]).toBe("2025-02-28");
  });
});

describe("combined installment schedule", () => {
  it("combines stable positions, amounts, and direct-anchor due dates", () => {
    const schedule = generateInstallmentSchedule(
      createMoneyCents(10_000),
      3,
      createCivilDate("2026-01-31"),
    );

    expect(schedule).toEqual([
      { position: 1, amountCents: 3_334, dueDate: "2026-01-31" },
      { position: 2, amountCents: 3_333, dueDate: "2026-02-28" },
      { position: 3, amountCents: 3_333, dueDate: "2026-03-31" },
    ]);
    expect(schedule.reduce((sum, item) => sum + item.amountCents, 0)).toBe(
      10_000,
    );
  });

  it("is deterministic across repeated invocations", () => {
    const input = [
      createMoneyCents(100),
      6,
      createCivilDate("2024-01-30"),
    ] as const;

    expect(generateInstallmentSchedule(...input)).toEqual(
      generateInstallmentSchedule(...input),
    );
  });
});
