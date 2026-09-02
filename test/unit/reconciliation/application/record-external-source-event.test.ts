import { describe, expect, it, vi } from "vitest";
import { ApplicationInputValidationError } from "../../../../src/application/input-validation.js";
import { recordExternalSourceEventUseCase } from "../../../../src/reconciliation/application/record-external-source-event.js";

const AT = new Date("2026-09-02T10:00:00Z");
const command = { source: "simulated_bank", sourceEventId: "bank-1", eventType: "settlement_credit" as const, amountCents: 100, currency: "EUR", occurredAt: AT, receivedAt: AT, externalReference: "statement-1", rawPayload: Buffer.from("{}"), metadata: {} };
describe("RecordExternalSourceEvent", () => {
  it("validates caller input and supplies createdAt from Clock", async () => { const record = vi.fn(async (input) => ({ resource: input, outcome: "created" as const })); const useCase = recordExternalSourceEventUseCase({ clock: { now: () => AT }, persistence: { record, getById: vi.fn() } as never }); await useCase(command); expect(record).toHaveBeenCalledWith(expect.objectContaining({ createdAt: AT, internalPaymentId: null, internalRefundId: null })); });
  it("classifies caller validation but leaves invalid Clock internal", async () => { const persistence = { record: vi.fn(), getById: vi.fn() } as never; await expect(recordExternalSourceEventUseCase({ clock: { now: () => AT }, persistence })({ ...command, amountCents: 0 })).rejects.toThrow(ApplicationInputValidationError); await expect(recordExternalSourceEventUseCase({ clock: { now: () => new Date("invalid") }, persistence })(command)).rejects.not.toThrow(ApplicationInputValidationError); });
});
