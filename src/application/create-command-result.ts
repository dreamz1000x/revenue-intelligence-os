export type CreateCommandOutcome = "created" | "replayed";

export interface CreateCommandResult<T> {
  readonly resource: T;
  readonly outcome: CreateCommandOutcome;
}
