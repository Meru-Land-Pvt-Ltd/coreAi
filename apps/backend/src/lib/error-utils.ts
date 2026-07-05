export type UnknownErrorRecord = Record<string, unknown>;

export type ApiErrorStatus = 400 | 401 | 402 | 403 | 404 | 409 | 422 | 429 | 500 | 503;

const API_ERROR_STATUSES = new Set<number>([400, 401, 402, 403, 404, 409, 422, 429, 500, 503]);

export function isRecord(value: unknown): value is UnknownErrorRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function errorMessage(error: unknown, fallback = "Unexpected error occurred"): string {
  if (error instanceof Error && error.message.trim()) return error.message;

  if (typeof error === "string" && error.trim()) return error.trim();

  if (isRecord(error)) {
    const message = error.message ?? error.error ?? error.details;

    if (typeof message === "string" && message.trim()) return message.trim();

    if (Array.isArray(message)) {
      const joined = message
        .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
        .filter(Boolean)
        .join("; ");

      if (joined) return joined;
    }
  }

  return fallback;
}

export function errorCode(error: unknown, fallback = "REQUEST_ERROR"): string {
  if (isRecord(error) && typeof error.code === "string" && error.code.trim()) {
    return error.code.trim();
  }

  return fallback;
}

export function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

export function apiErrorStatus(value: unknown, fallback: ApiErrorStatus = 500): ApiErrorStatus {
  const raw = typeof value === "number" ? value : Number(value);
  return API_ERROR_STATUSES.has(raw) ? (raw as ApiErrorStatus) : fallback;
}

export function errorStatus(error: unknown, fallback: ApiErrorStatus = 500): ApiErrorStatus {
  if (isRecord(error)) {
    return apiErrorStatus(error.statusCode ?? error.status, fallback);
  }

  return fallback;
}
