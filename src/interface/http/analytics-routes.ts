import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { HttpUseCases } from "./app.js";

type Dependencies = Required<Pick<HttpUseCases,"getFinancialSummaryV1"|"getContractFinancialTimelineV1"|"getReconciliationSummaryV1">>;
const instant = z.iso.datetime({offset:true});
const financialQuery = z.strictObject({ periodStart:instant, periodEnd:instant, asOf:instant, customerId:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(), contractId:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional() });
const idParams = z.strictObject({id:z.string().regex(/^\d+$/)});
const timelineQuery = z.strictObject({ asOf:instant, periodStart:instant.optional(), periodEnd:instant.optional() });
const reconciliationQuery = z.strictObject({ runId:z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER), statusAsOf:instant });
const date = (value:Date)=>value.toISOString();

export function registerAnalyticsRoutes(app:FastifyInstance,dependencies:Dependencies):void {
  app.get("/analytics/financial-summary",async(request,reply)=>{const query=financialQuery.parse(request.query);const result=await dependencies.getFinancialSummaryV1({periodStart:new Date(query.periodStart),periodEnd:new Date(query.periodEnd),asOf:new Date(query.asOf),...(query.customerId===undefined?{}:{customerId:query.customerId}),...(query.contractId===undefined?{}:{contractId:query.contractId})});return reply.send({...result,periodStart:date(result.periodStart),periodEnd:date(result.periodEnd),asOf:date(result.asOf)});});
  app.get("/analytics/contracts/:id/timeline",async(request,reply)=>{const {id}=idParams.parse(request.params);const query=timelineQuery.parse(request.query);const result=await dependencies.getContractFinancialTimelineV1({contractId:Number(id),asOf:new Date(query.asOf),...(query.periodStart===undefined?{}:{periodStart:new Date(query.periodStart)}),...(query.periodEnd===undefined?{}:{periodEnd:new Date(query.periodEnd)})});return reply.send({...result,asOf:date(result.asOf)});});
  app.get("/analytics/reconciliation-summary",async(request,reply)=>{const query=reconciliationQuery.parse(request.query);const result=await dependencies.getReconciliationSummaryV1({runId:query.runId,statusAsOf:new Date(query.statusAsOf)});return reply.send({...result,cutoff:date(result.cutoff),statusAsOf:date(result.statusAsOf)});});
}
