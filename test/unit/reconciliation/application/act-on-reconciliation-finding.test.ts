import { describe, expect, it, vi } from "vitest";
import { ApplicationInputValidationError } from "../../../../src/application/input-validation.js";
import { actOnReconciliationFindingUseCase } from "../../../../src/reconciliation/application/act-on-reconciliation-finding.js";
const AT = new Date("2026-09-02T10:00:00Z");
describe("ActOnReconciliationFinding", () => {
  it("canonicalizes validated operator input and supplies recordedAt", async () => { const act = vi.fn(async (input) => ({ resource: input, outcome: "created" as const })); const useCase = actOnReconciliationFindingUseCase({ clock: { now: () => AT }, persistence: { act } as never }); await useCase({ idempotencyKey: "action-1", findingId: 1, actionType: "resolve", actorId: "operator", reason: "Verified", occurredAt: AT }); expect(act).toHaveBeenCalledWith(expect.objectContaining({ actorId: "operator", recordedAt: AT, requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })); });
  it("rejects blank actor/reason and invalid caller time", async () => { const useCase = actOnReconciliationFindingUseCase({ clock: { now: () => AT }, persistence: { act: vi.fn() } as never }); for (const override of [{ actorId: " " }, { reason: " " }, { occurredAt: new Date("invalid") }]) await expect(useCase({ idempotencyKey: "key", findingId: 1, actionType: "resolve", actorId: "operator", reason: "reason", occurredAt: AT, ...override })).rejects.toThrow(ApplicationInputValidationError); });
});
