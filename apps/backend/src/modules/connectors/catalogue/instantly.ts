/**
 * INSTANTLY — cold email sending, and the replies that come back.
 *
 * The second service written to the standard, and the first that needed the
 * standard to grow. Apollo only ever answers a question we ask it. Instantly
 * does that AND knocks on our door when a prospect replies, which is a
 * different shape of work — the one Twilio, Vapi, Calendly and Stripe each
 * hand-wrote separately. Building it here built it for all of them.
 *
 * Two connectors, because the standard is one contract per JOB, not per
 * company:
 *
 *   instantly.add_leads  — put people into a campaign      (we ask)
 *   instantly.replies    — a prospect wrote back            (they knock)
 *
 * There is no code in this file for retries, backoff, throttling, cost
 * ceilings, consent, logging, the setup form, the dashboard, the webhook
 * address, the duplicate filter, or checking whether the agent is paused. All
 * of that is the engine's, identically, for every connector.
 *
 * Provider docs: https://developer.instantly.ai
 * API v2, base https://api.instantly.ai/api/v2, bearer-token auth.
 */

import type {
  NodeFrame,
  HeartContext,
  HeartResult,
  ProbeContext,
  InboundContext,
  InboundResult
} from "@coreai/shared";

const API = "https://api.instantly.ai/api/v2";

/** One request to Instantly, shared by both connectors and the self-test. */
async function call(
  context: HeartContext | ProbeContext,
  method: "GET" | "POST",
  path: string,
  body?: unknown
): Promise<Record<string, unknown>> {
  // context.http, never fetch: the engine reads the status off the error it
  // throws to decide whether a retry is sensible.
  const answer = await context.http({
    url: `${API}${path}`,
    method,
    body,
    headers: { Authorization: `Bearer ${context.credentials.INSTANTLY_API_KEY}` }
  });
  return (answer.body ?? {}) as Record<string, unknown>;
}

/** A textarea of lines, a real list, or one value — always a clean list. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item ?? "").trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,;]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * The people to add, from whatever the previous step produced.
 *
 * A lead-finding step hands on objects; a business pasting a list hands on
 * strings. Both are normal, and a connector that only understood one of them
 * would work in the builder and fail for the customer.
 */
function leadsFrom(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value
      .map((item): Record<string, unknown> | null => {
        if (typeof item === "string") return { email: item.trim() };
        if (item && typeof item === "object") {
          const lead = item as Record<string, unknown>;
          const email = String(lead.email ?? "").trim();
          if (!email) return null;
          return {
            email,
            ...(lead.name || lead.first_name
              ? { first_name: String(lead.first_name ?? lead.name ?? "").split(" ")[0] }
              : {}),
            ...(lead.company ? { company_name: String(lead.company) } : {}),
            ...(lead.title ? { personalization: String(lead.title) } : {})
          };
        }
        return null;
      })
      .filter((lead): lead is Record<string, unknown> => lead !== null);
  }
  return asList(value).map((email) => ({ email }));
}

/** Only real addresses. A row with no email looks like a lead and never sends. */
function withEmail(leads: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return leads.filter((lead) => {
    const email = String(lead.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || seen.has(email)) return false;
    seen.add(email);
    return true;
  });
}

/* ========================================================================== */
/* 1 · Put people into a campaign                                             */
/* ========================================================================== */

