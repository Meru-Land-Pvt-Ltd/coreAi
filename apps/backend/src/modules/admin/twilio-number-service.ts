import { env, isProduction } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { twilioRestAuthHeader } from "../architect/twilio-connector";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/** Webhook paths every platform number points at (shared, multi-tenant). */
const VOICE_WEBHOOK_PATH = "/architect/connectors/twilio/voice";
const SMS_WEBHOOK_PATH = "/architect/connectors/twilio/inbound-sms";
const VOICE_FALLBACK_PATH = "/architect/connectors/twilio/voice-action";

export class PhoneNumberServiceError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "PHONE_SERVICE_ERROR") {
    super(message);
    this.name = "PhoneNumberServiceError";
    this.status = status;
    this.code = code;
  }
}

export function normalizeE164(raw: string): string {
  const cleaned = (raw ?? "").trim().replace(/[^+\d]/g, "");
  if (!cleaned) return "";
  const digits = cleaned.replace(/\+/g, "");
  if (digits.length < 7) return "";
  return `+${digits}`;
}

/* ----------------------------- A2P / compliance ---------------------------- */

/**
 * Canonical A2P 10DLC registration states. Twilio's IncomingPhoneNumbers API
 * (the only one this service currently calls) does NOT report campaign
 * registration, so numbers stay UNKNOWN/PENDING until the status is confirmed
 * in the Twilio Console (Messaging → Regulatory Compliance) or a Messaging
 * Compliance API sync is added. Statuses are never faked as REGISTERED.
 */
export const A2P_STATUS_VALUES = ["UNKNOWN", "UNREGISTERED", "PENDING", "REGISTERED", "FAILED"] as const;
export type A2pStatus = (typeof A2P_STATUS_VALUES)[number];

export function normalizeA2pStatus(raw: string | null | undefined): A2pStatus {
  const value = (raw ?? "").trim().toUpperCase();
  return (A2P_STATUS_VALUES as readonly string[]).includes(value) ? (value as A2pStatus) : "UNKNOWN";
}

/* ------------------------------- env guards ------------------------------- */

export type BackendUrlCheck = { ok: boolean; url: string; error?: string };

export function validateBackendUrl(): BackendUrlCheck {
  const url = (env.BACKEND_URL ?? "").trim().replace(/\/+$/, "");
  if (!url) {
    return { ok: false, url: "", error: "BACKEND_URL is not configured." };
  }

  const isLocal = /localhost|127\.0\.0\.1|0\.0\.0\.0|\.local\b/i.test(url);
  if (isProduction && isLocal) {
    return { ok: false, url, error: "BACKEND_URL points at localhost in production. Set the public backend URL before configuring Twilio webhooks." };
  }
  if (isProduction && !url.startsWith("https://")) {
    return { ok: false, url, error: "BACKEND_URL must use https in production before configuring Twilio webhooks." };
  }

  return { ok: true, url };
}

export type NumberWebhookUrls = {
  voiceUrl: string;
  voiceMethod: "POST";
  voiceFallbackUrl: string;
  smsUrl: string;
  smsMethod: "POST";
};

/** The exact URLs pushed to Twilio for every platform number. */
export function buildNumberWebhookUrls(): NumberWebhookUrls {
  const check = validateBackendUrl();
  if (!check.ok) {
    throw new PhoneNumberServiceError(check.error ?? "BACKEND_URL is not configured.", 500, "BACKEND_URL_INVALID");
  }
  return {
    voiceUrl: `${check.url}${VOICE_WEBHOOK_PATH}`,
    voiceMethod: "POST",
    voiceFallbackUrl: `${check.url}${VOICE_FALLBACK_PATH}`,
    smsUrl: `${check.url}${SMS_WEBHOOK_PATH}`,
    smsMethod: "POST"
  };
}

/* ------------------------------ error handling ---------------------------- */

/** Twilio error codes that mean "regulatory/address compliance required". */
const REGULATORY_ERROR_CODES = new Set([21615, 21631, 21649, 21650, 21651]);

