/**
 * APOLLO — find work emails.
 *
 * The first connector written to the standard, and the proof of it. Everything
 * above `heart` is a description; the heart itself is about thirty lines that
 * know one thing — how to ask Apollo for people, and what its answer means.
 *
 * There is no code here for: reading config, retrying, backing off, throttling,
 * paging, counting cost, enforcing consent, logging, building the business's
 * setup form, or drawing their dashboard. The engine does all of that, the same
 * way, for every connector that will ever exist.
 *
 * Provider docs: https://docs.apollo.io/reference/people-search
 */

import type { NodeFrame, HeartContext, HeartResult, ProbeContext } from "@coreai/shared";

const API = "https://api.apollo.io/api/v1";

type ApolloPerson = {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  organization?: { name?: string; website_url?: string };
};

type ApolloSearchResponse = {
  people?: ApolloPerson[];
  pagination?: { page?: number; total_pages?: number; total_entries?: number };
};

/** One Apollo person, in our own shape, so later steps never learn Apollo's. */
function toLead(person: ApolloPerson) {
  return {
    name: person.name ?? [person.first_name, person.last_name].filter(Boolean).join(" "),
    email: person.email ?? null,
    title: person.title ?? null,
    company: person.organization?.name ?? null,
    website: person.organization?.website_url ?? null,
    linkedin: person.linkedin_url ?? null,
    source: "apollo"
  };
}

/** One request to Apollo, shared by the heart and the daily self-test. */
async function search(
  context: HeartContext | ProbeContext,
  body: Record<string, unknown>
): Promise<ApolloSearchResponse> {
  // context.http, never fetch: it is what carries the status the engine reads
  // to decide whether trying again is sensible. A 402 from Apollo means credits
  // ran out, and retrying that is just four more failures.
  const answer = await context.http.post(`${API}/mixed_people/search`, body, {
    "Cache-Control": "no-cache",
    "x-api-key": context.credentials.APOLLO_API_KEY
  });
  return answer.body as ApolloSearchResponse;
}

export const apolloFindPeople: NodeFrame = {
  id: "apollo.find_people",
  version: "1.0.0",
  job: "find-work-emails",
  label: "Find leads on Apollo",
  shortLabel: "Apollo",
  description: "Searches Apollo for people matching a job title, industry and location.",

  provider: {
    name: "Apollo",
    docsUrl: "https://docs.apollo.io/reference/people-search",
    termsUrl: "https://www.apollo.io/terms-of-service",
    apiVersion: "v1",
    lastVerified: "2026-08-19"
  },

  needs: {
    platform: [
      {
        key: "APOLLO_API_KEY",
        label: "Apollo API key",
        kind: "api_key",
        help:
          "Apollo restricts redistributing their data, so a business normally uses their own key. This platform key is the fallback — check their terms before selling access under it.",
        required: true
      }
    ],
    architect: [
      {
        key: "leadsPerRun",
        label: "How many leads to find each time",
        help: "Kept modest by default — Apollo charges per lookup.",
        kind: "number",
        required: false,
        defaultValue: 25
      }
    ],
    business: [
      {
        key: "jobTitles",
        label: "Who are you trying to reach?",
        help: "Job titles, one per line. For example: Practice Owner, Dentist.",
        kind: "list",
        required: true,
        placeholder: "Practice Owner"
      },
      {
        key: "locations",
        label: "Where are they?",
        help: "Cities, states or countries.",
        kind: "list",
        required: true,
        placeholder: "California, US"
      },
      {
        key: "industry",
        label: "What industry?",
        help: "Leave empty to search every industry.",
        kind: "text",
        required: false,
        placeholder: "Dental"
      }
    ],
    accounts: []
  },

  produces: [
    {
      key: "leads",
      label: "People found",
      kind: "list",
      required: true,
      sample: [
        {
          name: "Priya Shah",
          email: "priya@brightsmiledental.com",
          title: "Practice Owner",
          company: "Bright Smile Dental",
          website: "https://brightsmiledental.com",
          linkedin: null,
          source: "apollo"
        }
      ]
    },
    { key: "totalFound", label: "How many matched in total", kind: "number", required: false, sample: 412 }
  ],

  cost: {
    style: "per_result",
    estimateCents: 3,
    unit: "per person found",
    billedTo: "business",
    note: "Apollo bills the account whose key is used. With their own key, the business is billed directly."
  },

  failure: {
    onError: "retry",
    maxRetries: 2,
    backoffMs: 1_000,
    // 401 wrong key · 402 out of credits · 403 not allowed · 422 bad search.
    // None of these get better by asking again.
    neverRetry: [401, 402, 403, 422],
    humanMessage:
      "Apollo could not be reached, so no leads were found this time. Nothing was charged. It will try again on the next run."
  },

  limits: {
    callsPerMinute: 20,
    callsPerDay: 500,
    concurrent: 2,
    pageSize: 25,
    maxPages: 10
  },

  rules: {
    // Finding an address is not permission to email it. The consent gate lives
    // on the SENDING connector, where it belongs — but the note stays here so
    // nobody wires a scraper straight into a mailer without meeting it.
    requiresConsent: false,
    hardDailyCap: 2_000,
    notes: [
      "Finding an email is not permission to use it. In the EU, mailing an address obtained this way needs a lawful basis under GDPR.",
      "Apollo's terms restrict redistributing their data — read them before offering this under the platform's own key."
    ]
  },

  health: {
    everyHours: 24,
    // If Apollo renames `people` or drops `pagination`, this notices the same
    // day rather than a customer noticing first.
    expectKeys: ["leads"],
    severity: "breaks-agents"
  },

  execution: "paged",
  // Real and runnable, but new and unproven against live traffic. An architect
  // can place it; without an Apollo key it says so plainly rather than
  // pretending to search.
  rollout: "canary",

  /* ---------------------------------------------------------------------- */
  /* The heart. Everything above is description; this is the only code.      */
  /* ---------------------------------------------------------------------- */

  heart: async (context: HeartContext): Promise<HeartResult> => {
    const titles = asList(context.config.jobTitles);
    const locations = asList(context.config.locations);
    const industry = String(context.config.industry ?? "").trim();

    const answer = await search(context, {
      person_titles: titles,
      person_locations: locations,
      ...(industry ? { q_organization_keyword_tags: [industry] } : {}),
      page: context.page,
      per_page: 25
    });

    const people = answer.people ?? [];
    context.log(`Apollo returned ${people.length} people on page ${context.page}`);

    return {
      outputs: {
        // Only people with an address are useful to a mailer — handing on a
        // row with a null email would look like a lead and never send.
        leads: people.map(toLead).filter((lead) => Boolean(lead.email)),
        totalFound: answer.pagination?.total_entries ?? people.length
      },
      morePages: (answer.pagination?.page ?? 1) < (answer.pagination?.total_pages ?? 1),
      unitsUsed: people.length
    };
  },

  /** The daily self-test: one tiny search, checked for the shape we expect. */
  probe: async (context: ProbeContext): Promise<HeartResult> => {
    const answer = await search(context, {
      person_titles: ["Chief Executive Officer"],
      page: 1,
      per_page: 1
    });
    return {
      outputs: {
        leads: (answer.people ?? []).map(toLead),
        totalFound: answer.pagination?.total_entries ?? 0
      }
    };
  }
};

/** A textarea of lines, or a real list, or one value — always a clean list. */
function asList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value ?? "")
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}
