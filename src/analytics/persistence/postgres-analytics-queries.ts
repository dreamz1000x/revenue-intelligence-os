import { sql } from "drizzle-orm";
import type { Database } from "../../persistence/database.js";
import { ANALYTICS_VERSION, type AnalyticsQueryPersistence, type ContractFinancialTimelineV1, type ContractTimelineEventV1, type FinancialSummaryInput, type FinancialSummaryV1, type ReconciliationSummaryInput, type ReconciliationSummaryV1 } from "../application/analytics-queries.js";
import { RECONCILIATION_RULE_CODES } from "../../reconciliation/domain/reconciliation-vocabulary.js";

const number = (value: unknown): number => { const parsed = Number(value); if (!Number.isSafeInteger(parsed)) throw new Error("Analytics aggregate exceeds the safe-integer boundary"); return parsed; };
const utcDate = (value: Date) => value.toISOString().slice(0, 10);
const filterSql = (input: { customerId?: number; contractId?: number }, alias: string) => sql`${input.customerId === undefined ? sql`` : sql`and ${sql.raw(alias)}.customer_id = ${input.customerId}`} ${input.contractId === undefined ? sql`` : sql`and ${sql.raw(alias)}.id = ${input.contractId}`}`;

export class PostgresAnalyticsQueries implements AnalyticsQueryPersistence {
  constructor(private readonly database: Database) {}
  async getFinancialSummaryV1(input: FinancialSummaryInput): Promise<FinancialSummaryV1> {
    const startDate = utcDate(input.periodStart); const endDate = utcDate(input.periodEnd); const contractFilter = filterSql(input, "c");
    const result = await this.database.client.execute(sql`
      with selected_contracts as (select c.id from contracts c where c.created_at <= ${input.asOf} ${contractFilter}),
      paid as (select pa.installment_id, sum(pa.amount_cents) amount from payment_allocations pa join payments p on p.id=pa.payment_id where p.created_at <= ${input.asOf} group by pa.installment_id),
      refunded as (select ra.installment_id, sum(ra.amount_cents) amount from refund_allocations ra join refunds r on r.id=ra.refund_id where r.created_at <= ${input.asOf} group by ra.installment_id),
      exposure as (select coalesce(sum(greatest(i.amount_cents-coalesce(paid.amount,0)+coalesce(refunded.amount,0),0)),0) outstanding, coalesce(sum(case when i.due_date < ${utcDate(input.asOf)}::date then greatest(i.amount_cents-coalesce(paid.amount,0)+coalesce(refunded.amount,0),0) else 0 end),0) overdue from installments i join selected_contracts sc on sc.id=i.contract_id left join paid on paid.installment_id=i.id left join refunded on refunded.installment_id=i.id where i.created_at <= ${input.asOf}),
      stripe_links as (select e.id event_id, case when count(distinct s.payment_id)=1 then min(s.payment_id) end payment_id from external_source_events e join stripe_webhook_events s on s.stripe_payment_intent_id=e.provider_payment_reference and s.payment_id is not null and s.processed_at <= ${input.asOf} where e.internal_payment_id is null group by e.id),
      bank_settlements as (select e.amount_cents, coalesce(e.internal_payment_id,sl.payment_id) payment_id from external_source_events e left join stripe_links sl on sl.event_id=e.id where e.event_type='settlement_credit' and e.created_at <= ${input.asOf} and e.occurred_at >= ${input.periodStart} and e.occurred_at < ${input.periodEnd}),
      metrics as (select
        (select coalesce(sum(c.total_amount_cents),0) from contracts c where c.created_at >= ${input.periodStart} and c.created_at < ${input.periodEnd} and c.created_at <= ${input.asOf} ${contractFilter}) contracted,
        (select coalesce(sum(i.amount_cents),0) from installments i join contracts c on c.id=i.contract_id where i.due_date >= ${startDate}::date and i.due_date < ${endDate}::date and i.created_at <= ${input.asOf} and c.created_at <= ${input.asOf} ${contractFilter}) scheduled,
        (select coalesce(sum(p.amount_cents),0) from payments p join contracts c on c.id=p.contract_id where p.received_at >= ${input.periodStart} and p.received_at < ${input.periodEnd} and p.created_at <= ${input.asOf} ${contractFilter}) gross,
        (select coalesce(sum(r.amount_cents),0) from refunds r join payments p on p.id=r.payment_id join contracts c on c.id=p.contract_id where r.refunded_at >= ${input.periodStart} and r.refunded_at < ${input.periodEnd} and r.created_at <= ${input.asOf} ${contractFilter}) refunds,
        (select coalesce(sum(bs.amount_cents),0) from bank_settlements bs join payments p on p.id=bs.payment_id join contracts c on c.id=p.contract_id where bs.payment_id is not null ${contractFilter}) bank_gross,
        (select coalesce(sum(e.amount_cents),0) from external_source_events e join refunds r on r.id=e.internal_refund_id join payments p on p.id=r.payment_id join contracts c on c.id=p.contract_id where e.event_type='refund_debit' and e.created_at <= ${input.asOf} and e.occurred_at >= ${input.periodStart} and e.occurred_at < ${input.periodEnd} ${contractFilter}) bank_refunds
      ) select metrics.*, exposure.outstanding, exposure.overdue from metrics, exposure`);
    const row = result.rows[0]!; const gross = number(row["gross"]); const refunds = number(row["refunds"]); const bankGross = number(row["bank_gross"]); const bankRefunds = number(row["bank_refunds"]);
    return { version: ANALYTICS_VERSION, currency: "EUR", periodStart: new Date(input.periodStart), periodEnd: new Date(input.periodEnd), asOf: new Date(input.asOf), contractedCents: number(row["contracted"]), scheduledDueCents: number(row["scheduled"]), grossRecordedPaymentsCents: gross, refundsCents: refunds, netRecordedPaymentsCents: gross-refunds, bankSettledGrossCents: bankGross, bankRefundOutflowsCents: bankRefunds, bankSettledNetCents: bankGross-bankRefunds, outstandingExposureCents: number(row["outstanding"]), overdueExposureCents: number(row["overdue"]) };
  }
  async getContractFinancialTimelineV1(input: { contractId: number; asOf: Date; periodStart?: Date; periodEnd?: Date }): Promise<ContractFinancialTimelineV1 | null> {
    const contract = await this.database.client.execute(sql`select id,customer_id,total_amount_cents from contracts where id=${input.contractId} and created_at <= ${input.asOf}`); if (!contract.rows[0]) return null;
    const start = input.periodStart ?? new Date(0); const end = input.periodEnd ?? input.asOf;
    const events = await this.database.client.execute(sql`
      select * from (
        select 'installment_due' type,id entity_id,(due_date::timestamp at time zone 'UTC') effective_at,amount_cents,1 precedence from installments where contract_id=${input.contractId} and created_at<=${input.asOf}
        union all select 'payment_recorded',id,received_at,amount_cents,2 from payments where contract_id=${input.contractId} and created_at<=${input.asOf}
        union all select 'refund_recorded',r.id,r.refunded_at,r.amount_cents,3 from refunds r join payments p on p.id=r.payment_id where p.contract_id=${input.contractId} and r.created_at<=${input.asOf}
        union all select 'stripe_evidence',s.id,s.received_at,null,4 from stripe_webhook_events s join payments p on p.id=s.payment_id where p.contract_id=${input.contractId} and s.received_at<=${input.asOf}
        union all select case e.event_type when 'settlement_credit' then 'external_settlement_credit' else 'external_refund_debit' end,e.id,e.occurred_at,e.amount_cents,5 from external_source_events e left join payments p on p.id=e.internal_payment_id left join refunds r on r.id=e.internal_refund_id left join payments rp on rp.id=r.payment_id where coalesce(p.contract_id,rp.contract_id)=${input.contractId} and e.created_at<=${input.asOf}
      ) e where e.effective_at >= ${start} and e.effective_at < ${end} order by e.effective_at,e.precedence,e.entity_id`);
    const row = contract.rows[0]; return { version: ANALYTICS_VERSION, currency: "EUR", contractId: number(row["id"]), customerId: number(row["customer_id"]), totalAmountCents: number(row["total_amount_cents"]), asOf: new Date(input.asOf), events: events.rows.map((event) => ({ type: String(event["type"]) as ContractTimelineEventV1["type"], entityId: number(event["entity_id"]), effectiveAt: new Date(String(event["effective_at"])).toISOString(), amountCents: event["amount_cents"] === null ? null : number(event["amount_cents"]) })) };
  }
  async getReconciliationSummaryV1(input: ReconciliationSummaryInput): Promise<ReconciliationSummaryV1 | null> {
    const run = await this.database.client.execute(sql`select id,cutoff,rule_set_version from reconciliation_runs where id=${input.runId}`); if (!run.rows[0]) return null;
    const counts = await this.database.client.execute(sql`select f.rule_code,f.severity,coalesce(a.to_status,'open') status,count(*)::int count from reconciliation_findings f left join lateral (select ra.to_status from reconciliation_actions ra where ra.finding_id=f.id and ra.recorded_at<=${input.statusAsOf} order by ra.recorded_at desc,ra.id desc limit 1) a on true where f.run_id=${input.runId} group by f.rule_code,f.severity,coalesce(a.to_status,'open')`);
    const byRule: Record<string,number> = Object.fromEntries(RECONCILIATION_RULE_CODES.map((key) => [key,0])); const bySeverity: Record<string,number> = { warning:0, critical:0 }; const byStatus: Record<string,number> = { open:0, acknowledged:0, resolved:0, ignored:0 }; let total=0;
    for (const row of counts.rows) { const count=number(row["count"]); byRule[String(row["rule_code"])]!+=count; bySeverity[String(row["severity"])]!+=count; byStatus[String(row["status"])]!+=count; total+=count; }
    const row=run.rows[0]; return { version:ANALYTICS_VERSION, runId:number(row["id"]), cutoff:new Date(String(row["cutoff"])), ruleSetVersion:"reconciliation-v1", statusAsOf:new Date(input.statusAsOf), totalFindings:total, openFindings:byStatus["open"]!, byRule, bySeverity, byStatus };
  }
}