type TwilioErrorShape = { status?: number; code?: number; message?: string };

class TwilioApiError extends Error {
  readonly status: number;
  readonly twilioCode: number | null;

  constructor(message: string, status: number, twilioCode: number | null) {
    super(message);
    this.name = "TwilioApiError";
    this.status = status;
    this.twilioCode = twilioCode;
  }
}

/**
 * Convert any Twilio/internal failure into a message safe to show an admin:
 * no credentials, no raw payloads, friendly wording for known cases.
 */
export function safeTwilioError(error: unknown, fallback: string): string {
  if (error instanceof PhoneNumberServiceError) return error.message;

  if (error instanceof TwilioApiError) {
    if (error.twilioCode !== null && REGULATORY_ERROR_CODES.has(error.twilioCode)) {
      return "This number requires additional Twilio regulatory/address compliance before purchase.";
    }
    if (error.status === 429) {
      return "Twilio rate limit reached. Wait a moment and try again.";
    }
    if (error.status === 401 || error.status === 403) {
      return "Twilio rejected the platform credentials. Check the backend Twilio configuration.";
    }
    const message = (error.message ?? "").slice(0, 300);
    // Twilio messages are human-readable, but they embed the account SID and
    // resource URLs in error text — redact both and refuse anything
    // credential-like.
    if (message && !/token|secret|authorization|basic /i.test(message)) {
      return message
        .replace(/\/2010-04-01\/Accounts\/\S+/g, "the Twilio resource")
        .replace(/AC[0-9a-fA-F]{32}/g, "AC…");
    }
  }

  return fallback;
}

/* ------------------------------- twilio REST ------------------------------ */

function requireTwilioConfig(): { accountSid: string; authHeader: string } {
  const accountSid = env.TWILIO_ACCOUNT_SID;
  const authHeader = twilioRestAuthHeader();
  if (!accountSid || !authHeader) {
    throw new PhoneNumberServiceError(
      "Twilio is not configured on the backend. Set TWILIO_ACCOUNT_SID plus TWILIO_API_KEY_SID/TWILIO_API_KEY_SECRET (or TWILIO_AUTH_TOKEN).",
      500,
      "TWILIO_NOT_CONFIGURED"
    );
  }
  return { accountSid, authHeader };
}

async function twilioApiRequest<T>(
  path: string,
  init?: { method?: "GET" | "POST" | "DELETE"; form?: Record<string, string> }
): Promise<T> {
  const { accountSid, authHeader } = requireTwilioConfig();
  const url = path.startsWith("https://")
    ? path
    : `${TWILIO_API_BASE}/Accounts/${accountSid}${path}`;

  const response = await fetch(url, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: authHeader,
      ...(init?.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {})
    },
    body: init?.form ? new URLSearchParams(init.form) : undefined
  });

  if (response.status === 204) return {} as T;

  const json = (await response.json().catch(() => ({}))) as TwilioErrorShape & T;

  if (!response.ok) {
    throw new TwilioApiError(
      typeof json.message === "string" ? json.message : `Twilio request failed (${response.status})`,
      response.status,
      typeof json.code === "number" ? json.code : null
    );
  }

  return json;
}

/* --------------------------------- search --------------------------------- */

type TwilioAvailableNumber = {
  phone_number?: string;
  friendly_name?: string;
  iso_country?: string;
  region?: string;
  locality?: string;
  capabilities?: { voice?: boolean; SMS?: boolean; sms?: boolean; MMS?: boolean; mms?: boolean };
};

export type AvailableNumberResult = {
  phoneNumber: string;
  friendlyName: string;
  country: string;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
};

export type SearchAvailableNumbersInput = {
  country?: string;
  areaCode?: string;
  contains?: string;
  /** Twilio InRegion filter (US state / CA province code). */
  inRegion?: string;
  /** Twilio InLocality filter (city name; US/CA local search). */
  inLocality?: string;
  voiceEnabled?: boolean;
  smsEnabled?: boolean;
  mmsEnabled?: boolean;
  limit?: number;
};

