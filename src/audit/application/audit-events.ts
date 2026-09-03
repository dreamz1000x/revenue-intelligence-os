import {createHash} from "node:crypto";
import type {Clock} from "../../application/clock.js";
import {validateApplicationInput} from "../../application/input-validation.js";
import {reconstituteAuditEvent,type AuditAction,type AuditOutcome,type AuditResourceType} from "../domain/audit-event.js";
import type {AuditFilters,AuditPersistence} from "./audit-persistence.js";
const digest=(parts:ReadonlyArray<string>)=>createHash("sha256").update(JSON.stringify(parts),"utf8").digest("hex");
export const auditIdempotentCommandIdentity=(action:AuditAction,actorId:string,idempotencyKey:string)=>digest([action,actorId,idempotencyKey]);
export const auditExternalSourceIdentity=(action:AuditAction,actorId:string,source:string,sourceEventId:string)=>digest([action,actorId,source,sourceEventId]);
export function appendAuditEvent(dependencies:{readonly clock:Clock;readonly persistence:AuditPersistence}){return async(input:{readonly action:AuditAction;readonly actorId:string;readonly resourceType:AuditResourceType;readonly resourceId:number;readonly outcome:AuditOutcome;readonly reason?:string|null;readonly deduplicationKey:string;})=>{const recordedAt=dependencies.clock.now();const validated=validateApplicationInput(()=>reconstituteAuditEvent({...input,id:1,actorType:"user",reason:input.reason??null,recordedAt}));return dependencies.persistence.append({action:validated.action,actorId:validated.actorId,resourceType:validated.resourceType,resourceId:validated.resourceId,outcome:validated.outcome,reason:validated.reason,deduplicationKey:validated.deduplicationKey,recordedAt:validated.recordedAt});};}
export function listAuditEvents(persistence:AuditPersistence){return (filters:AuditFilters)=>persistence.list(filters);}
