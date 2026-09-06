export type ApiErrorKind = "unauthorized" | "forbidden" | "missing" | "conflict" | "invalid" | "limited" | "unavailable";
export const kindForStatus = (status: number): ApiErrorKind => status === 401 ? "unauthorized" : status === 403 ? "forbidden" : status === 404 ? "missing" : status === 409 ? "conflict" : status === 422 || status === 400 ? "invalid" : status === 429 ? "limited" : "unavailable";
