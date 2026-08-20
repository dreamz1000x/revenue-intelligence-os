import { describe, expect, it } from "vitest";

import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import {
  addCalendarMonths,
  createCivilDate,
} from "../../../src/contracts/domain/civil-date.js";

describe("CivilDate", () => {
  it.each([
    "2026-01-01",
    "2024-02-29",
    "2000-02-29",
    "0001-01-01",
    "9999-12-31",
  ])("accepts valid date %s", (value) => {
    expect(createCivilDate(value)).toBe(value);
  });

  it.each([
    "2026-02-30",
    "1900-02-29",
    "2026-13-01",
    "2026-00-01",
    "2026-01-00",
    "2026-1-01",
    "26-01-01",
    "2026-01-01T00:00:00Z",
    " 2026-01-01",
    "2026-01-01 ",
  ])("rejects invalid date %s", (value) => {
    expect(() => createCivilDate(value)).toThrow(DomainValidationError);
  });

  it("applies Gregorian century leap-year rules", () => {
    expect(createCivilDate("2000-02-29")).toBe("2000-02-29");
    expect(() => createCivilDate("1900-02-29")).toThrow(DomainValidationError);
    expect(createCivilDate("2024-02-29")).toBe("2024-02-29");
    expect(() => createCivilDate("2026-02-29")).toThrow(DomainValidationError);
  });

  it("clamps directly from the anchor without cumulative drift", () => {
    const anchor = createCivilDate("2026-01-31");

    expect(addCalendarMonths(anchor, 1)).toBe("2026-02-28");
    expect(addCalendarMonths(anchor, 2)).toBe("2026-03-31");
  });

  it("rejects shifts beyond the supported year range", () => {
    expect(() => addCalendarMonths(createCivilDate("9999-12-31"), 1)).toThrow(
      DomainValidationError,
    );
  });
});
