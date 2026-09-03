import type { AuditAction,AuditEvent,AuditOutcome,AuditResourceType } from "../domain/audit-event.js";
export interface AppendAuditInput { readonly action:AuditAction;readonly actorId:string;readonly resourceType:AuditResourceType;readonly resourceId:number;readonly outcome:AuditOutcome;readonly reason:string|null;readonly deduplicationKey:string;readonly recordedAt:Date; }
export interface AuditFilters {readonly actorId?:string;readonly action?:AuditAction;readonly resourceType?:AuditResourceType;readonly resourceId?:number;readonly limit:number;}
export interface AuditPersistence {append(input:AppendAuditInput):Promise<AuditEvent>;list(filters:AuditFilters):Promise<ReadonlyArray<AuditEvent>>;}
export class AuditEventConflictError extends Error {override readonly name="AuditEventConflictError";constructor(){super("Audit deduplication identity conflicts with retained event");}}
