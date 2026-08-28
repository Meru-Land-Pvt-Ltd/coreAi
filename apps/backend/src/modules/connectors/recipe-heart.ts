/**
 * TURNING A DESCRIBED CONNECTOR INTO A RUNNING ONE.
 *
 * An architect filling in the Node Frame node cannot write code. They describe
 * one request — method, address, headers, body, where the answer lives — and
 * this builds the heart from that description. The result goes through exactly
 * the same engine, the same validation and the same honesty check as a
 * connector we wrote ourselves.
 *
 * Two guards live here, and neither is optional, because this file is the one
 * place where something a stranger typed becomes a request our server makes.
 *
 *  1. WHERE IT MAY REACH. Public https only. A URL pointing at localhost, a
 *     private network, or a cloud metadata address would turn the builder into
 *     a way to read our own infrastructure from the inside.
 *
 *  2. WHICH KEYS IT MAY READ. Only credentials the frame itself declared, and
 *     for an architect-built frame, never the platform's own. Otherwise
 *     {{credentials.OPENAI_API_KEY}} in a URL pointing at the architect's own
 *     server is a way to walk off with our keys.
 */

import {
  credentialsUsedByRecipe,
  fillPlaceholders,
  valueAtPath,
  type FrameRecipe,
  type Heart,
  type HeartContext,
  type HeartResult,
  type NodeFrameDeclaration,
  type ProbeContext
} from "@coreai/shared";

/* -------------------------------------------------------------------------- */
/* Guard 1 · where a described connector may reach                             */
/* -------------------------------------------------------------------------- */

/**
 * Addresses that must never be reachable from a described connector.
 *
 * 169.254.169.254 is the cloud metadata service — on most hosts it hands out
 * the machine's own credentials to anything that asks. The private ranges are
 * our database, our Redis and every other container on this box.
 */
const BLOCKED_HOST = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /\.internal$/i,
  /\.local$/i
];

/**
 * The same private addresses, written the OTHER ways a URL can spell them
 * (found by the platform audit, 2026-08-27). Node's URL parser normalises
 * "https://[::ffff:127.0.0.1]/" to hostname "[::ffff:7f00:1]", which none of
 * the patterns above match — so our own database was one clever spelling
 * away. A blocklist that only knows one spelling is not a blocklist.
 */
function looksPrivate(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  /* An IPv4 address hidden inside an IPv6 one, in either notation. */
  const mapped = /^::ffff:(?:([\da-f]{1,4}):([\da-f]{1,4})|(\d+\.\d+\.\d+\.\d+))$/i.exec(host);
  if (mapped) {
    const asV4 = mapped[3]
      ? mapped[3]
      : [
          parseInt(mapped[1]!, 16) >> 8,
          parseInt(mapped[1]!, 16) & 0xff,
          parseInt(mapped[2]!, 16) >> 8,
          parseInt(mapped[2]!, 16) & 0xff
        ].join(".");
    return BLOCKED_HOST.some((pattern) => pattern.test(asV4));
  }

  /* Every shortened spelling of loopback and the link-local range. */
  if (/^(0*:)*0*:?0*1$/.test(host)) return true;
  if (/^fe[89ab][\da-f]:/i.test(host)) return true;
  if (/^f[cd][\da-f]{2}:/i.test(host)) return true;

  /* Decimal, octal and hex spellings of an IPv4 address ("2130706433" and
     "0x7f000001" are both 127.0.0.1). */
  if (/^\d+$/.test(host)) {
    const n = Number(host);
    if (Number.isFinite(n) && n <= 0xffffffff) {
      const asV4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
      return BLOCKED_HOST.some((pattern) => pattern.test(asV4));
    }
  }
  if (/^0x[\da-f]+$/i.test(host)) {
    const n = parseInt(host, 16);
    if (Number.isFinite(n) && n <= 0xffffffff) {
      const asV4 = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
      return BLOCKED_HOST.some((pattern) => pattern.test(asV4));
    }
  }
  if (/^0\d/.test(host) && /^[0-7.]+$/.test(host)) return true;

  return false;
}

