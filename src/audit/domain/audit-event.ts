import { DomainValidationError } from "../../domain/domain-validation-error.js";

export const AUDIT_ACTIONS = ["customer.create","contract.create","payment.record","refund.record","external_source_event.record","reconciliation.run","reconciliation.finding.acknowledge","reconciliation.finding.resolve","reconciliation.finding.ignore"] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export const AUDIT_RESOURCE_TYPES = ["customer","contract","payment","refund","external_source_event","reconciliation_run","reconciliation_finding"] as const;
export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];
export type AuditOutcome = "created"|"replayed";
export interface AuditEvent { readonly id:number; readonly action:AuditAction; readonly actorType:"user"; readonly actorId:string; readonly resourceType:AuditResourceType; readonly resourceId:number; readonly outcome:AuditOutcome; readonly reason:string|null; readonly deduplicationKey:string; readonly recordedAt:Date; }
const ACTION_RESOURCE:Readonly<Record<AuditAction,AuditResourceType>>={"customer.create":"customer","contract.create":"contract","payment.record":"payment","refund.record":"refund","external_source_event.record":"external_source_event","reconciliation.run":"reconciliation_run","reconciliation.finding.acknowledge":"reconciliation_finding","reconciliation.finding.resolve":"reconciliation_finding","reconciliation.finding.ignore":"reconciliation_finding"};
const bounded=(value:string,label:string,max:number)=>{if(typeof value!=="string"||value.length<1||value.length>max||value.trim()!==value)throw new DomainValidationError("INVALID_AUDIT_TEXT",`${label} must be bounded and nonblank`);return value;};
export function reconstituteAuditEvent(input:{readonly id:number;readonly action:string;readonly actorType:string;readonly actorId:string;readonly resourceType:string;readonly resourceId:number;readonly outcome:string;readonly reason:string|null;readonly deduplicationKey:string;readonly recordedAt:Date;}):AuditEvent {
  if(!Number.isSafeInteger(input.id)||input.id<1||!Number.isSafeInteger(input.resourceId)||input.resourceId<1)throw new DomainValidationError("INVALID_AUDIT_ID","Audit identifiers must be positive safe integers");
  if(!(AUDIT_ACTIONS as readonly string[]).includes(input.action)||!(AUDIT_RESOURCE_TYPES as readonly string[]).includes(input.resourceType)||ACTION_RESOURCE[input.action as AuditAction]!==input.resourceType)throw new DomainValidationError("INVALID_AUDIT_VOCABULARY","Audit action and resource type must match");
  if(input.actorType!=="user"||!(["created","replayed"] as string[]).includes(input.outcome)||!/^[0-9a-f]{64}$/.test(input.deduplicationKey))throw new DomainValidationError("INVALID_AUDIT_EVENT","Audit event semantics are invalid");
  if(!(input.recordedAt instanceof Date)||Number.isNaN(input.recordedAt.getTime()))throw new DomainValidationError("INVALID_AUDIT_INSTANT","Audit recordedAt must be valid");
  return Object.freeze({id:input.id,action:input.action as AuditAction,actorType:"user",actorId:bounded(input.actorId,"actorId",255),resourceType:input.resourceType as AuditResourceType,resourceId:input.resourceId,outcome:input.outcome as AuditOutcome,reason:input.reason===null?null:bounded(input.reason,"reason",1000),deduplicationKey:input.deduplicationKey,get recordedAt(){return new Date(input.recordedAt);}});
}
