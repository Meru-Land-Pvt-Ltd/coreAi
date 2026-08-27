/**
 * THE ENGINE — the one runner every connector goes through.
 *
 * A connector's own code (its "heart") knows exactly one thing: how to talk to
 * one service and what its answers mean. It does not read config, log, retry,
 * count cost, respect rate limits, check consent, or format anything. All of
 * that happens here, identically, for every connector that will ever exist.
 *
 * That is the whole trade: write the hard part once, and a new service becomes
 * a small file instead of a week of work touching eight places.
 *
 * Two guarantees this file exists to enforce:
 *
 *  1. A CONNECTOR CANNOT PRETEND IT WORKED. The heart's answer is checked
 *     against what the contract said it produces. A calendar node once
 *     answered "10:00 AM, 2:00 PM, 4:30 PM" when Google was unreachable and
 *     logged it as a success; a business would have booked a real patient into
 *     a slot that did not exist. Here that is structurally impossible.
 *
 *  2. A HEART CANNOT SPEND WITHOUT A CEILING. Every paid call is counted
 *     against the business's daily budget BEFORE it is made, and refunded if
 *     it never happened. A month of Apollo credits cannot vanish in a morning.
 */

import {
  checkFrameRules,
  checkHeartResult,
  type NodeFrame,
  type HeartContext,
  type HeartResult,
  HttpError,
  type HttpClient,
  type HttpRequest,
  type HttpResponse
} from "@coreai/shared";
import { checkRecipeUrl } from "./recipe-heart";
import { consumeLimit, DAY, MINUTE } from "../../lib/rate-limit";
import { platformApiSetting } from "../admin/platform-api-settings";

export type ConnectorRunInput = {
  contract: NodeFrame;
  /** Whose run this is — every limit and every cost is scoped to them. */
  businessId: string;
  /** Values from all three owners, already merged by the caller. */
  config: Record<string, unknown>;
  /** A rehearsal never touches the outside world. */
  isTest?: boolean;
  /** What this business is allowed to spend today, in cents. 0 = no ceiling. */
  budgetCents?: number;
};

export type ConnectorRunLog = {
  at: string;
  message: string;
  detail?: unknown;
};

export type ConnectorRunResult = {
  ok: boolean;
  /** Merged outputs across every page. Empty when the run failed. */
  outputs: Record<string, unknown>;
  /** What a person is told. Never implies something happened that did not. */
  message: string;
  /** Machine-readable reason, for dashboards and alerts. */
  code:
    | "ok"
    | "missing_credential"
    | "rate_limited"
    | "budget_exceeded"
    | "blocked_by_rule"
    | "provider_error"
    | "dishonest_result"
    | "not_configured";
  pagesFetched: number;
  costCents: number;
  logs: ConnectorRunLog[];
};

/* -------------------------------------------------------------------------- */

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Resolve the credentials the contract asked for.
 *
 * Reads through the admin store first (an admin-saved key beats a server
 * environment variable), which is the same resolver the rest of the platform
 * uses. A heart never looks a credential up itself — that is how keys end up
 * copied into a dozen files and missed when one is rotated.
 */
function resolveCredentials(
  contract: NodeFrame,
  config: Record<string, unknown>
): { credentials: Record<string, string>; missing: string[] } {
  const credentials: Record<string, string> = {};
  const missing: string[] = [];

  for (const need of contract.needs.platform) {
    // A business may supply their own key for this provider, which is the
    // normal arrangement for metered data services: their account, their bill,
    // their rate limit. The platform key is the fallback.
    const fromBusiness = config[need.key];
    // An architect-built frame never reaches the platform's own key store. Its
    // credential comes from the architect who built it or the business that
    // installed it — see `source` on the frame for why this line exists.
    const fromPlatform = contract.source === "architect" ? "" : platformApiSetting(need.key);
    const value = (typeof fromBusiness === "string" && fromBusiness.trim()) || fromPlatform || "";

    if (value) credentials[need.key] = value;
    else if (need.required) missing.push(need.label);
  }

  return { credentials, missing };
}

/**
 * Errors worth trying again.
 *
 * A wrong key is still wrong on the fourth attempt, and retrying "payment
 * required" four times is just four times the bill. Anything the contract
 * lists as never-retry is final, and so is any 4xx that is not a rate limit.
 */