export function checkRecipeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That web address is not valid. It should start with https:// and be the full address from the service's documentation.";
  }

  if (parsed.protocol !== "https:") {
    return "The address must start with https:// — an unencrypted request would send the key in the clear.";
  }
  if (BLOCKED_HOST.some((pattern) => pattern.test(parsed.hostname)) || looksPrivate(parsed.hostname)) {
    return "That address points inside our own network rather than at a service on the internet, so it cannot be used.";
  }
  return null;
}

/* -------------------------------------------------------------------------- */

function fillDeep(
  value: unknown,
  values: Parameters<typeof fillPlaceholders>[1]
): unknown {
  if (typeof value === "string") return fillPlaceholders(value, values);
  if (Array.isArray(value)) return value.map((item) => fillDeep(item, values));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      out[key] = fillDeep(inner, values);
    }
    return out;
  }
  return value;
}

/** One request from a recipe, shared by the heart and the self-test. */

/**
 * The host an architect actually declared, with any placeholder left in it.
 *
 * `https://{{config.region}}.api.acme.com/v1` gives "acme.com": the parts a
 * setup answer may fill are allowed to vary, the company is not.
 */
function hostOf(rawUrl: string): string | null {
  const withoutPlaceholders = rawUrl.replace(/\{\{[^}]*\}\}/g, "x");
  try {
    return new URL(withoutPlaceholders).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Same registrable site: acme.com, api.acme.com and eu.api.acme.com agree. */
function sameSite(declared: string, actual: string): boolean {
  const tail = (host: string) => host.toLowerCase().split(".").slice(-2).join(".");
  const a = declared.toLowerCase();
  const b = actual.toLowerCase();
  if (a === b) return true;
  /* A placeholder standing in for a whole label ("x.api.acme.com") must not
     let the last two labels themselves be swapped. */
  return tail(a) === tail(b) && tail(a).includes(".");
}

async function runRecipe(
  recipe: FrameRecipe,
  context: { http: HeartContext["http"]; credentials: Record<string, string>; log: HeartContext["log"] },
  values: Parameters<typeof fillPlaceholders>[1]
): Promise<unknown> {
  const url = new URL(fillPlaceholders(recipe.url, values));

  for (const [key, raw] of Object.entries(recipe.query ?? {})) {
    const filled = fillPlaceholders(raw, values);
    // An empty parameter is usually worse than a missing one: several
    // providers read ?cursor= as "start from the beginning of nothing".
    if (filled !== "") url.searchParams.set(key, filled);
  }

  // Checked again here, not only when the frame was saved. A placeholder can
  // change the host at run time — {{config.region}} inside the address — and
  // the value comes from whatever a business typed into their setup form.
  const problem = checkRecipeUrl(url.toString());
  if (problem) {
    const error = new Error(problem) as Error & { status: number };
    error.status = 400;
    throw error;
  }

  /* AND IT MUST STILL BE THE SAME COMPANY.
     The check above refuses addresses inside our own network. It does not
     refuse evil.com — nothing did. A placeholder inside the address means a
     business's own setup answer could point the request anywhere on the
     internet, and the architect's API key travels in the headers a few lines
     below. That is somebody else's key, sent to a stranger's server, by a
     value a third party typed into a form.

     So the host is pinned to the one the architect declared. Filling in a
     region or an account id is fine; changing whose server this is is not. */
  const declaredHost = hostOf(recipe.url);
  if (declaredHost && !sameSite(declaredHost, url.hostname)) {
    const error = new Error(
      `This step is set up to talk to ${declaredHost}, and something changed the address to ${url.hostname}. It was not sent.`
    ) as Error & { status: number };
    error.status = 400;
    throw error;
  }

  const headers: Record<string, string> = {};
  for (const [key, raw] of Object.entries(recipe.headers ?? {})) {
    headers[key] = fillPlaceholders(raw, values);
  }

  const answer = await context.http({
    url: url.toString(),
    method: recipe.method,
    headers,
    ...(recipe.method === "GET" || recipe.body === undefined
      ? {}
      : { body: fillDeep(recipe.body, values) })
  });

  return answer.body;
}

/* -------------------------------------------------------------------------- */
/* Guard 2 · which keys a described connector may read                         */
/* -------------------------------------------------------------------------- */

/**
 * Refuse a recipe that reaches for a credential the frame never declared.
 *
 * The engine resolves credentials from `needs.platform`. A frame that declares
 * nothing but writes {{credentials.TWILIO_AUTH_TOKEN}} into its address would,
 * without this, receive whatever the engine happened to have. Checking the
 * recipe against the declaration closes that at the point the frame is saved,
 * before it can ever run.
 */
export function credentialProblems(declaration: NodeFrameDeclaration): string[] {
  const declared = new Set(declaration.needs.platform.map((need) => need.key));
  const problems: string[] = [];

  const used = new Set([
    ...credentialsUsedByRecipe(declaration.recipe),
    ...(declaration.probeRecipe ? credentialsUsedByRecipe(declaration.probeRecipe) : [])
  ]);

  for (const key of used) {
    if (!declared.has(key)) {
      problems.push(
        `This uses a key called "${key}" that it never asks for. Add it to the keys this connection needs, or remove it from the request.`
      );
    }
  }
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Building the heart                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The heart of a described connector.
 *
 * Note what it does NOT do: no retrying, no backoff, no throttling, no cost
 * counting, no rehearsal branch, no logging of its own. Exactly like a
 * hand-written heart, because it goes through exactly the same engine.
 */
export function heartFromRecipe(declaration: NodeFrameDeclaration): Heart {
  return async (context: HeartContext): Promise<HeartResult> => {
    const recipe = declaration.recipe;
    const body = await runRecipe(recipe, context, {
      config: context.config,
      credentials: context.credentials,
      page: context.page,
      pageSize: context.pageSize,
      cursor: context.cursor
    });

    /* "." (or blank) means THE WHOLE ANSWER — the drafter's way of saying
       "everything this service returns is the result". Splitting "." into
       path pieces found nothing, so a working call was refused as dishonest
       (caught by the first live Open-Meteo proof, 2026-08-26). */
    const path = (recipe.resultsAt ?? "").trim();
    const found = path === "" || path === "." ? body : valueAtPath(body, path);

    // Named exactly as the frame declared it produces, so a later step reads it
    // by name and never learns this provider's shape.
    const outputs: Record<string, unknown> = {};
    const first = declaration.produces[0];
    if (first) outputs[first.key] = found ?? (first.kind === "list" ? [] : null);
    /* OUR NAME IS NOT THE PROVIDER'S PATH. Every output after the first was
       looked up by the name WE gave it — "skipped", "totalFound" — as though
       the service answered in our words. It never does, so a described card's
       second output came back undefined every single run and nothing
       reported it. A path is declared, or the value is honestly absent. */
    for (const output of declaration.produces.slice(1)) {
      const path = (output.at ?? "").trim();
      outputs[output.key] = path
        ? valueAtPath(body, path)
        : output.kind === "list"
          ? []
          : null;
    }

    const paging = recipe.paging;
    const morePages =
      paging?.style === "cursor"
        ? Boolean(valueAtPath(body, paging.morePagesAt) ?? valueAtPath(body, paging.cursorAt))
        : paging?.style === "page"
          ? Boolean(valueAtPath(body, paging.morePagesAt))
          : false;

    context.log(`${declaration.provider.name} answered`, {
      found: Array.isArray(found) ? found.length : found === undefined ? 0 : 1
    });

    return {
      outputs,
      morePages,
      ...(paging?.style === "cursor" && paging.cursorAt
        ? { cursor: String(valueAtPath(body, paging.cursorAt) ?? "") || undefined }
        : {}),
      unitsUsed: Array.isArray(found) ? found.length : 1
    };
  };
}

/** The daily self-test of a described connector — or an honest refusal. */
export function probeFromDeclaration(declaration: NodeFrameDeclaration) {
  return async (context: ProbeContext) => {
    if (!declaration.probeRecipe) {
      return {
        cannotSelfTest:
          declaration.cannotSelfTest ??
          `${declaration.provider.name} has no request that works without a customer's own details.`
      };
    }

    const body = await runRecipe(declaration.probeRecipe, context, {
      config: {},
      credentials: context.credentials,
      page: 1,
      pageSize: 1
    });

    const outputs: Record<string, unknown> = {};
    for (const key of declaration.health.expectKeys) {
      outputs[key] = valueAtPath(body, declaration.probeRecipe.resultsAt) ?? [];
    }
    return { outputs };
  };
}
