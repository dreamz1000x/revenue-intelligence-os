"use server";

import { apiPath, getPrincipal, riosFetch, RiosApiError } from "@/lib/api";
import {
  assistantExamples,
  canExecuteAssistantCommand,
  classifyAssistantStatusResponse,
  parseAssistantCommand,
  resolveAssistantStatus,
  type AssistantStatusProbe,
} from "@/lib/assistant";

export interface AssistantResult {
  readonly command: string;
  readonly title: string;
  readonly status: "ok" | "error";
  readonly message?: string;
  readonly data?: Record<string, unknown> | readonly Record<string, unknown>[];
  readonly lines?: readonly string[];
}

async function statusProbe(path: "/health" | "/ready"): Promise<AssistantStatusProbe> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const value = process.env.RIOS_API_BASE_URL;
    if (!value) return { ok: false, failure: "transport" };
    const baseUrl = new URL(value);
    if (!/^https?:$/u.test(baseUrl.protocol)) return { ok: false, failure: "transport" };
    const response = await fetch(`${baseUrl.toString().replace(/\/$/u, "")}${path}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    const payload: unknown = await response.json().catch(() => null);
    return classifyAssistantStatusResponse(path, response.status, payload);
  } catch {
    return { ok: false, failure: "transport" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function executeAssistantCommand(input: string): Promise<AssistantResult> {
  const parsed = parseAssistantCommand(input);
  if (!parsed.ok) return { command: input.trim(), title: "Command rejected", status: "error", message: parsed.message };

  const command = parsed.command;
  if (command.name === "help") {
    return { command: "/help", title: "Supported commands", status: "ok", lines: assistantExamples };
  }

  try {
    if (command.name === "revenue") {
      const now = new Date();
      const periodStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      const periodEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
      const data = await riosFetch<Record<string, unknown>>(apiPath("/analytics/financial-summary", {
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        asOf: now.toISOString(),
      }));
      return { command: "/revenue", title: "Current UTC-year financial summary", status: "ok", data };
    }

    if (command.name === "status") {
      const [health, readiness] = await Promise.all([
        statusProbe("/health"),
        statusProbe("/ready"),
      ]);
      const resolved = resolveAssistantStatus(health, readiness);
      if (!resolved.ok) {
        return { command: "/status", title: "Command failed", status: "error", message: "The status command could not be completed." };
      }
      return { command: "/status", title: "Service status", status: "ok", data: { health: resolved.health, readiness: resolved.readiness } };
    }

    if (command.name === "audit") {
      const principal = await getPrincipal();
      if (!canExecuteAssistantCommand(command, principal.roles)) {
        return { command: "/audit", title: "Command denied", status: "error", message: "The audit command requires the admin role." };
      }
      const data = await riosFetch<Record<string, unknown>[]>("/audit/events?limit=100");
      return { command: "/audit", title: "Authenticated audit events", status: "ok", data };
    }

    if (!("id" in command)) {
      return { command: input.trim(), title: "Command failed", status: "error", message: "The command could not be completed." };
    }
    const path = command.name === "customer"
      ? `/customers/${command.id}`
      : command.name === "contract"
        ? `/contracts/${command.id}`
        : `/payments/${command.id}`;
    const data = await riosFetch<Record<string, unknown>>(path);
    return { command: `/${command.name} ${command.id}`, title: `${command.name[0]!.toUpperCase()}${command.name.slice(1)} ${command.id}`, status: "ok", data };
  } catch (error) {
    const message = error instanceof RiosApiError ? error.message : "The command could not be completed.";
    return { command: input.trim(), title: "Command failed", status: "error", message };
  }
}
