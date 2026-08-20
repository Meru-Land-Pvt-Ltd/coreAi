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
  checkConnectorRules,
  checkHeartResult,
  type ConnectorContract,
  type HeartContext,
  type HeartResult
} from "@coreai/shared";
import { consumeLimit, DAY, MINUTE } from "../../lib/rate-limit";
import { platformApiSetting } from "../admin/platform-api-settings";

export type ConnectorRunInput = {
  contract: ConnectorContract;
  /** Whose run this is — every limit and every cost is scoped to them. */
  businessId: string;
  /** Values from all three owners, already merged by the caller. */
  config: Record<string, unknown>;
  /** A rehearsal never touches the outside world. */
  isTest?: boolean;
  /** What this business is allowed to spend today, in cents. 0 = no ceiling. */
  budgetCents?: number;
  /**
   * Phone numbers and inboxes the architect has proved they own.
   *
   * Only consulted by connectors that declare testOnlyToVerifiedIdentity. Empty
   * means none proved, and such a connector then refuses to rehearse — which is
   * the safe direction, because the alternative is a "test" that emails two
   * hundred strangers.
   */
  verifiedIdentities?: string[];
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
  contract: ConnectorContract,
  config: Record<string, unknown>
): { credentials: Record<string, string>; missing: string[] } {
  const credentials: Record<string, string> = {};
  const missing: string[] = [];

  for (const need of contract.needs.platform) {
    // A business may supply their own key for this provider, which is the
    // normal arrangement for metered data services: their account, their bill,
    // their rate limit. The platform key is the fallback.
    const fromBusiness = config[need.key];
    const value =
      (typeof fromBusiness === "string" && fromBusiness.trim()) || platformApiSetting(need.key) || "";

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
function shouldRetry(contract: ConnectorContract, status: number | undefined): boolean {
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
  // sent. checkConnectorRules lives in the shared package with no I/O, so the
  // decision can be tested on its own and cannot drift from what the contract
  // declares.
  const ruled = checkConnectorRules(contract, {
    config: input.config,
    isTest: input.isTest === true,
    verifiedIdentities: input.verifiedIdentities
  });
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
      page,
      cursor,
      isTest: input.isTest === true,
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
    unitsUsed += result.unitsUsed ?? 1;
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
  severity: ConnectorContract["health"]["severity"];
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
  contract: ConnectorContract,
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
    const result = await contract.probe({
      config,
      credentials,
      page: 1,
      isTest: false,
      log: () => undefined
    });

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