export const instantlyAddLeads: NodeFrame = {
  id: "instantly.add_leads",
  version: "1.0.0",
  job: "send-email-campaign",
  label: "Add people to an Instantly campaign",
  shortLabel: "Instantly",
  description: "Puts the people found earlier into one of your Instantly campaigns, ready to be emailed.",

  provider: {
    name: "Instantly",
    docsUrl: "https://developer.instantly.ai",
    termsUrl: "https://instantly.ai/terms",
    apiVersion: "v2",
    lastVerified: "2026-08-20"
  },

  needs: {
    platform: [
      {
        key: "INSTANTLY_API_KEY",
        label: "Instantly API key",
        kind: "api_key",
        help:
          "Instantly bills per workspace, so a business normally uses their own key — their account, their sending reputation, their bill.",
        required: true
      }
    ],
    architect: [],
    business: [
      {
        key: "campaignId",
        label: "Which campaign should these people go into?",
        help:
          "Open the campaign in Instantly — the long code in your browser's address bar is the campaign id.",
        kind: "text",
        required: true,
        placeholder: "0d4a1c2e-...."
      }
    ],
    accounts: []
  },

  produces: [
    {
      key: "leadsAdded",
      label: "People added to the campaign",
      kind: "list",
      required: true,
      sample: [{ email: "priya@brightsmiledental.com", first_name: "Priya", company_name: "Bright Smile Dental" }]
    },
    { key: "skipped", label: "Skipped (no address, or already there)", kind: "number", required: false, sample: 3 }
  ],

  cost: {
    style: "per_result",
    // Instantly charges by plan and sending volume rather than per lead. This
    // is a deliberate over-estimate so a ceiling errs on the side of stopping
    // early — a connector that under-estimates its cost has no ceiling at all.
    estimateCents: 1,
    unit: "per person added",
    billedTo: "business",
    note: "Instantly bills the workspace whose key is used. With their own key, the business is billed directly."
  },

  failure: {
    onError: "retry",
    maxRetries: 2,
    backoffMs: 1_000,
    // 401 wrong key · 402 plan limit · 403 not allowed · 422 bad campaign id.
    neverRetry: [401, 402, 403, 422],
    humanMessage:
      "Instantly could not be reached, so nobody was added this time. Nothing was charged, and it will try again on the next run."
  },

  limits: {
    callsPerMinute: 10,
    callsPerDay: 200,
    concurrent: 1,
    // Instantly accepts up to 1000 in one request; 100 keeps a single failure
    // small and a retry cheap.
    pageSize: 100,
    maxPages: 10
  },

  rules: {
    /*
     * The business must confirm they may contact these people.
     *
     * This is now enforced by the engine, not just displayed: answering "No"
     * on the setup form stops the run before anything is sent. Cold email is
     * lawful in the US with a working opt-out, and needs a lawful basis in the
     * EU — which is the business's call to make and ours to ask about.
     */
    requiresConsent: true,
    hardDailyCap: 5_000,
    notes: [
      "Unsubscribe is Instantly's job, not ours: they add and honour the opt-out link on every campaign. requiresUnsubscribe is deliberately NOT declared here, because we do not hold the message and could not truthfully check it.",
      "In the EU, emailing an address found by a lookup tool needs a lawful basis under GDPR. The consent question above is what puts that decision in front of the business."
    ]
  },

  health: {
    everyHours: 24,
    expectKeys: ["campaigns"],
    severity: "breaks-agents"
  },

  execution: "immediate",
  // Real and runnable. Held at canary until the add-leads response shape has
  // been seen once against a live Instantly workspace.
  rollout: "canary",

  heart: async (context: HeartContext): Promise<HeartResult> => {
    const campaignId = String(context.config.campaignId ?? "").trim();
    const candidates = leadsFrom(context.config.leads ?? context.config.people ?? context.config.emails);
    const leads = withEmail(candidates);
    const skipped = candidates.length - leads.length;

    if (leads.length === 0) {
      // A real, honest answer: the step ran, and there was nobody to add.
      context.log("nobody had a usable email address");
      return { outputs: { leadsAdded: [], skipped } };
    }

    await call(context, "POST", "/leads/add-in-bulk", { campaign_id: campaignId, leads });
    context.log(`added ${leads.length} people to campaign ${campaignId}`);

    return {
      outputs: { leadsAdded: leads, skipped },
      unitsUsed: leads.length
    };
  },

  probe: async (context: ProbeContext): Promise<HeartResult> => {
    const answer = await call(context, "GET", "/campaigns?limit=1");
    return { outputs: { campaigns: answer.items ?? answer.data ?? [] } };
  }
};

/* ========================================================================== */
/* 2 · A prospect wrote back                                                  */
/* ========================================================================== */

