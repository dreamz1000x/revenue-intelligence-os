import { describe, expect, it } from "vitest";
import { formatEuro, formatUtc } from "../src/lib/format";
describe("presentation formatting",()=>{it("formats integer cents without business arithmetic",()=>{expect(formatEuro(123456)).toContain("1,234.56");expect(formatEuro(0)).toContain("0.00")});it("labels timestamps explicitly as UTC",()=>expect(formatUtc("2026-09-06T11:14:26Z")).toContain("UTC"));});