function shouldRetry(contract: NodeFrame, status: number | undefined): boolean {
  if (status === undefined) return true; // a network blip, worth one more try
  if (contract.failure.neverRetry.includes(status)) return false;
  if (status === 429) return true; // throttled — backing off is the right answer
  if (status >= 400 && status < 500) return false;
  return status >= 500;
}

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown; statusCode?: unknown })?.status ??
    (error as { statusCode?: unknown })?.statusCode;
  return typeof status === "number" ? status : undefined;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* -------------------------------------------------------------------------- */
/* The only way a heart reaches the network                                    */
/* -------------------------------------------------------------------------- */

/**
 * Build the http client a heart is handed.
 *
 * Every connector used to hand-roll this, and a fresh writer got it wrong in
 * the most expensive possible way: `throw new Error("Failed: " + statusText)`.
 * That reads fine and hides the status, so the engine could no longer tell a
 * 429 from a 401 and retried a wrong API key three times on every run.
 *
 * Supplying the client is what makes that impossible rather than discouraged.
 */
function makeHttpClient(log: (message: string, detail?: unknown) => void): HttpClient {
  const request = async (input: HttpRequest): Promise<HttpResponse> => {
    const method = input.method ?? (input.body === undefined ? "GET" : "POST");
    const started = Date.now();

    /* A CHECKED ADDRESS THAT REDIRECTS IS AN UNCHECKED ADDRESS (found by the
       platform audit, 2026-08-27). Node follows up to twenty redirects by
       default, and only the FIRST url had passed checkRecipeUrl — so a
       service could answer "301 → http://postgres:5432" and our own network
       would be reached with the architect's key attached. Every hop is
       checked here, and a redirect that fails ends the request. */
    let target = input.url;
    let response: Response;
    for (let hop = 0; ; hop += 1) {
      const problem = checkRecipeUrl(target);
      if (problem) {
        const error = new Error(problem) as Error & { status: number };
        error.status = 400;
        throw error;
      }

      response = await fetch(target, {
        method,
        headers: {
          ...(input.body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(input.headers ?? {})
        },
        ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs ?? 20_000)
      });

      const location =
        response.status >= 300 && response.status < 400 ? response.headers.get("location") : null;
      if (!location) break;
      if (hop >= 5) {
        const error = new Error("That service kept redirecting and never answered.") as Error & {
          status: number;
        };
        error.status = 502;
        throw error;
      }
      target = new URL(location, target).toString();
    }

    const text = await response.text();
    let body: unknown = text;
    if (text.trim()) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }

    // Never the URL's query string and never a header: both routinely carry
    // credentials, and this line goes into a run log a business can read.
    log(`${method} ${input.url.split("?")[0]} → ${response.status}`, { ms: Date.now() - started });

    if (!response.ok) {
      throw new HttpError(`${new URL(input.url).host} responded ${response.status}`, response.status, body);
    }

    return { status: response.status, body, text };
  };

  const client = ((input: HttpRequest) => request(input)) as HttpClient;
  client.get = (url, headers) => request({ url, method: "GET", headers });
  client.post = (url, body, headers) => request({ url, method: "POST", body, headers });
  return client;
}

/**
 * The answer to a rehearsal, built from what the contract declared.
 *
 * The heart is not called at all. Every connector used to carry its own
 * `if (isTest)` branch, which meant every connector could forget it — and the
 * cost of forgetting is a "test" that spends real credits or emails real
 * strangers. The declared samples are already required, already realistic
 * enough for the AI doors to translate with, and already what the honesty
 * check measures against. Using them here makes a rehearsal structurally
 * incapable of reaching anybody.
 */
function rehearsalOutputs(contract: NodeFrame): Record<string, unknown> {
  const outputs: Record<string, unknown> = {};
  for (const output of contract.produces) outputs[output.key] = output.sample;
  return outputs;
}

/** How many things a run produced, when the heart did not say. */
function unitsFromOutputs(contract: NodeFrame, outputs: Record<string, unknown>): number {
  let units = 0;
  for (const output of contract.produces) {
    const value = outputs[output.key];
    if (Array.isArray(value)) units += value.length;
  }
  return units;
}