function capabilityFlags(caps: TwilioAvailableNumber["capabilities"]): AvailableNumberResult["capabilities"] {
  return {
    voice: caps?.voice === true,
    sms: caps?.SMS === true || caps?.sms === true,
    mms: caps?.MMS === true || caps?.mms === true
  };
}

export async function searchAvailableNumbers(input: SearchAvailableNumbersInput): Promise<AvailableNumberResult[]> {
  const country = (input.country ?? "US").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    throw new PhoneNumberServiceError("Country must be a 2-letter ISO code (e.g. US, IN, GB).", 422, "INVALID_COUNTRY");
  }

  const params = new URLSearchParams();
  const areaCode = (input.areaCode ?? "").replace(/\D/g, "");
  if (areaCode) {
    if (areaCode.length > 5) throw new PhoneNumberServiceError("Area code is too long.", 422, "INVALID_AREA_CODE");
    params.set("AreaCode", areaCode);
  }
  const contains = (input.contains ?? "").replace(/[^A-Za-z0-9*]/g, "");
  if (contains) params.set("Contains", contains.slice(0, 12));
  const inRegion = (input.inRegion ?? "").trim().toUpperCase();
  if (inRegion) {
    if (!/^[A-Z]{2}$/.test(inRegion)) {
      throw new PhoneNumberServiceError("Region must be a 2-letter state/province code.", 422, "INVALID_REGION");
    }
    params.set("InRegion", inRegion);
  }
  const inLocality = (input.inLocality ?? "").trim();
  if (inLocality) params.set("InLocality", inLocality.slice(0, 80));
  if (input.voiceEnabled) params.set("VoiceEnabled", "true");
  if (input.smsEnabled) params.set("SmsEnabled", "true");
  if (input.mmsEnabled) params.set("MmsEnabled", "true");
  const limit = Math.min(Math.max(Number(input.limit) || 10, 1), 30);
  params.set("PageSize", String(limit));

  try {
    const data = await twilioApiRequest<{ available_phone_numbers?: TwilioAvailableNumber[] }>(
      `/AvailablePhoneNumbers/${country}/Local.json?${params.toString()}`
    );
    return (data.available_phone_numbers ?? []).map((item) => ({
      phoneNumber: normalizeE164(item.phone_number ?? ""),
      friendlyName: item.friendly_name ?? item.phone_number ?? "",
      country: item.iso_country ?? country,
      region: item.region ?? null,
      locality: item.locality ?? null,
      capabilities: capabilityFlags(item.capabilities)
    })).filter((item) => item.phoneNumber);
  } catch (error) {
    console.error("[phone-service] searchAvailableNumbers failed", error);
    throw new PhoneNumberServiceError(
      safeTwilioError(error, "Could not search available numbers."),
      error instanceof TwilioApiError && error.status === 429 ? 429 : 502,
      "TWILIO_SEARCH_FAILED"
    );
  }
}

/* -------------------------------- purchase -------------------------------- */

type TwilioIncomingNumber = {
  sid?: string;
  phone_number?: string;
  friendly_name?: string;
  voice_url?: string;
  sms_url?: string;
  capabilities?: TwilioAvailableNumber["capabilities"];
  status?: string;
};

export type PurchaseNumberInput = {
  phoneNumber: string;
  country?: string;
  /** Absent for automatic (buyer purchase-time) provisioning. */
  adminUserId?: string | null;
  friendlyName?: string;
};

/**
 * Buy a number on Twilio and record it in PlatformPhoneNumber.
 *
 * Webhooks are set in the same Twilio create call, so a purchased number is
 * never live without routing. Duplicate protection is two-layered: an
 * up-front inventory check plus the phoneNumber/e164/twilioSid unique
 * constraints (a concurrent double-click loses the insert race and is told
 * the number already exists). If Twilio succeeds but the DB write fails,
 * we log critically and immediately best-effort sync so the number is never
 * stranded outside the inventory.
 */
