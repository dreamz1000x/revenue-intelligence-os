import "server-only";

import { auth0 } from "./auth0";
import { kindForStatus, type ApiErrorKind } from "./api-error";

export class RiosApiError extends Error {
  constructor(public readonly status: number, public readonly kind: ApiErrorKind, message: string, public readonly requestId?: string) {
    super(message);
    this.name = "RiosApiError";
  }
}

function baseUrl(): string {
  const value = process.env.RIOS_API_BASE_URL;
  if (!value) throw new Error("RIOS_API_BASE_URL is required");
  const url = new URL(value);
  if (!/^https?:$/.test(url.protocol)) throw new Error("RIOS_API_BASE_URL must be HTTP(S)");
  return url.toString().replace(/\/$/u, "");
}

export async function riosFetch<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) throw new Error("RIOS API path must be explicit");
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (authenticated) {
    const { token } = await auth0.getAccessToken({ audience: process.env.AUTH0_AUDIENCE });
    headers.set("Authorization", `Bearer ${token}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${baseUrl()}${path}`, { ...init, headers, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { message?: unknown } | null;
      const message = typeof payload?.message === "string" ? payload.message : "RIOS API request failed";
      throw new RiosApiError(response.status, kindForStatus(response.status), message, response.headers.get("x-request-id") ?? undefined);
    }
    return await response.json() as T;
  } catch (error) {
    if (error instanceof RiosApiError) throw error;
    throw new RiosApiError(503, "unavailable", "RIOS API is temporarily unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export type Principal = { subject: string; roles: string[] };
export const getPrincipal = () => riosFetch<Principal>("/me");

export function apiPath(path: string, query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value !== undefined) params.set(key, String(value));
  const suffix = params.toString();
  return suffix ? `${path}?${suffix}` : path;
}