/* -------------------------------------------------------------------------- */

/**
 * Run one connector, all the way through.
 *
 * Order matters and is deliberate: rules before money, money before the
 * network. Nothing is spent on a call the rules would have refused.
 */
export async function runConnector(input: ConnectorRunInput): Promise<ConnectorRunResult> {
  const { contract, businessId } = input;
  const logs: ConnectorRunLog[] = [];
  const log = (message: string, detail?: unknown) => {
    logs.push({ at: nowIso(), message, ...(detail === undefined ? {} : { detail }) });
  };

  const fail = (
    code: ConnectorRunResult["code"],
    message: string
  ): ConnectorRunResult => ({
    ok: false,
    outputs: {},
    message,
    code,
    pagesFetched: 0,
    costCents: 0,
    logs
  });

  // ---- A rehearsal never reaches anybody ----------------------------------
  //
  // Answered here, from the contract's own declared samples, without calling
  // the heart. Placed before the limits and the budget as well: rehearsing an
  // agent forty times must not use up the day's real allowance.
  if (input.isTest) {
    const outputs = rehearsalOutputs(contract);
    log("rehearsal — the provider was not called", { outputs: Object.keys(outputs) });
    return {
      ok: true,
      outputs,
      message: `${contract.label} ran as a test. ${contract.provider.name} was not contacted and nothing was charged.`,
      code: "ok",
      pagesFetched: 1,
      costCents: 0,
      logs
    };
  }

  const http = makeHttpClient(log);

  // ---- Credentials --------------------------------------------------------
  const { credentials, missing } = resolveCredentials(contract, input.config);
  if (missing.length > 0) {
    log("missing credential", missing);
    return fail(
      "missing_credential",
      `${contract.provider.name} is not connected yet — ${missing.join(" and ")} is needed before this can run.`
    );
  }

  // ---- Rules, before anything is spent ------------------------------------
  //
  // These are the rules that protect the person at the other end. They run
  // before the rate limits, before the budget and before the heart, so a
  // refusal here costs nothing and leaves no trace of a message that was never
  // sent. checkFrameRules lives in the shared package with no I/O, so the
  // decision can be tested on its own and cannot drift from what the contract
  // declares.
  // isTest is false by construction here: a rehearsal returned above without
  // ever reaching this point.
  const ruled = checkFrameRules(contract, { config: input.config, isTest: false });
  if (!ruled.ok) {
    log("blocked by a rule", { rule: ruled.rule });
    return fail("blocked_by_rule", ruled.message);
  }

  if (contract.rules.hardDailyCap) {
    const cap = await consumeLimit({
      key: `connector:cap:${contract.id}:${businessId}`,
      limit: contract.rules.hardDailyCap,
      windowMs: DAY
    });
    if (!cap.allowed) {
      log("hard daily cap reached", { cap: contract.rules.hardDailyCap });
      return fail(
        "blocked_by_rule",
        `This has already run its maximum for today (${contract.rules.hardDailyCap}). It will carry on tomorrow.`
      );
    }
  }

  // ---- The provider's own limits ------------------------------------------
  const perMinute = await consumeLimit({
    key: `connector:min:${contract.id}:${businessId}`,
    limit: contract.limits.callsPerMinute,
    windowMs: MINUTE
  });
  if (!perMinute.allowed) {
    log("throttled by our own rate limit");
    return fail(
      "rate_limited",
      `${contract.provider.name} is being called too quickly. This will pick up again shortly.`
    );
  }

  const perDay = await consumeLimit({
    key: `connector:day:${contract.id}:${businessId}`,
    limit: contract.limits.callsPerDay,
    windowMs: DAY
  });
  if (!perDay.allowed) {
    log("daily call limit reached");
    return fail(
      "rate_limited",
      `Today's limit for ${contract.provider.name} has been reached. It resumes tomorrow.`
    );
  }

  // ---- Money, before the network ------------------------------------------
  //
  // The counter is in CENTS, not in calls. It used to tick once per call while
  // the cost was charged per result, so a per-result connector on a $20 ceiling
  // could really spend around $500 — the exact "a month of credits vanishes in
  // a morning" failure this was written to prevent.
  //
  // A per-result call reserves the worst case up front (a full page at the
  // declared unit price) and gives back what it did not use once the real count
  // is known. Reserving the worst case is what makes the ceiling a ceiling.
  const budgetCents = input.budgetCents ?? 0;
  const perUnit = contract.cost.style === "free" ? 0 : contract.cost.estimateCents;
  const worstCasePerCall =
    contract.cost.style === "per_result" ? perUnit * Math.max(1, contract.limits.pageSize ?? 1) : perUnit;

  let reservedCents = 0;
  if (budgetCents > 0 && worstCasePerCall > 0) {
    const maxPagesForSpend = contract.execution === "paged" ? Math.max(1, contract.limits.maxPages ?? 1) : 1;
    reservedCents = worstCasePerCall * maxPagesForSpend;

    const spend = await consumeLimit({
      key: `connector:spend:${businessId}`,
      limit: budgetCents,
      windowMs: DAY,
      cost: reservedCents
    });
    if (!spend.allowed) {
      log("daily budget reached", { budgetCents, wanted: reservedCents });
      return fail(
        "budget_exceeded",
        `Today's spending limit has been reached, so nothing further was run. Raise the limit to continue.`
      );
    }
  }

  /**
   * What this run has cost up to this moment.
   *
   * Defined once and read at every exit, so a run that dies on page three is
   * still charged for pages one and two — the provider billed us for those
   * whether or not we could use the result.
   */
  const costSoFar = () =>
    contract.cost.style === "free"
      ? 0
      : contract.cost.style === "per_result"
        ? unitsUsed * contract.cost.estimateCents
        : pagesFetched * contract.cost.estimateCents;

  /**
   * Hand back whatever the run did not actually spend.
   *
   * Settles once. The paged loop can reach this through more than one exit —
   * a failed page that is skipped still falls through to the normal ending —
   * and refunding twice would hand the business back money it never reserved,
   * quietly raising its ceiling every time a provider hiccuped.
   */
  let settled = false;
  const refund = async (actualCents: number) => {
    if (settled) return;
    settled = true;
    const unused = reservedCents - Math.round(actualCents);
    if (unused <= 0) return;
    await consumeLimit({
      key: `connector:spend:${businessId}`,
      limit: budgetCents,
      windowMs: DAY,
      cost: -unused
    }).catch(() => undefined);
  };

  // ---- The heart, with paging and retries ---------------------------------
  const merged: Record<string, unknown> = {};
  let pagesFetched = 0;
  let cursor: string | undefined;
  let unitsUsed = 0;

  const maxPages = contract.execution === "paged" ? contract.limits.maxPages ?? 1 : 1;

  for (let page = 1; page <= maxPages; page++) {
    const context: HeartContext = {
      config: input.config,
      credentials,
      http,
      page,
      pageSize: contract.limits.pageSize ?? 25,
      cursor,
      isTest: false,
      log
    };

    let result: HeartResult | null = null;
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= contract.failure.maxRetries; attempt++) {
      try {
        result = await contract.heart(context);
        break;
      } catch (error) {
        lastError = error;
        const status = statusOf(error);
        const retryable = contract.failure.onError === "retry" && shouldRetry(contract, status);
        log(`call failed (attempt ${attempt + 1})`, {
          status,
          retryable,
          error: error instanceof Error ? error.message : String(error)
        });
        if (!retryable || attempt === contract.failure.maxRetries) break;
        // Widening pause. Hitting a struggling provider harder is how a blip
        // becomes an outage.
        await sleep(contract.failure.backoffMs * Math.pow(2, attempt));
      }
    }

    if (!result) {
      const status = statusOf(lastError);
      // "stop" ends the run. "skip" keeps whatever earlier pages returned,
      // because half a list is still worth something; nothing is invented
      // either way.
      if (contract.failure.onError === "skip" && pagesFetched > 0) {
        log("giving up on further pages, keeping what was already fetched");
        break;
      }
      await refund(costSoFar());
      return fail("provider_error", `${contract.failure.humanMessage} (${status ?? "no response"})`);
    }

    // ---- THE HONESTY CHECK ------------------------------------------------
    // A heart that returns nothing must not be reported as a success. This one
    // check is the difference between "we found no leads" and "we invented
    // three appointment times because Google was down".
    const honest = checkHeartResult(contract, result);
    if (!honest.ok) {
      log("the connector reported success without returning what it promised", honest.missing);
      await refund(costSoFar());
      return fail(
        "dishonest_result",
        `${contract.provider.name} answered, but without ${honest.missing.join(" or ")}. Nothing was recorded, because a partial answer here would be worse than none.`
      );
    }

    for (const [key, value] of Object.entries(result.outputs)) {
      const existing = merged[key];
      if (Array.isArray(existing) && Array.isArray(value)) merged[key] = [...existing, ...value];
      else merged[key] = value;
    }

    pagesFetched += 1;
    // A heart that forgets to report what it produced must not silently make a
    // per-result ceiling count one. The declared outputs already say.
    unitsUsed += result.unitsUsed ?? unitsFromOutputs(contract, result.outputs) ?? 1;
    cursor = result.cursor;

    if (contract.execution !== "paged" || !result.morePages) break;
  }

  const costCents = costSoFar();

  // Give back what was reserved and not spent, so an agent that finds three
  // leads has not quietly eaten a whole page's worth of somebody's ceiling.
  await refund(costCents);

  log("done", { pagesFetched, unitsUsed, costCents, reservedCents });

  return {
    ok: true,
    outputs: merged,
    message:
      pagesFetched > 1
        ? `${contract.label} finished, across ${pagesFetched} pages.`
        : `${contract.label} finished.`,
    code: "ok",
    pagesFetched,
    costCents,
    logs
  };
}

