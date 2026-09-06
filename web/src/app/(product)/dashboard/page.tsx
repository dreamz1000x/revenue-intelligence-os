import { Metric, PageHeader, DataTable } from "@/components/ui";
import { apiPath, riosFetch } from "@/lib/api";

type Summary = Record<string, number | string>;
export default async function Dashboard() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
  const summary = await riosFetch<Summary>(apiPath("/analytics/financial-summary", { periodStart: start.toISOString(), periodEnd: end.toISOString(), asOf: now.toISOString() }));
  const runs = await riosFetch<Record<string, unknown>[]>("/reconciliation/runs?limit=5");
  const cents = (key: string) => typeof summary[key] === "number" ? summary[key] as number : 0;
  return <><PageHeader eyebrow="Overview" title="Revenue operations, in evidence." copy="Backend-owned financial truth for the current UTC year, plus the latest immutable reconciliation runs."/><section className="metrics"><Metric label="Contracted" cents={cents("contractedCents")}/><Metric label="Scheduled due" cents={cents("scheduledDueCents")}/><Metric label="Net recorded" cents={cents("netRecordedPaymentsCents")}/><Metric label="Bank-settled net" cents={cents("bankSettledNetCents")}/><Metric label="Outstanding" cents={cents("outstandingExposureCents")}/><Metric label="Overdue" cents={cents("overdueExposureCents")}/></section><h2 className="sectionTitle">Recent reconciliation runs</h2><DataTable rows={runs}/></>;
}