export async function purchaseNumber(input: PurchaseNumberInput) {
  const e164 = normalizeE164(input.phoneNumber);
  if (!e164) {
    throw new PhoneNumberServiceError("A valid phone number is required.", 422, "INVALID_PHONE_NUMBER");
  }

  const webhooks = buildNumberWebhookUrls();

  const existing = await prisma.platformPhoneNumber.findFirst({
    where: { OR: [{ phoneNumber: e164 }, { e164 }] }
  });
  if (existing && existing.status !== "RELEASED") {
    throw new PhoneNumberServiceError(
      `${e164} is already in the platform inventory (status ${existing.status}).`,
      409,
      "NUMBER_ALREADY_EXISTS"
    );
  }

  let purchased: TwilioIncomingNumber;
  try {
    purchased = await twilioApiRequest<TwilioIncomingNumber>("/IncomingPhoneNumbers.json", {
      method: "POST",
      form: {
        PhoneNumber: e164,
        FriendlyName: (input.friendlyName ?? `Triven ${e164}`).slice(0, 64),
        VoiceUrl: webhooks.voiceUrl,
        VoiceMethod: webhooks.voiceMethod,
        VoiceFallbackUrl: webhooks.voiceFallbackUrl,
        VoiceFallbackMethod: "POST",
        SmsUrl: webhooks.smsUrl,
        SmsMethod: webhooks.smsMethod
      }
    });
  } catch (error) {
    console.error("[phone-service] Twilio purchase failed", { phoneNumber: e164, error });
    throw new PhoneNumberServiceError(
      safeTwilioError(error, "Twilio could not complete the purchase."),
      error instanceof TwilioApiError && error.status < 500 ? 422 : 502,
      "TWILIO_PURCHASE_FAILED"
    );
  }

  const caps = capabilityFlags(purchased.capabilities);
  const record = {
    e164,
    provider: "TWILIO" as const,
    status: "AVAILABLE" as const,
    twilioSid: purchased.sid ?? null,
    providerNumberId: purchased.sid ?? null,
    country: (input.country ?? "").trim().toUpperCase() || null,
    capabilities: caps,
    voiceEnabled: caps.voice,
    smsEnabled: caps.sms,
    mmsEnabled: caps.mms,
    voiceWebhookUrl: webhooks.voiceUrl,
    smsWebhookUrl: webhooks.smsUrl,
    webhookStatus: "CONFIGURED" as const,
    purchasedByAdminId: input.adminUserId ?? null,
    purchasedAt: new Date(),
    releasedAt: null,
    businessId: null,
    buyerUserId: null,
    installedAgentId: null,
    assignedAt: null,
    lastSyncedAt: new Date(),
    lastError: null
  };

  try {
    // upsert: reuses a RELEASED row for the same number instead of duplicating.
    return await prisma.platformPhoneNumber.upsert({
      where: { phoneNumber: e164 },
      update: record,
      create: { phoneNumber: e164, ...record }
    });
  } catch (error) {
    console.error(
      "[phone-service] CRITICAL: Twilio purchase succeeded but DB save failed — attempting sync recovery",
      { phoneNumber: e164, twilioSid: purchased.sid, error }
    );
    try {
      await syncTwilioNumbers({ dryRun: false });
    } catch (syncError) {
      console.error("[phone-service] CRITICAL: recovery sync also failed", { phoneNumber: e164, syncError });
    }
    throw new PhoneNumberServiceError(
      `The number was purchased on Twilio but saving it locally failed. Run "Sync Twilio numbers" to import it — it is not lost.`,
      500,
      "PURCHASE_SAVED_ON_TWILIO_ONLY"
    );
  }
}

/* --------------------------- webhook configuration ------------------------ */

/** Fingerprint (never the token) of the connected account, for diagnostics. */
function twilioAccountFingerprint(): string {
  return env.TWILIO_ACCOUNT_SID ? `${env.TWILIO_ACCOUNT_SID.slice(0, 6)}…` : "not configured";
}

