"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { riosFetch } from "@/lib/api";

const text = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const integer = (data: FormData, key: string) => Number.parseInt(text(data, key), 10);

async function mutate<T>(path: string, body: object): Promise<T> {
  return riosFetch<T>(path, { method: "POST", headers: { "Idempotency-Key": randomUUID() }, body: JSON.stringify(body) });
}

export async function createCustomer(data: FormData) {
  const result = await mutate<{ id: number }>("/customers", { displayName: text(data, "displayName") });
  redirect(`/customers?id=${result.id}`);
}
export async function createContract(data: FormData) {
  const result = await mutate<{ id: number }>("/contracts", { customerId: integer(data, "customerId"), totalAmountCents: integer(data, "totalAmountCents"), currency: "EUR", installmentCount: integer(data, "installmentCount"), firstDueDate: text(data, "firstDueDate") });
  redirect(`/contracts?id=${result.id}`);
}
export async function recordPayment(data: FormData) {
  const result = await mutate<{ id: number }>("/payments", { contractId: integer(data, "contractId"), amountCents: integer(data, "amountCents"), receivedAt: text(data, "receivedAt") });
  redirect(`/payments?id=${result.id}`);
}
export async function recordRefund(data: FormData) {
  const result = await mutate<{ id: number }>("/refunds", { paymentId: integer(data, "paymentId"), amountCents: integer(data, "amountCents"), refundedAt: text(data, "refundedAt") });
  redirect(`/refunds?id=${result.id}`);
}
export async function runReconciliation(data: FormData) {
  const result = await mutate<{ id: number }>("/reconciliation/runs", { cutoff: text(data, "cutoff") });
  redirect(`/reconciliation?runId=${result.id}`);
}
export async function actOnFinding(data: FormData) {
  const id = integer(data, "findingId");
  await mutate(`/reconciliation/findings/${id}/actions`, { action: text(data, "action"), reason: text(data, "reason"), occurredAt: text(data, "occurredAt") });
  redirect(`/reconciliation?findingId=${id}`);
}
