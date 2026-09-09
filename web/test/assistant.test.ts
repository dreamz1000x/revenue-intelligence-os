import { describe, expect, it } from "vitest";
import {
  canExecuteAssistantCommand,
  classifyAssistantStatusResponse,
  parseAssistantCommand,
  resolveAssistantStatus,
} from "../src/lib/assistant";

describe("deterministic assistant parser", () => {
  it.each([
    ["/help", { name: "help" }],
    ["  /revenue  ", { name: "revenue" }],
    ["/customer 1", { name: "customer", id: 1 }],
    ["/contract 42", { name: "contract", id: 42 }],
    ["/payment 9007199254740991", { name: "payment", id: Number.MAX_SAFE_INTEGER }],
    ["/status", { name: "status" }],
    ["/audit", { name: "audit" }],
  ])("parses %s", (input, command) => {
    expect(parseAssistantCommand(input)).toEqual({ ok: true, command });
  });

  it.each(["/customer", "/customer 0", "/customer 01", "/contract -1", "/payment 1.5", "/payment 9007199254740992"])(
    "rejects malformed canonical IDs: %s",
    (input) => expect(parseAssistantCommand(input)).toMatchObject({ ok: false, code: "INVALID_ID" }),
  );

  it.each(["", "customer 1", "/customers 1", "/help now", "/customer 1 2"])(
    "returns a bounded error for unsupported input: %s",
    (input) => expect(parseAssistantCommand(input)).toMatchObject({ ok: false }),
  );

  it("keeps audit deny-by-default outside the admin role", () => {
    const parsed = parseAssistantCommand("/audit");
    expect(parsed.ok && canExecuteAssistantCommand(parsed.command, ["viewer"])).toBe(false);
    expect(parsed.ok && canExecuteAssistantCommand(parsed.command, ["operator"])).toBe(false);
    expect(parsed.ok && canExecuteAssistantCommand(parsed.command, ["admin"])).toBe(true);
  });

  it("reports healthy and ready status vocabulary", () => {
    const ready = classifyAssistantStatusResponse("/ready", 200, { status: "ready" });
    expect(resolveAssistantStatus(
      { ok: true, status: "ok" },
      ready,
    )).toEqual({ ok: true, health: "ok", readiness: "ready" });
  });

  it("reports an intentional readiness 503 as not_ready", () => {
    const notReady = classifyAssistantStatusResponse("/ready", 503, { status: "not_ready" });
    expect(resolveAssistantStatus(
      { ok: true, status: "ok" },
      notReady,
    )).toEqual({ ok: true, health: "ok", readiness: "not_ready" });
  });

  it("keeps a transport failure bounded instead of reporting not_ready", () => {
    expect(resolveAssistantStatus(
      { ok: true, status: "ok" },
      { ok: false, failure: "transport" },
    )).toEqual({ ok: false });
  });

  it("keeps unexpected HTTP failures bounded as errors", () => {
    const unexpected = classifyAssistantStatusResponse("/ready", 500, { status: "not_ready" });
    expect(resolveAssistantStatus(
      { ok: true, status: "ok" },
      unexpected,
    )).toEqual({ ok: false });
    expect(resolveAssistantStatus(
      { ok: false, failure: "http", httpStatus: 503 },
      { ok: true, status: "ready" },
    )).toEqual({ ok: false });
  });
});
