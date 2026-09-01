import { validateIntegerId } from "../../domain/integer-id.js";

declare const externalSourceEventIdBrand: unique symbol;
declare const reconciliationRunIdBrand: unique symbol;
declare const reconciliationFindingIdBrand: unique symbol;
declare const reconciliationActionIdBrand: unique symbol;

export type ExternalSourceEventId = number & { readonly [externalSourceEventIdBrand]: "ExternalSourceEventId" };
export type ReconciliationRunId = number & { readonly [reconciliationRunIdBrand]: "ReconciliationRunId" };
export type ReconciliationFindingId = number & { readonly [reconciliationFindingIdBrand]: "ReconciliationFindingId" };
export type ReconciliationActionId = number & { readonly [reconciliationActionIdBrand]: "ReconciliationActionId" };

export const createExternalSourceEventId = (value: number) => validateIntegerId(value, "ExternalSourceEvent ID") as ExternalSourceEventId;
export const createReconciliationRunId = (value: number) => validateIntegerId(value, "Reconciliation Run ID") as ReconciliationRunId;
export const createReconciliationFindingId = (value: number) => validateIntegerId(value, "Reconciliation Finding ID") as ReconciliationFindingId;
export const createReconciliationActionId = (value: number) => validateIntegerId(value, "Reconciliation Action ID") as ReconciliationActionId;