/* -------------------------------------------------------------------------- */
/* The daily self-test                                                         */
/* -------------------------------------------------------------------------- */

export type HealthResult = {
  connectorId: string;
  healthy: boolean;
  checkedAt: string;
  /** Plain words, for whoever has to act on it. */
  message: string;
  severity: NodeFrame["health"]["severity"];
  missingKeys?: string[];
};

/**
 * Ask one connector whether it still works.
 *
 * This is what replaces a person reading a provider's changelog. It sends one
 * tiny known request and checks the answer still has the shape we expect. When
 * a provider quietly renames a field or retires an endpoint, this notices the
 * same day — before a customer's agent does.
 */
export async function checkConnectorHealth(
  contract: NodeFrame,
  config: Record<string, unknown> = {}
): Promise<HealthResult> {
  const base = {
    connectorId: contract.id,
    checkedAt: nowIso(),
    severity: contract.health.severity
  };

  if (!contract.probe) {
    return { ...base, healthy: false, message: "This connector has no self-test." };
  }

  const { credentials, missing } = resolveCredentials(contract, config);
  if (missing.length > 0) {
    // Not a failure of the connector — nobody has given it a key yet. Saying
    // "broken" here would cry wolf every day until someone stopped listening.
    return {
      ...base,
      healthy: true,
      message: `Not checked — ${contract.provider.name} has no key configured yet.`
    };
  }

  try {
    // No config, on purpose: a self-test runs with no business attached, so a
    // probe that needed one would be a daily false alarm.
    const result = await contract.probe({
      credentials,
      http: makeHttpClient(() => undefined),
      log: () => undefined
    });

    // The connector told us plainly that this provider has nothing it can
    // check without a customer's own data. Better than a daily false alarm,
    // and visible to whoever has to decide what we are flying blind on.
    if ("cannotSelfTest" in result) {
      return {
        ...base,
        healthy: true,
        message: `Not checked — ${result.cannotSelfTest}`
      };
    }

    const missingKeys = contract.health.expectKeys.filter(
      (key) => result.outputs?.[key] === undefined
    );

    if (missingKeys.length > 0) {
      return {
        ...base,
        healthy: false,
        missingKeys,
        message: `${contract.provider.name} answered, but ${missingKeys.join(" and ")} is gone. Their API has probably changed — check ${contract.provider.docsUrl} against version ${contract.provider.apiVersion}.`
      };
    }

    return { ...base, healthy: true, message: `${contract.provider.name} is answering normally.` };
  } catch (error) {
    return {
      ...base,
      healthy: false,
      message: `${contract.provider.name} could not be reached: ${
        error instanceof Error ? error.message : String(error)
      }`
    };
  }
}
