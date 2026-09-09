export const assistantExamples = [
  "/help",
  "/revenue",
  "/customer 1",
  "/contract 1",
  "/payment 1",
  "/status",
  "/audit",
] as const;

export type AssistantCommand =
  | { readonly name: "help" | "revenue" | "status" | "audit" }
  | { readonly name: "customer" | "contract" | "payment"; readonly id: number };

export type AssistantParseResult =
  | { readonly ok: true; readonly command: AssistantCommand }
  | { readonly ok: false; readonly code: "EMPTY" | "UNKNOWN_COMMAND" | "INVALID_ID"; readonly message: string };

const withoutId = new Set(["help", "revenue", "status", "audit"]);
const withId = new Set(["customer", "contract", "payment"]);

export function parseAssistantCommand(input: string): AssistantParseResult {
  const value = input.trim();
  if (value.length === 0) return { ok: false, code: "EMPTY", message: "Enter a command. Use /help to list supported commands." };

  const match = /^\/([^\s]+)(?:\s+(.+))?$/u.exec(value);
  if (!match) return { ok: false, code: "UNKNOWN_COMMAND", message: "Commands must start with /. Use /help for supported commands." };
  const name = match[1]!.toLowerCase();
  const argument = match[2];

  if (withoutId.has(name)) {
    if (argument !== undefined) return { ok: false, code: "UNKNOWN_COMMAND", message: `/${name} does not accept arguments. Use /help for supported commands.` };
    return { ok: true, command: { name: name as "help" | "revenue" | "status" | "audit" } };
  }

  if (withId.has(name)) {
    if (argument === undefined || !/^[1-9]\d*$/u.test(argument)) {
      return { ok: false, code: "INVALID_ID", message: `/${name} requires one canonical positive integer ID.` };
    }
    const id = Number(argument);
    if (!Number.isSafeInteger(id)) return { ok: false, code: "INVALID_ID", message: `/${name} ID is outside the supported range.` };
    return { ok: true, command: { name: name as "customer" | "contract" | "payment", id } };
  }

  return { ok: false, code: "UNKNOWN_COMMAND", message: `Unknown command /${name}. Use /help for supported commands.` };
}

export function canExecuteAssistantCommand(command: AssistantCommand, roles: readonly string[]): boolean {
  return command.name !== "audit" || roles.includes("admin");
}

export type AssistantStatusProbe =
  | { readonly ok: true; readonly status: string }
  | { readonly ok: false; readonly failure: "http" | "transport"; readonly httpStatus?: number };

export type AssistantStatusResolution =
  | { readonly ok: true; readonly health: string; readonly readiness: string }
  | { readonly ok: false };

export function resolveAssistantStatus(
  health: AssistantStatusProbe,
  readiness: AssistantStatusProbe,
): AssistantStatusResolution {
  if (!health.ok) return { ok: false };
  if (readiness.ok) return { ok: true, health: health.status, readiness: readiness.status };
  return { ok: false };
}

export function classifyAssistantStatusResponse(
  path: "/health" | "/ready",
  httpStatus: number,
  payload: unknown,
): AssistantStatusProbe {
  const status = typeof payload === "object" && payload !== null && "status" in payload
    ? (payload as { readonly status?: unknown }).status
    : undefined;
  if (httpStatus >= 200 && httpStatus < 300 && typeof status === "string") {
    return { ok: true, status };
  }
  if (path === "/ready" && httpStatus === 503 && status === "not_ready") {
    return { ok: true, status: "not_ready" };
  }
  return { ok: false, failure: "http", httpStatus };
}
