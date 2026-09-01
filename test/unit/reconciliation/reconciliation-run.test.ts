import { describe, expect, it } from "vitest";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import { canonicalizeReconciliationRun, fingerprintReconciliationRun, reconstituteReconciliationRun } from "../../../src/reconciliation/domain/reconciliation-run.js";

const cutoff = new Date("2026-09-01T00:00:00.000Z");
describe("ReconciliationRun", () => {
  it("uses the closed canonical global v1 identity deterministically", () => { expect(canonicalizeReconciliationRun(cutoff)).toBe('["global",null,"2026-09-01T00:00:00.000Z","reconciliation-v1"]'); expect(fingerprintReconciliationRun(new Date(cutoff))).toBe(fingerprintReconciliationRun(cutoff)); });
  it("reconstitutes only completed global v1 runs", () => { const run = reconstituteReconciliationRun({ id: 1, scopeType: "global", scopeId: null, cutoff, ruleSetVersion: "reconciliation-v1", runFingerprint: fingerprintReconciliationRun(cutoff), status: "completed", executedAt: cutoff, createdAt: cutoff }); expect(run).toMatchObject({ id: 1, scopeType: "global", scopeId: null, status: "completed" }); expect(Object.isFrozen(run)).toBe(true); });
  it("rejects another scope, rule set, status, or fingerprint", () => { const base = { id: 1, scopeType: "global", scopeId: null, cutoff, ruleSetVersion: "reconciliation-v1", runFingerprint: fingerprintReconciliationRun(cutoff), status: "completed", executedAt: cutoff, createdAt: cutoff }; for (const override of [{ scopeType: "contract" }, { scopeId: 1 }, { ruleSetVersion: "v2" }, { status: "running" }, { runFingerprint: "0".repeat(64) }]) expect(() => reconstituteReconciliationRun({ ...base, ...override })).toThrowError(DomainValidationError); });
});
