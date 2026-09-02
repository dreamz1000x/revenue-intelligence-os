import { validateApplicationInput } from "../../application/input-validation.js";
import { createExternalSourceEventId } from "../domain/ids.js";
import type { ExternalSourceEventPersistence } from "./external-source-event-persistence.js";
export function getExternalSourceEventByIdUseCase(persistence: ExternalSourceEventPersistence) {
  return (id: number) => persistence.getById(validateApplicationInput(() => createExternalSourceEventId(id)));
}
