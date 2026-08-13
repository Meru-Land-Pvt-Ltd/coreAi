/**
 * HubSpot rate-limit handling.
 *
 * HubSpot returns 429 with a Retry-After header when an app burns its per-app
 * or per-portal budget. Retrying blind turns one throttled request into a
 * cascade, so every call goes through this bounded exponential backoff that
 * honours Retry-After when HubSpot sends one.
 *
 * Deliberately NOT retried: 4xx other than 429 (a bad request stays bad) and
 * anything on the latency-critical voice path beyond one quick attempt — the
 * caller is waiting, and no CRM context beats a delayed greeting.
 */

export interface RetryOptions {
  /** Total attempts including the first. */
  maxAttempts?: number;
  /** Base delay for exponential backoff. */
  baseDelayMs?: number;
  /** Hard ceiling on any single wait. */
  maxDelayMs?: number;
  label?: string;
}

const DEFAULTS: Required<Omit<RetryOptions, "label">> = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000
};

export class HubSpotApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "HubSpotApiError";
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}

function retryDelayMs(response: Response, attempt: number, options: Required<Omit<RetryOptions, "label">>): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, options.maxDelayMs);
    }
  }
  // Jitter keeps concurrent callers from retrying in lockstep.
  const exponential = options.baseDelayMs * 2 ** (attempt - 1);
  return Math.min(exponential + Math.random() * options.baseDelayMs, options.maxDelayMs);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Run a HubSpot request, retrying only on 429 and 5xx.
 * `perform` must return the raw Response so headers stay inspectable.
 */
export async function withHubSpotRetry(
  perform: () => Promise<Response>,
  options: RetryOptions = {}
): Promise<Response> {
  const config = { ...DEFAULTS, ...options };
  let lastResponse: Response | null = null;

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    const response = await perform();

    if (response.status !== 429 && response.status < 500) return response;

    lastResponse = response;
    if (attempt === config.maxAttempts) break;

    const delay = retryDelayMs(response, attempt, config);
    console.warn("[hubspot] retrying after throttle/server error", {
      label: options.label,
      status: response.status,
      attempt,
      delayMs: Math.round(delay)
    });
    await sleep(delay);
  }

  return lastResponse as Response;
}