/**
 * Look up an IncomingPhoneNumber on the CONNECTED account by E.164 — the
 * recovery path when a stored twilioSid is stale (number re-imported, seeded
 * from a CSV, or provisioned under a different subaccount).
 */
async function findTwilioNumberByE164(e164: string): Promise<TwilioIncomingNumber | null> {
  const data = await twilioApiRequest<{ incoming_phone_numbers?: TwilioIncomingNumber[] }>(
    `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(e164)}&PageSize=5`
  );
  return (data.incoming_phone_numbers ?? []).find((n) => normalizeE164(n.phone_number ?? "") === e164) ?? null;
}

/**
 * Persist a repaired SID, guarding the unique constraint (another row already
 * holding the SID wins; we log and leave this row's SID untouched).
 */
async function repairStoredSid(recordId: string, phoneNumber: string, correctSid: string): Promise<boolean> {
  const conflict = await prisma.platformPhoneNumber.findFirst({
    where: { twilioSid: correctSid, NOT: { id: recordId } },
    select: { id: true, phoneNumber: true }
  });
  if (conflict) {
    console.error("[phone-service] SID repair skipped — another row already holds this SID", {
      recordId,
      phoneNumber,
      conflictRow: conflict.phoneNumber
    });
    return false;
  }
  await prisma.platformPhoneNumber.update({
    where: { id: recordId },
    data: { twilioSid: correctSid, providerNumberId: correctSid }
  });
  console.log("[phone-service] repaired stale Twilio SID", { phoneNumber, account: twilioAccountFingerprint() });
  return true;
}

const NUMBER_NOT_IN_ACCOUNT_DB_ERROR =
  "Number was not found in the connected Twilio account. Run Sync from Twilio or check Twilio credentials/account.";
const NUMBER_NOT_IN_ACCOUNT_API_ERROR =
  "This number was not found in the connected Twilio account. It may belong to another Twilio account, may have been released, or the stored Twilio SID is stale.";

/**
 * Push the shared webhook URLs onto an existing Twilio number and record the
 * result. A stale/missing stored SID self-heals: on 404 (or no SID at all)
 * the number is looked up by E.164 on the connected account, the SID is
 * repaired, and configuration is retried once.
 */
