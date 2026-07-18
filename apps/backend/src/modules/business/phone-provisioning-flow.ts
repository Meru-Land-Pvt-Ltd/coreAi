import type { PhoneProvisioningStatus, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { findPhoneCountry, validatePhoneLocation } from "../../lib/phone-locations";
import {
  PhoneNumberServiceError,
  purchaseNumber,
  searchAvailableNumbers,
  type AvailableNumberResult
} from "../admin/twilio-number-service";
import { workflowSupportsSmsReplies } from "../architect/twilio-business-routing";
import { assignPlatformNumber, unassignPlatformNumber } from "./phone-assignment";
import { getPhoneNumberFee } from "./phone-provisioning";

/**
 * Buyer-facing phone provisioning: location selection → inventory search →
 * explicit number selection → idempotent purchase driven by a persisted state
 * machine (PhoneProvisioningRequest). Replaces silent auto-assignment.
 */

export type SafeAvailableNumber = {
  phoneNumber: string;
  friendlyName: string;
  country: string;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  numberType: "LOCAL";
  /** One-time platform number fee (the "AI Receptionist No." line). */
  feeCents: number;
  feeLabel: string;
  /** Local-number activation can require address/identity verification. */
  regulatoryNote: string | null;
  checkedAt: string;
};

export type PhoneSearchOutcome = {
  numbers: SafeAvailableNumber[];
  exactMatchAvailable: boolean;
  /** Which location filter produced `numbers` (EXACT_CITY when city matched). */
  matchLevel: "EXACT_CITY" | "SAME_STATE" | "NATIONAL";
  fallbackOptions: Array<"NEARBY_CITY" | "SAME_STATE" | "NATIONAL" | "TOLL_FREE">;
  smsRequired: boolean;
  /** False when Twilio cannot filter this country by state/city — the search
   * ran country-wide and the UI says so honestly. */
  localityFilterSupported: boolean;
};

const REGULATORY_NOTE_BY_COUNTRY: Record<string, string> = {
  GB: "UK local numbers can require a registered address before activation.",
  AU: "Australian numbers require identity verification under local regulations."
};

function toSafeNumber(item: AvailableNumberResult, fee: { amountCents: number; label: string }): SafeAvailableNumber {
  return {
    phoneNumber: item.phoneNumber,
    friendlyName: item.friendlyName,
    country: item.country,
    region: item.region,
    locality: item.locality,
    capabilities: item.capabilities,
    numberType: "LOCAL",
    feeCents: fee.amountCents,
    feeLabel: fee.label,
    regulatoryNote: REGULATORY_NOTE_BY_COUNTRY[item.country.toUpperCase()] ?? null,
    checkedAt: new Date().toISOString()
  };
}

/** Whether the installed agent's workflow uses SMS (search then requires SMS capability). */
async function installedWorkflowNeedsSms(businessId: string, installedAgentId?: string | null): Promise<boolean> {
  const agent = await prisma.installedAgent.findFirst({
    where: installedAgentId ? { id: installedAgentId, businessId } : { businessId, status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: { workflow: { select: { workflowJson: true } } }
  });

  if (!agent?.workflow?.workflowJson) return false;
  try {
    return workflowSupportsSmsReplies(agent.workflow.workflowJson);
  } catch {
    return false;
  }
}

export async function searchNumbersForBusiness(params: {
  businessId: string;
  installedAgentId?: string | null;
  country: string;
  state?: string | null;
  city?: string | null;
  limit?: number;
}): Promise<PhoneSearchOutcome> {
  const location = validatePhoneLocation(params);
  if (!location.ok) {
    throw new PhoneNumberServiceError(location.message, 422, location.errorCode);
  }

  const smsRequired = await installedWorkflowNeedsSms(params.businessId, params.installedAgentId);
  const fee = await getPhoneNumberFee();
  const limit = Math.min(Math.max(Number(params.limit) || 10, 5), 10);

  const baseFilters = {
    country: location.country.code,
    voiceEnabled: true,
    ...(smsRequired ? { smsEnabled: true } : {}),
    limit
  };

  // Twilio only honors state/city filters for US/CA local numbers. Everywhere
  // else the search runs country-wide and says so — never a silent fallback.
  if (!location.localityFilter) {
    const national = await searchAvailableNumbers(baseFilters);

    return {
      numbers: national.map((item) => toSafeNumber(item, fee)),
      exactMatchAvailable: national.length > 0,
      matchLevel: "NATIONAL",
      fallbackOptions: [],
      smsRequired,
      localityFilterSupported: false
    };
  }

  // Exact city first, then widen: same state, then national. Never silently —
  // the match level and fallback options are always reported to the buyer.
  if (location.city && location.region) {
    const exact = await searchAvailableNumbers({
      ...baseFilters,
      inRegion: location.region.code,
      inLocality: location.city
    });

    if (exact.length > 0) {
      return {
        numbers: exact.map((item) => toSafeNumber(item, fee)),
        exactMatchAvailable: true,
        matchLevel: "EXACT_CITY",
        fallbackOptions: [],
        smsRequired,
        localityFilterSupported: true
      };
    }

    return {
      numbers: [],
      exactMatchAvailable: false,
      matchLevel: "EXACT_CITY",
      fallbackOptions: ["NEARBY_CITY", "SAME_STATE", "NATIONAL"],
      smsRequired,
      localityFilterSupported: true
    };
  }

  if (location.region) {
    const regional = await searchAvailableNumbers({ ...baseFilters, inRegion: location.region.code });

    return {
      numbers: regional.map((item) => toSafeNumber(item, fee)),
      exactMatchAvailable: regional.length > 0,
      matchLevel: "SAME_STATE",
      fallbackOptions: regional.length > 0 ? [] : ["NATIONAL"],
      smsRequired,
      localityFilterSupported: true
    };
  }

  const national = await searchAvailableNumbers(baseFilters);

  return {
    numbers: national.map((item) => toSafeNumber(item, fee)),
    exactMatchAvailable: national.length > 0,
    matchLevel: "NATIONAL",
    fallbackOptions: [],
    smsRequired,
    localityFilterSupported: true
  };
}

/* ------------------------------ state machine ----------------------------- */

type TransitionNote = { from: PhoneProvisioningStatus | null; to: PhoneProvisioningStatus; at: string; note?: string };

const ALLOWED_TRANSITIONS: Record<PhoneProvisioningStatus, PhoneProvisioningStatus[]> = {
  LOCATION_REQUIRED: ["SEARCHING", "FAILED"],
  SEARCHING: ["NUMBER_SELECTED", "FAILED"],
  NUMBER_SELECTED: ["PURCHASE_PENDING", "FAILED"],
  PURCHASE_PENDING: ["PURCHASED", "FAILED"],
  PURCHASED: ["WEBHOOK_CONFIGURATION_PENDING", "VAPI_MAPPING_PENDING", "ACTIVE", "FAILED"],
  WEBHOOK_CONFIGURATION_PENDING: ["VAPI_MAPPING_PENDING", "ACTIVE", "FAILED"],
  VAPI_MAPPING_PENDING: ["ACTIVE", "FAILED"],
  ACTIVE: ["RELEASE_PENDING"],
  FAILED: ["PURCHASE_PENDING", "RELEASE_PENDING"],
  RELEASE_PENDING: ["RELEASED", "FAILED"],
  RELEASED: []
};

async function transitionRequest(
  requestId: string,
  to: PhoneProvisioningStatus,
  extra?: { note?: string; data?: Prisma.PhoneProvisioningRequestUpdateInput }
): Promise<void> {
  const current = await prisma.phoneProvisioningRequest.findUnique({
    where: { id: requestId },
    select: { status: true, auditJson: true }
  });

  if (!current) throw new PhoneNumberServiceError("Provisioning request not found.", 404, "PROVISIONING_NOT_FOUND");

  if (current.status !== to && !ALLOWED_TRANSITIONS[current.status].includes(to)) {
    throw new PhoneNumberServiceError(
      `Invalid provisioning transition ${current.status} → ${to}.`,
      409,
      "INVALID_PROVISIONING_TRANSITION"
    );
  }

  const audit: TransitionNote[] = Array.isArray(current.auditJson) ? (current.auditJson as TransitionNote[]) : [];
  audit.push({ from: current.status, to, at: new Date().toISOString(), note: extra?.note });

  await prisma.phoneProvisioningRequest.update({
    where: { id: requestId },
    data: {
      ...(extra?.data ?? {}),
      status: to,
      auditJson: audit as unknown as Prisma.InputJsonValue
    }
  });
}

export type PurchaseOutcome = {
  status: PhoneProvisioningStatus;
  requestId: string;
  phoneNumber: string | null;
  alreadyCompleted: boolean;
  errorCode: string | null;
  errorMessage: string | null;
};

function outcomeFromRequest(request: {
  id: string;
  status: PhoneProvisioningStatus;
  selectedPhoneNumber: string;
  errorCode: string | null;
  errorDetail: string | null;
}, alreadyCompleted: boolean): PurchaseOutcome {
  return {
    status: request.status,
    requestId: request.id,
    phoneNumber: request.status === "ACTIVE" ? request.selectedPhoneNumber : null,
    alreadyCompleted,
    errorCode: request.errorCode,
    errorMessage: request.errorDetail
  };
}

/**
 * Idempotent purchase + assignment. A repeated clientRequestId returns the
 * existing request's result instead of buying another number; a business that
 * already holds an active number is never sold a second one.
 */
export async function purchaseNumberForBusiness(params: {
  businessId: string;
  requestedByUserId: string;
  installedAgentId?: string | null;
  clientRequestId: string;
  phoneNumber: string;
  country: string;
  state?: string | null;
  city?: string | null;
  fallbackType?: "NEARBY_CITY" | "SAME_STATE" | "NATIONAL" | "TOLL_FREE" | null;
  /** The buyer's own business line (already normalized) — forwarding target. */
  forwardToPhone?: string | null;
  /** Change-number flow: purchase and configure the new number FIRST, then
   * unassign the old one in the same transaction. Never releases early. */
  replaceExisting?: boolean;
}): Promise<PurchaseOutcome> {
  const location = validatePhoneLocation(params);
  if (!location.ok) {
    throw new PhoneNumberServiceError(location.message, 422, location.errorCode);
  }

  const clientRequestId = params.clientRequestId.trim();
  if (!clientRequestId || clientRequestId.length > 64) {
    throw new PhoneNumberServiceError("A clientRequestId (max 64 chars) is required.", 422, "CLIENT_REQUEST_ID_REQUIRED");
  }

  // Idempotency: same (businessId, clientRequestId) → same request, no new purchase.
  const existing = await prisma.phoneProvisioningRequest.findUnique({
    where: { businessId_clientRequestId: { businessId: params.businessId, clientRequestId } }
  });
  if (existing) return outcomeFromRequest(existing, true);

  // One active number per business: repeated provisioning returns the current
  // number instead of purchasing a second one. The explicit change-number flow
  // (replaceExisting) is the only path that may purchase a replacement.
  const currentNumber = await prisma.platformPhoneNumber.findFirst({
    where: { businessId: params.businessId, status: "ASSIGNED", isPlatformSmsSender: false },
    select: { id: true, phoneNumber: true, status: true }
  });
  if (currentNumber && !params.replaceExisting) {
    return {
      status: "ACTIVE",
      requestId: "",
      phoneNumber: currentNumber.phoneNumber,
      alreadyCompleted: true,
      errorCode: null,
      errorMessage: null
    };
  }

  let request;
  try {
    request = await prisma.phoneProvisioningRequest.create({
      data: {
        businessId: params.businessId,
        installedAgentId: params.installedAgentId ?? null,
        requestedByUserId: params.requestedByUserId,
        clientRequestId,
        status: "NUMBER_SELECTED",
        requestedCountry: location.country.code,
        requestedRegion: location.region?.code ?? null,
        requestedLocality: location.city,
        fallbackType: params.fallbackType ?? null,
        fallbackConfirmedAt: params.fallbackType ? new Date() : null,
        selectedPhoneNumber: params.phoneNumber.trim(),
        auditJson: [
          { from: null, to: "NUMBER_SELECTED", at: new Date().toISOString(), note: "Buyer confirmed number selection." }
        ] as unknown as Prisma.InputJsonValue
      }
    });
  } catch (error) {
    // Concurrent duplicate submit lost the unique-constraint race — return the winner.
    const winner = await prisma.phoneProvisioningRequest.findUnique({
      where: { businessId_clientRequestId: { businessId: params.businessId, clientRequestId } }
    });
    if (winner) return outcomeFromRequest(winner, true);
    throw error;
  }

  const fail = async (errorCode: string, errorMessage: string): Promise<PurchaseOutcome> => {
    await transitionRequest(request.id, "FAILED", {
      note: errorCode,
      data: { errorCode, errorDetail: errorMessage }
    });
    return {
      status: "FAILED",
      requestId: request.id,
      phoneNumber: null,
      alreadyCompleted: false,
      errorCode,
      errorMessage
    };
  };

  await transitionRequest(request.id, "PURCHASE_PENDING", { note: "Rechecking Twilio availability." });

  // Availability recheck: a number shown during search may be gone by purchase
  // time. The buyer must reselect rather than being silently given another one.
  const nationalDigits = params.phoneNumber.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  let recheck: AvailableNumberResult[];
  try {
    recheck = await searchAvailableNumbers({
      country: location.country.code,
      contains: nationalDigits,
      limit: 5
    });
  } catch (error) {
    return fail(
      "TWILIO_SEARCH_FAILED",
      error instanceof PhoneNumberServiceError ? error.message : "Could not verify number availability."
    );
  }

  const stillAvailable = recheck.find(
    (item) => item.phoneNumber.replace(/\D/g, "").endsWith(nationalDigits)
  );
  if (!stillAvailable) {
    return fail(
      "NUMBER_NO_LONGER_AVAILABLE",
      "The selected number is no longer available. Please search again and choose another number."
    );
  }

  // Purchase. Webhooks are configured in the same Twilio create call.
  let platformNumber;
  try {
    platformNumber = await purchaseNumber({
      phoneNumber: stillAvailable.phoneNumber,
      country: location.country.code
    });
  } catch (error) {
    const code = error instanceof PhoneNumberServiceError ? error.code : "TWILIO_PURCHASE_FAILED";
    const message =
      error instanceof PhoneNumberServiceError ? error.message : "Twilio could not complete the purchase.";
    // PURCHASE_SAVED_ON_TWILIO_ONLY: money was spent — reconciliation must
    // recover this number; never retry with another purchase.
    return fail(code ?? "TWILIO_PURCHASE_FAILED", message);
  }

  await transitionRequest(request.id, "PURCHASED", {
    note: `Purchased ${platformNumber.phoneNumber} (webhooks configured at purchase).`,
    data: {
      platformPhoneNumberId: platformNumber.id,
      actualCountry: platformNumber.country ?? stillAvailable.country,
      actualRegion: stillAvailable.region,
      actualLocality: stillAvailable.locality
    }
  });

  // Record the actual location on the inventory row for later audits.
  await prisma.platformPhoneNumber.update({
    where: { id: platformNumber.id },
    data: { region: stillAvailable.region, locality: stillAvailable.locality }
  });

  if (platformNumber.webhookStatus !== "CONFIGURED") {
    await transitionRequest(request.id, "WEBHOOK_CONFIGURATION_PENDING", {
      note: "Webhook configuration incomplete — retry via admin webhook repair."
    });
    return fail(
      "WEBHOOK_CONFIGURATION_FAILED",
      "The number was purchased but call routing is not configured yet. Support has been notified; the number is reserved for you."
    );
  }

  // Assignment (DB) — the number becomes this business's inbound line. The
  // forwarding phone comes from the request itself, an existing routing row,
  // or the phone remembered on the installed agent config.
  const existingRouting = await prisma.businessPhoneNumber.findFirst({
    where: { businessId: params.businessId },
    orderBy: { updatedAt: "desc" },
    select: { forwardToPhone: true }
  });
  let forwardToPhone = params.forwardToPhone?.trim() || existingRouting?.forwardToPhone || null;
  if (!forwardToPhone && params.installedAgentId) {
    const agentRow = await prisma.installedAgent.findUnique({
      where: { id: params.installedAgentId },
      select: { configJson: true }
    });
    const config =
      agentRow?.configJson && typeof agentRow.configJson === "object" && !Array.isArray(agentRow.configJson)
        ? (agentRow.configJson as Record<string, unknown>)
        : {};
    forwardToPhone = typeof config.verifiedForwardToPhone === "string" ? config.verifiedForwardToPhone : null;
  }

  try {
    // Change-number flow: the old number is unassigned in the SAME transaction
    // that assigns the new one — it stays fully active until this point, and if
    // the assignment fails the old number keeps working. The old number returns
    // to the AVAILABLE pool; it is never released on Twilio here.
    await prisma.$transaction(async (tx) => {
      if (params.replaceExisting && currentNumber && currentNumber.id !== platformNumber.id) {
        await unassignPlatformNumber(tx, { platform: currentNumber });
      }
      await assignPlatformNumber(tx, {
        platform: platformNumber,
        businessId: params.businessId,
        installedAgentId: params.installedAgentId ?? null,
        buyerUserId: params.requestedByUserId,
        forwardToPhone
      });
    });
  } catch (error) {
    // Twilio purchase succeeded, DB assignment failed: keep the provider
    // reference on the request for reconciliation; do not purchase again.
    return fail(
      "ASSIGNMENT_FAILED",
      "The number was purchased but could not be attached to your business yet. It is reserved for you — retry shortly."
    );
  }

  await transitionRequest(request.id, "VAPI_MAPPING_PENDING", { note: "Checking voice assistant mapping." });

  // Inbound voice resolves by the called number (To → BusinessPhoneNumber →
  // TwiML bridge), so no per-number Vapi phone id is required. If the
  // assistant isn't deployed yet it attaches during the deploy step.
  const profile = await prisma.businessProfile.findUnique({
    where: { businessId: params.businessId },
    select: { vapiAssistantId: true }
  });

  await transitionRequest(request.id, "ACTIVE", {
    note: profile?.vapiAssistantId
      ? "Vapi assistant already deployed; inbound mapping resolves by called number."
      : "Assistant not yet deployed; it will attach to this number at deploy."
  });

  const finalRequest = await prisma.phoneProvisioningRequest.findUnique({ where: { id: request.id } });
  return outcomeFromRequest(finalRequest ?? { ...request, status: "ACTIVE" }, false);
}

export async function getProvisioningRequestStatus(params: {
  businessId: string;
  clientRequestId: string;
}): Promise<PurchaseOutcome | null> {
  const request = await prisma.phoneProvisioningRequest.findUnique({
    where: {
      businessId_clientRequestId: {
        businessId: params.businessId,
        clientRequestId: params.clientRequestId
      }
    }
  });

  return request ? outcomeFromRequest(request, true) : null;
}

export { findPhoneCountry };
