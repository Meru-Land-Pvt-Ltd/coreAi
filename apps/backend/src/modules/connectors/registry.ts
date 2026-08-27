/**
 * WHERE CONNECTORS LIVE.
 *
 * One place that knows every connector, checks each one is well-formed before
 * it is allowed to exist, and answers two questions the rest of the platform
 * asks constantly:
 *
 *   "who can do this job?"        → so an agent can ask for work-email lookup
 *                                    without naming Apollo, and survive Apollo
 *                                    being bought and shut down
 *   "what does this one need?"    → so the buyer's setup form, the admin panel
 *                                    and the daily health check all generate
 *                                    themselves
 *
 * Validation runs at import time on purpose. A connector that cannot be trusted
 * should stop a deploy loudly, not wait to be discovered by a customer whose
 * agent quietly did nothing all week.
 */

import {
  validateNodeFrame,
  type NodeFrame,
  type ConnectorJob
} from "@coreai/shared";
import { apolloFindPeople } from "./catalogue/apollo";
import { instantlyAddLeads, instantlyReplies } from "./catalogue/instantly";
import { cachedArchitectFrame } from "./architect-frames";

/**
 * Every connector on the platform.
 *
 * Adding a service means adding one file and one line here. Nothing else — not
 * the setup form, not the dashboard, not the pricing panel, not the retries.
 */
const CONTRACTS: NodeFrame[] = [apolloFindPeople, instantlyAddLeads, instantlyReplies];

const byId = new Map<string, NodeFrame>();
const byJob = new Map<ConnectorJob, NodeFrame[]>();

const problems: string[] = [];

for (const contract of CONTRACTS) {
  const issues = validateNodeFrame(contract);
  if (issues.length > 0) {
    problems.push(...issues);
    continue;
  }
  if (byId.has(contract.id)) {
    problems.push(`${contract.id}: two connectors share this id.`);
    continue;
  }
  byId.set(contract.id, contract);
  byJob.set(contract.job, [...(byJob.get(contract.job) ?? []), contract]);
}

if (problems.length > 0) {
  // Loud, and with every problem at once — fixing them one deploy at a time is
  // how a five-minute correction becomes an afternoon.
  console.error(
    `[connectors] ${problems.length} connector(s) are not well-formed and were NOT registered:\n  - ${problems.join(
      "\n  - "
    )}`
  );
}

/** Everything that registered cleanly. */
export function allConnectors(): NodeFrame[] {
  return [...byId.values()];
}

/**
 * One frame by id — ours, or one an architect built.
 *
 * The catalogue wins on a clash, so an architect cannot shadow a connector we
 * ship by reusing its id and quietly change what it does for their buyers.
 */
export function getConnector(id: string, architectUserId?: string): NodeFrame | undefined {
  /* NAME THE OWNER WHEN YOU KNOW IT. Card ids are built from the company name
     — "notion", "apollo" — and they are unique per architect, not globally.
     Without an owner the lookup can only answer when exactly one architect
     owns that id, so the day a second architect built their own Notion card
     the first architect's live agents started failing with "not installed".
     Every caller that knows whose run this is now says so. */
  return byId.get(id) ?? cachedArchitectFrame(id, architectUserId);
}

/**
 * Who can do this job?
 *
 * Ordered so the most widely rolled-out comes first: an agent asking for
 * "find work emails" gets the one we trust most, and a canary version is only
 * chosen deliberately.
 */
export function connectorsForJob(job: ConnectorJob): NodeFrame[] {
  const order = { everyone: 0, canary: 1, internal: 2 } as const;
  return [...(byJob.get(job) ?? [])].sort((a, b) => order[a.rollout] - order[b.rollout]);
}

/** Anything that failed validation, so an admin screen can show it. */
export function connectorProblems(): string[] {
  return [...problems];
}

/**
 * Connectors whose provider version has not been confirmed in a long time.
 *
 * The founder's original instinct was to assign a person to watch each
 * provider's changelog. The daily self-test covers breakage; this covers the
 * quieter risk — a heart nobody has looked at in a year, still working, while
 * the provider has published two new versions and deprecated the one we use.
 */
export function connectorsNeedingReview(now: Date = new Date(), months = 6): NodeFrame[] {
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - months);

  return allConnectors().filter((contract) => {
    const verified = new Date(contract.provider.lastVerified);
    return Number.isNaN(verified.getTime()) || verified < cutoff;
  });
}