export async function configureWebhooks(recordId: string) {
  const record = await prisma.platformPhoneNumber.findUnique({ where: { id: recordId } });
  if (!record) throw new PhoneNumberServiceError("Phone number not found.", 404, "NUMBER_NOT_FOUND");

  const webhooks = buildNumberWebhookUrls();

  const pushWebhooks = (sid: string) =>
    twilioApiRequest<TwilioIncomingNumber>(`/IncomingPhoneNumbers/${sid}.json`, {
      method: "POST",
      form: {
        VoiceUrl: webhooks.voiceUrl,
        VoiceMethod: webhooks.voiceMethod,
        VoiceFallbackUrl: webhooks.voiceFallbackUrl,
        VoiceFallbackMethod: "POST",
        SmsUrl: webhooks.smsUrl,
        SmsMethod: webhooks.smsMethod
      }
    });

  const markConfigured = (sid: string) =>
    prisma.platformPhoneNumber.update({
      where: { id: record.id },
      data: {
        twilioSid: sid,
        voiceWebhookUrl: webhooks.voiceUrl,
        smsWebhookUrl: webhooks.smsUrl,
        webhookStatus: "CONFIGURED",
        lastError: null,
        lastSyncedAt: new Date()
      }
    });

  // The number's phone number is stale-SID recovery's source of truth.
  const e164 = record.e164 ?? normalizeE164(record.phoneNumber);

  const recoverAndRetry = async () => {
    console.warn("[phone-service] stored SID stale or missing — recovering by E.164", {
      phoneNumber: record.phoneNumber,
      account: twilioAccountFingerprint()
    });
    const found = await findTwilioNumberByE164(e164);

    if (!found?.sid) {
      // Number genuinely absent from this account: record it, fail safely.
      await prisma.platformPhoneNumber
        .update({
          where: { id: record.id },
          data: {
            webhookStatus: "FAILED",
            lastError: NUMBER_NOT_IN_ACCOUNT_DB_ERROR,
            // ERROR only when it cannot disturb an assignment.
            ...(record.status === "AVAILABLE" ? { status: "ERROR" as const } : {})
          }
        })
        .catch(() => null);
      throw new PhoneNumberServiceError(NUMBER_NOT_IN_ACCOUNT_API_ERROR, 422, "NUMBER_NOT_IN_TWILIO_ACCOUNT");
    }

    await repairStoredSid(record.id, record.phoneNumber, found.sid);
    try {
      await pushWebhooks(found.sid);
    } catch (retryError) {
      console.error("[phone-service] webhook retry after SID repair failed", { recordId: record.id, retryError });
      const message = safeTwilioError(retryError, "Could not configure webhooks on Twilio.");
      await prisma.platformPhoneNumber
        .update({ where: { id: record.id }, data: { webhookStatus: "FAILED", lastError: message.slice(0, 500) } })
        .catch(() => null);
      throw new PhoneNumberServiceError(message, 502, "WEBHOOK_CONFIGURE_FAILED");
    }
    return markConfigured(found.sid);
  };

  try {
    if (!record.twilioSid) return await recoverAndRetry();
    await pushWebhooks(record.twilioSid);
    return await markConfigured(record.twilioSid);
  } catch (error) {
    if (error instanceof PhoneNumberServiceError) throw error;

    // Stale SID → one recovery attempt by E.164.
    if (error instanceof TwilioApiError && error.status === 404) {
      return recoverAndRetry();
    }

    console.error("[phone-service] configureWebhooks failed", { recordId, error });
    const message = safeTwilioError(error, "Could not configure webhooks on Twilio.");
    await prisma.platformPhoneNumber
      .update({ where: { id: record.id }, data: { webhookStatus: "FAILED", lastError: message.slice(0, 500) } })
      .catch(() => null);
    throw new PhoneNumberServiceError(message, 502, "WEBHOOK_CONFIGURE_FAILED");
  }
}

/* ---------------------------------- sync ---------------------------------- */

export type SyncResult = {
  dryRun: boolean;
  totalOnTwilio: number;
  created: string[];
  updated: string[];
  /** Numbers whose stored SID was stale and repaired from the Twilio listing. */
  repairedSids: string[];
  missingInTwilio: string[];
  unchanged: number;
};

/**
 * Reconcile the DB inventory with Twilio's IncomingPhoneNumbers list.
 * Metadata only for known rows — status/businessId/buyerUserId/
 * installedAgentId are NEVER overwritten by sync. Numbers on Twilio but not
 * in the DB are imported as AVAILABLE.
 */