/** Reply text, whichever field this event happens to carry it in. */
function replyTextOf(payload: Record<string, unknown>): string {
  for (const key of ["reply_text", "reply_text_snippet", "reply", "text", "body", "email_text", "message"]) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export const instantlyReplies: NodeFrame = {
  id: "instantly.replies",
  version: "1.0.0",
  job: "read-campaign-replies",
  label: "When someone replies in Instantly",
  shortLabel: "Instantly reply",
  description: "Starts your agent the moment a prospect replies to one of your Instantly emails.",

  provider: {
    name: "Instantly",
    docsUrl: "https://developer.instantly.ai/guides/webhook-events",
    termsUrl: "https://instantly.ai/terms",
    apiVersion: "v2",
    lastVerified: "2026-08-20"
  },

  needs: {
    platform: [
      {
        key: "INSTANTLY_API_KEY",
        label: "Instantly API key",
        kind: "api_key",
        help: "The same key as the sending step. Used only for the daily check that Instantly is still answering.",
        required: true
      }
    ],
    architect: [],
    business: [],
    accounts: []
  },

  produces: [
    { key: "leadEmail", label: "Who replied", kind: "text", required: true, sample: "priya@brightsmiledental.com" },
    {
      key: "reply",
      label: "What they said",
      kind: "object",
      required: true,
      sample: {
        text: "Sounds interesting — can you send pricing?",
        campaignName: "Dental practices — California",
        interested: true
      }
    }
  ],

  // Receiving costs nothing. Whatever the agent does next has its own cost.
  cost: { style: "free", estimateCents: 0, unit: "per reply", billedTo: "platform" },

  failure: {
    onError: "stop",
    maxRetries: 0,
    backoffMs: 0,
    neverRetry: [400, 401, 403, 404, 422],
    humanMessage: "That reply could not be read, so your agent was not started for it."
  },

  limits: { callsPerMinute: 120, callsPerDay: 5_000, concurrent: 4 },

  rules: {
    notes: [
      "Consent belongs to the step that SENDS, not the one that listens. Someone replying to an email has plainly agreed to be replied to."
    ]
  },

  health: {
    everyHours: 24,
    expectKeys: ["campaigns"],
    severity: "degrades"
  },

  execution: "inbound",
  rollout: "canary",

  inbound: {
    instructions:
      "In Instantly, open Settings → Integrations → Webhooks and add a new webhook. Paste the address below as the URL, choose the event 'reply_received', and add a header called x-triven-secret with the secret shown next to it. That header is how we know a reply really came from your Instantly account.",
    events: ["reply_received", "lead_interested"],
    secretHeader: "x-triven-secret"
  },

  /**
   * The knock. Two questions only: is this really Instantly, and what does it
   * mean. The address, the rate limit, the duplicate filter, the paused-agent
   * check and the run all belong to the platform.
   */
  receive: (context: InboundContext): InboundResult => {
    const provided = context.headers["x-triven-secret"] ?? "";

    // Instantly does not sign its webhooks; it lets you attach a header of
    // your choosing. Weaker than a signature, so it is checked strictly: a
    // missing or wrong header is refused, never waved through.
    if (!context.secret || provided !== context.secret) {
      const error = new Error("Instantly webhook secret did not match") as Error & { status: number };
      error.status = 401;
      throw error;
    }

    const payload = (context.body ?? {}) as Record<string, unknown>;
    const eventType = String(payload.event_type ?? "");

    // Instantly sends far more than anyone asked for — every open, every send.
    // Acknowledging and ignoring is the correct answer, not a failure.
    if (eventType !== "reply_received" && eventType !== "lead_interested") {
      return { accepted: false, ignoredReason: eventType || "no event type", outputs: {} };
    }

    const leadEmail = String(payload.lead_email ?? "").trim();
    if (!leadEmail) {
      return { accepted: false, ignoredReason: "reply carried no address", outputs: {} };
    }

    context.log(`reply from ${leadEmail}`);

    return {
      accepted: true,
      // Instantly's own id for the event where it has one, so a retry cannot
      // make the agent answer the same prospect twice.
      eventId: String(payload.id ?? payload.event_id ?? `${leadEmail}:${payload.timestamp ?? ""}`),
      outputs: {
        leadEmail,
        reply: {
          text: replyTextOf(payload),
          subject: String(payload.email_subject ?? payload.subject ?? ""),
          campaignId: String(payload.campaign_id ?? ""),
          campaignName: String(payload.campaign_name ?? ""),
          interested: eventType === "lead_interested",
          receivedAt: String(payload.timestamp ?? "")
        }
      }
    };
  },

  /** Inbound work still has a heart: nothing to fetch, so it says so plainly. */
  heart: async (): Promise<HeartResult> => {
    throw new Error(
      "This step waits for Instantly to tell us about a reply. It is not something the agent can go and run."
    );
  },

  probe: async (context: ProbeContext): Promise<HeartResult> => {
    const answer = await call(context, "GET", "/campaigns?limit=1");
    return { outputs: { campaigns: answer.items ?? answer.data ?? [] } };
  }
};
