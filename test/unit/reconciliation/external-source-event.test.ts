import { describe, expect, it } from "vitest";
import { DomainValidationError } from "../../../src/domain/domain-validation-error.js";
import { reconstituteExternalSourceEvent } from "../../../src/reconciliation/domain/external-source-event.js";

const instant = new Date("2026-09-01T12:00:00.123Z");
function input() { return { id: 1, source: "simulated_bank", sourceEventId: "bank-1", eventType: "settlement_credit" as const, amountCents: 10_000, currency: "EUR", occurredAt: instant, receivedAt: instant, externalReference: "statement-1", internalPaymentId: 2, internalRefundId: null, providerPaymentReference: null, rawPayload: Buffer.from('{"event":"bank-1"}'), metadata: { batch: "demo" }, createdAt: instant }; }

describe("ExternalSourceEvent", () => {
  it("reconstitutes an immutable settlement credit with defensive copies", () => { const raw = Buffer.from("x"); const event = reconstituteExternalSourceEvent({ ...input(), rawPayload: raw }); raw[0] = 121; expect(event.rawPayload.toString()).toBe("x"); event.rawPayload[0] = 122; expect(event.rawPayload.toString()).toBe("x"); expect(Object.isFrozen(event)).toBe(true); });
  it("accepts a refund debit linked only to a Refund", () => { expect(reconstituteExternalSourceEvent({ ...input(), eventType: "refund_debit", internalPaymentId: null, internalRefundId: 3 })).toMatchObject({ eventType: "refund_debit", internalRefundId: 3 }); });
  it.each([0, -1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid amount %s", (amountCents) => { expect(() => reconstituteExternalSourceEvent({ ...input(), amountCents })).toThrowError(DomainValidationError); });
  it("rejects non-EUR currency and blank identity", () => { expect(() => reconstituteExternalSourceEvent({ ...input(), currency: "USD" })).toThrowError(DomainValidationError); expect(() => reconstituteExternalSourceEvent({ ...input(), sourceEventId: " " })).toThrowError(DomainValidationError); });
  it("rejects inconsistent references", () => { expect(() => reconstituteExternalSourceEvent({ ...input(), internalRefundId: 3 })).toThrowError(DomainValidationError); expect(() => reconstituteExternalSourceEvent({ ...input(), eventType: "refund_debit", providerPaymentReference: "pi_demo" })).toThrowError(DomainValidationError); });
  it("rejects empty and oversized raw evidence", () => { expect(() => reconstituteExternalSourceEvent({ ...input(), rawPayload: Buffer.alloc(0) })).toThrowError(DomainValidationError); expect(() => reconstituteExternalSourceEvent({ ...input(), rawPayload: Buffer.alloc(1_048_577) })).toThrowError(DomainValidationError); });
  it("rejects credential-like metadata", () => { expect(() => reconstituteExternalSourceEvent({ ...input(), metadata: { apiKey: "not-allowed" } })).toThrowError(DomainValidationError); });
  it("deeply freezes copied metadata", () => { const metadata = { nested: { batch: "demo" } }; const event = reconstituteExternalSourceEvent({ ...input(), metadata }); expect(Object.isFrozen(event.metadata)).toBe(true); expect(Object.isFrozen(event.metadata.nested)).toBe(true); metadata.nested.batch = "changed"; expect(event.metadata).toEqual({ nested: { batch: "demo" } }); });
});