export async function syncTwilioNumbers({ dryRun }: { dryRun: boolean }): Promise<SyncResult> {
  const webhookCheck = validateBackendUrl();
  const expectedVoiceUrl = webhookCheck.ok ? `${webhookCheck.url}${VOICE_WEBHOOK_PATH}` : null;
  const expectedSmsUrl = webhookCheck.ok ? `${webhookCheck.url}${SMS_WEBHOOK_PATH}` : null;
  // Only the configured shared Triven sender is flagged — never every
  // SMS-capable number.
  const sharedSmsSender = normalizeE164(env.TWILIO_SHARED_SMS_NUMBER ?? "");

  const twilioNumbers: TwilioIncomingNumber[] = [];
  let page = await twilioApiRequest<{ incoming_phone_numbers?: TwilioIncomingNumber[]; next_page_uri?: string | null }>(
    "/IncomingPhoneNumbers.json?PageSize=100"
  );
  twilioNumbers.push(...(page.incoming_phone_numbers ?? []));
  let guard = 0;
  while (page.next_page_uri && guard < 10) {
    guard += 1;
    page = await twilioApiRequest(`https://api.twilio.com${page.next_page_uri}`);
    twilioNumbers.push(...(page.incoming_phone_numbers ?? []));
  }

  const result: SyncResult = {
    dryRun,
    totalOnTwilio: twilioNumbers.length,
    created: [],
    updated: [],
    repairedSids: [],
    missingInTwilio: [],
    unchanged: 0
  };

  const seenSids = new Set<string>();

  for (const item of twilioNumbers) {
    const e164 = normalizeE164(item.phone_number ?? "");
    if (!e164 || !item.sid) continue;
    seenSids.add(item.sid);

    const caps = capabilityFlags(item.capabilities);
    // CONFIGURED requires BOTH webhooks to match — a voice-only match must not
    // read as fully configured.
    const voiceMatches = Boolean(item.voice_url && expectedVoiceUrl && item.voice_url === expectedVoiceUrl);
    const smsMatches = Boolean(item.sms_url && expectedSmsUrl && item.sms_url === expectedSmsUrl);
    const webhookStatus =
      voiceMatches && smsMatches
        ? ("CONFIGURED" as const)
        : item.voice_url || item.sms_url
          ? ("UNKNOWN" as const)
          : ("MISSING" as const);
    const isSharedSmsSender = Boolean(sharedSmsSender && e164 === sharedSmsSender);

    const existing = await prisma.platformPhoneNumber.findFirst({
      where: { OR: [{ twilioSid: item.sid }, { phoneNumber: e164 }, { e164 }] }
    });

    if (existing) {
      // Metadata refresh only — never touch assignment or lifecycle status.
      // The Twilio listing is the source of truth for the SID: a row matched
      // by phone number with a different stored SID is stale and repaired
      // (unless another row already holds the real SID — unique guard).
      const sidIsStale = existing.twilioSid !== item.sid;
      let adoptSid = item.sid;
      if (sidIsStale) {
        const conflict = await prisma.platformPhoneNumber.findFirst({
          where: { twilioSid: item.sid, NOT: { id: existing.id } },
          select: { id: true }
        });
        if (conflict) {
          console.error("[phone-service] sync SID repair skipped — SID held by another row", { phoneNumber: e164 });
          adoptSid = existing.twilioSid ?? item.sid;
        } else if (existing.twilioSid) {
          // Adopting a missing SID is a normal first sync; only a *changed*
          // non-null SID counts as a repair worth surfacing.
          result.repairedSids.push(e164);
        }
      }

      if (!dryRun) {
        await prisma.platformPhoneNumber.update({
          where: { id: existing.id },
          data: {
            twilioSid: adoptSid,
            providerNumberId: adoptSid,
            e164: existing.e164 ?? e164,
            capabilities: caps,
            voiceEnabled: caps.voice,
            smsEnabled: caps.sms,
            mmsEnabled: caps.mms,
            voiceWebhookUrl: item.voice_url ?? null,
            smsWebhookUrl: item.sms_url ?? null,
            webhookStatus,
            // Set (never cleared) only for the configured shared sender —
            // un-flagging a reserved number stays an explicit admin action.
            ...(isSharedSmsSender ? { isPlatformSmsSender: true } : {}),
            lastSyncedAt: new Date()
          }
        });
      }
      result.updated.push(e164);
    } else {
      if (!dryRun) {
        await prisma.platformPhoneNumber.create({
          data: {
            phoneNumber: e164,
            e164,
            provider: "TWILIO",
            status: "AVAILABLE",
            twilioSid: item.sid,
            providerNumberId: item.sid,
            capabilities: caps,
            voiceEnabled: caps.voice,
            smsEnabled: caps.sms,
            mmsEnabled: caps.mms,
            voiceWebhookUrl: item.voice_url ?? null,
            smsWebhookUrl: item.sms_url ?? null,
            webhookStatus,
            isPlatformSmsSender: isSharedSmsSender,
            lastSyncedAt: new Date()
          }
        });
      }
      result.created.push(e164);
    }
  }

  // DB rows that claim a Twilio SID Twilio no longer reports (released/moved).
  // RELEASED and ARCHIVED rows are intentionally out of service — not noise.
  const dbWithSid = await prisma.platformPhoneNumber.findMany({
    where: { twilioSid: { not: null }, status: { notIn: ["RELEASED", "ARCHIVED"] } },
    select: { phoneNumber: true, twilioSid: true }
  });
  for (const row of dbWithSid) {
    if (row.twilioSid && !seenSids.has(row.twilioSid)) {
      result.missingInTwilio.push(row.phoneNumber);
    }
  }

  return result;
}

/* --------------------------------- release -------------------------------- */

/**
 * Release an UNASSIGNED number back to Twilio. The DB row is kept forever
 * (status RELEASED) for history; assigned numbers are refused outright,
 * including a belt-and-braces check against active BusinessPhoneNumber rows.
 */
export async function releaseNumber({ id }: { id: string }) {
  const record = await prisma.platformPhoneNumber.findUnique({ where: { id } });
  if (!record) throw new PhoneNumberServiceError("Phone number not found.", 404, "NUMBER_NOT_FOUND");
  if (record.status === "RELEASED") {
    throw new PhoneNumberServiceError("This number is already released.", 409, "ALREADY_RELEASED");
  }
  if (record.status === "ASSIGNED" || record.businessId || record.installedAgentId) {
    throw new PhoneNumberServiceError(
      "This number is assigned. Unassign it before releasing.",
      409,
      "NUMBER_ASSIGNED"
    );
  }
  if (!record.twilioSid) {
    throw new PhoneNumberServiceError(
      "This number has no Twilio SID, so it cannot be released via Twilio. Archive it instead.",
      422,
      "MISSING_TWILIO_SID"
    );
  }

  const activeRuntimeRow = await prisma.businessPhoneNumber.findFirst({
    where: { phoneNumber: record.phoneNumber, isActive: true },
    select: { id: true, businessId: true }
  });
  if (activeRuntimeRow) {
    throw new PhoneNumberServiceError(
      "This number is still active on a business routing record. Unassign it before releasing.",
      409,
      "NUMBER_IN_RUNTIME_USE"
    );
  }

  try {
    await twilioApiRequest(`/IncomingPhoneNumbers/${record.twilioSid}.json`, { method: "DELETE" });
  } catch (error) {
    if (error instanceof TwilioApiError && error.status === 404) {
      // Stale SID? The number may still exist on this account under a
      // different SID — release the real resource, not just the DB row.
      console.warn("[phone-service] release got 404 — recovering by E.164", {
        phoneNumber: record.phoneNumber,
        account: twilioAccountFingerprint()
      });
      const found = await findTwilioNumberByE164(record.e164 ?? normalizeE164(record.phoneNumber));
      if (found?.sid) {
        await repairStoredSid(record.id, record.phoneNumber, found.sid);
        try {
          await twilioApiRequest(`/IncomingPhoneNumbers/${found.sid}.json`, { method: "DELETE" });
        } catch (retryError) {
          if (!(retryError instanceof TwilioApiError && retryError.status === 404)) {
            console.error("[phone-service] release retry after SID repair failed", { id, retryError });
            throw new PhoneNumberServiceError(
              safeTwilioError(retryError, "Twilio could not release this number."),
              502,
              "TWILIO_RELEASE_FAILED"
            );
          }
        }
      }
      // Not found by E.164 either: already gone on Twilio — mark released.
    } else {
      console.error("[phone-service] releaseNumber failed", { id, error });
      throw new PhoneNumberServiceError(
        safeTwilioError(error, "Twilio could not release this number."),
        502,
        "TWILIO_RELEASE_FAILED"
      );
    }
  }

  return prisma.platformPhoneNumber.update({
    where: { id: record.id },
    data: {
      status: "RELEASED",
      releasedAt: new Date(),
      businessId: null,
      buyerUserId: null,
      installedAgentId: null,
      assignedAt: null,
      webhookStatus: "UNKNOWN",
      lastError: null
    }
  });
}
