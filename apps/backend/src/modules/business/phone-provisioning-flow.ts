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
import {
  addPhoneNumberFeeToPendingInvoice,
  addPhoneNumberFeeToPendingInvoiceTx
} from "./phone-number-invoice";
import { getPhoneNumberFee } from "./phone-provisioning";

export type SafeAvailableNumber = {
  phoneNumber: string;
  friendlyName: string;
  country: string;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean; mms: boolean };
  numberType: "LOCAL";
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
  localityFilterSupported: boolean;
  alreadyAssigned?: BusinessPhoneAssignment | null;
  availableToAssign?: BusinessPhoneAssignment[];
};

export type BusinessPhoneAssignment = {
  assigned: true;
  phoneNumber: string;
  status: "ACTIVE";
  country: string | null;
  region: string | null;
  locality: string | null;
  capabilities: { voice: boolean; sms: boolean };
  assignedAt: string | null;
  installedAgentId: string | null;
};

const ASSIGNMENT_SELECT = {
  phoneNumber: true,
  country: true,
  region: true,
  locality: true,
  voiceEnabled: true,
  smsEnabled: true,
  assignedAt: true,
  installedAgentId: true
} as const;

type AssignmentRow = {
  phoneNumber: string;
  country: string | null;
  region: string | null;
  locality: string | null;
  voiceEnabled: boolean;
  smsEnabled: boolean;
  assignedAt: Date | null;
  installedAgentId: string | null;
};

function toAssignment(number: AssignmentRow): BusinessPhoneAssignment {
  return {
    assigned: true,
    phoneNumber: number.phoneNumber,
    status: "ACTIVE",
    country: number.country,
    region: number.region,
    locality: number.locality,
    capabilities: { voice: number.voiceEnabled, sms: number.smsEnabled },
    assignedAt: number.assignedAt?.toISOString() ?? null,
    installedAgentId: number.installedAgentId
  };
}

export async function listBusinessPhoneAssignments(
  businessId: string
): Promise<BusinessPhoneAssignment[]> {
  const numbers = await prisma.platformPhoneNumber.findMany({
    where: { businessId, status: "ASSIGNED", isPlatformSmsSender: false },
    orderBy: { assignedAt: "desc" },
    select: ASSIGNMENT_SELECT
  });
  return numbers.map(toAssignment);
}

export async function getAgentPhoneAssignment(
  businessId: string,
  installedAgentId: string
): Promise<BusinessPhoneAssignment | null> {
  const mapping = await prisma.businessPhoneNumber.findFirst({
    where: { businessId, installedAgentId, isActive: true },
    select: { phoneNumber: true }
  });
  if (!mapping) return null;

  const number = await prisma.platformPhoneNumber.findFirst({
    where: { phoneNumber: mapping.phoneNumber, isPlatformSmsSender: false },
    select: ASSIGNMENT_SELECT
  });
  return number ? toAssignment(number) : null;
}

/** Numbers the business owns that are not locked to any agent yet. */
export async function listUnassignedBusinessNumbers(
  businessId: string
): Promise<BusinessPhoneAssignment[]> {
  const owned = await listBusinessPhoneAssignments(businessId);
  if (owned.length === 0) return [];

  const locked = await prisma.businessPhoneNumber.findMany({
    where: {
      businessId,
      isActive: true,
      installedAgentId: { not: null },
      phoneNumber: { in: owned.map((number) => number.phoneNumber) }
    },
    select: { phoneNumber: true }
  });
  const lockedNumbers = new Set(locked.map((row) => row.phoneNumber));

  return owned.filter((number) => !lockedNumbers.has(number.phoneNumber));
}

const REGULATORY_NOTE_BY_COUNTRY: Record<string, string> = {
  GB: "UK local numbers can require a registered address before activation.",
  AU: "Australian numbers require identity verification under local regulations."
};

/** The buyer is offered one provider-selected number, never a list. */
const PHONE_SEARCH_RESULT_LIMIT = 1;

function toSafeNumber(item: AvailableNumberResult): SafeAvailableNumber {
  return {
    phoneNumber: item.phoneNumber,
    friendlyName: item.friendlyName,
    country: item.country,
    region: item.region,
    locality: item.locality,
    capabilities: item.capabilities,
    numberType: "LOCAL",
    regulatoryNote: REGULATORY_NOTE_BY_COUNTRY[item.country.toUpperCase()] ?? null,
    checkedAt: new Date().toISOString()
  };
}

function toSingleSafeNumberList(items: AvailableNumberResult[]): SafeAvailableNumber[] {
  // Keep the existing array response contract while enforcing the product rule
  // defensively even if a provider returns more rows than its requested limit.
  return items.slice(0, PHONE_SEARCH_RESULT_LIMIT).map((item) => toSafeNumber(item));
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
}): Promise<PhoneSearchOutcome> {
  if (params.installedAgentId) {
    const alreadyAssigned = await getAgentPhoneAssignment(params.businessId, params.installedAgentId);
    if (alreadyAssigned) {
      return {
        numbers: [],
        exactMatchAvailable: false,
        matchLevel: "NATIONAL",
        fallbackOptions: [],
        smsRequired: false,
        localityFilterSupported: true,
        alreadyAssigned
      };
    }
  }

  const availableToAssign = await listUnassignedBusinessNumbers(params.businessId);
  if (availableToAssign.length > 0) {
    return {
      numbers: [],
      exactMatchAvailable: false,
      matchLevel: "NATIONAL",
      fallbackOptions: [],
      smsRequired: false,
      localityFilterSupported: true,
      availableToAssign
    };
  }

  const location = validatePhoneLocation(params);
  if (!location.ok) {
    throw new PhoneNumberServiceError(location.message, 422, location.errorCode);
  }

  const smsRequired = await installedWorkflowNeedsSms(params.businessId, params.installedAgentId);

  const baseFilters = {
    country: location.country.code,
    voiceEnabled: true,
    ...(smsRequired ? { smsEnabled: true } : {}),
    limit: PHONE_SEARCH_RESULT_LIMIT
  };

  if (!location.localityFilter) {
    const national = await searchAvailableNumbers(baseFilters);

    return {
      numbers: toSingleSafeNumberList(national),
      exactMatchAvailable: national.length > 0,
      matchLevel: "NATIONAL",
      fallbackOptions: [],
      smsRequired,
      localityFilterSupported: false
    };
  }


  if (location.city && location.region) {
    const exact = await searchAvailableNumbers({
      ...baseFilters,
      inRegion: location.region.code,
      inLocality: location.city
    });

    if (exact.length > 0) {
      return {
        numbers: toSingleSafeNumberList(exact),
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
      numbers: toSingleSafeNumberList(regional),
      exactMatchAvailable: regional.length > 0,
      matchLevel: "SAME_STATE",
      fallbackOptions: regional.length > 0 ? [] : ["NATIONAL"],
      smsRequired,
      localityFilterSupported: true
    };
  }

  const national = await searchAvailableNumbers(baseFilters);

  return {
    numbers: toSingleSafeNumberList(national),
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
  forwardToPhone?: string | null;
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

  const assignmentLockKey = `business-number-assignment:${params.businessId}`;

  type PrecheckResult =
    | { kind: "existing"; outcome: PurchaseOutcome }
    | {
      kind: "created";
      request: NonNullable<Awaited<ReturnType<typeof prisma.phoneProvisioningRequest.findUnique>>>;
    };

  const precheck = await prisma.$transaction(async (tx): Promise<PrecheckResult> => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assignmentLockKey}))`;

    // Idempotency: same (businessId, clientRequestId) → same request, no new purchase.
    const existing = await tx.phoneProvisioningRequest.findUnique({
      where: { businessId_clientRequestId: { businessId: params.businessId, clientRequestId } }
    });
    if (existing) return { kind: "existing", outcome: outcomeFromRequest(existing, true) };
    if (params.installedAgentId && !params.replaceExisting) {
      const agentMapping = await tx.businessPhoneNumber.findFirst({
        where: {
          businessId: params.businessId,
          installedAgentId: params.installedAgentId,
          isActive: true
        },
        select: { phoneNumber: true }
      });
      if (agentMapping) {
        return {
          kind: "existing",
          outcome: {
            status: "ACTIVE",
            requestId: "",
            phoneNumber: agentMapping.phoneNumber,
            alreadyCompleted: true,
            errorCode: "PHONE_NUMBER_ALREADY_ASSIGNED",
            errorMessage: "This agent already has an active Triven AI number."
          }
        };
      }
    }
    if (!params.replaceExisting) {
      const freeNumber = await tx.platformPhoneNumber.findFirst({
        where: {
          businessId: params.businessId,
          status: "ASSIGNED",
          isPlatformSmsSender: false,
          installedAgentId: null
        },
        select: { phoneNumber: true }
      });
      if (freeNumber) {
        return {
          kind: "existing",
          outcome: {
            status: "ACTIVE",
            requestId: "",
            phoneNumber: freeNumber.phoneNumber,
            alreadyCompleted: true,
            errorCode: "UNASSIGNED_NUMBER_AVAILABLE",
            errorMessage:
              "You already have a Triven AI number that is not assigned to an agent. Assign it to this agent instead of buying another."
          }
        };
      }
    }

    // A different in-flight provisioning request must finish or fail before a
    // new one may start — never two concurrent purchases for one business.
    const inFlight = await tx.phoneProvisioningRequest.findFirst({
      where: {
        businessId: params.businessId,
        clientRequestId: { not: clientRequestId },
        status: {
          in: ["NUMBER_SELECTED", "PURCHASE_PENDING", "PURCHASED", "WEBHOOK_CONFIGURATION_PENDING", "VAPI_MAPPING_PENDING"]
        }
      },
      select: { id: true }
    });
    if (inFlight) {
      throw new PhoneNumberServiceError(
        "Another number assignment is already in progress for your business. Please wait a moment and refresh.",
        409,
        "PROVISIONING_IN_PROGRESS"
      );
    }

    const request = await tx.phoneProvisioningRequest.create({
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
    return { kind: "created", request };
  });

  if (precheck.kind === "existing") {
    if (
      params.installedAgentId &&
      precheck.outcome.status === "ACTIVE" &&
      precheck.outcome.phoneNumber
    ) {
      const assigned = await prisma.platformPhoneNumber.findFirst({
        where: {
          phoneNumber: precheck.outcome.phoneNumber,
          businessId: params.businessId,
          installedAgentId: params.installedAgentId,
          status: "ASSIGNED",
          isPlatformSmsSender: false
        },
        select: { id: true }
      });
      if (assigned) {
        await addPhoneNumberFeeToPendingInvoice({
          platformPhoneNumberId: assigned.id,
          businessId: params.businessId,
          installedAgentId: params.installedAgentId
        });
      }
    }
    return precheck.outcome;
  }
  const { request } = precheck;
  const phoneNumberFee = params.installedAgentId
    ? await getPhoneNumberFee()
    : null;

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
      error instanceof PhoneNumberServiceError ? error.message : "The number could not be purchased right now. Please try again shortly.";
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
    await prisma.$transaction(async (tx) => {
      // Same per-business lock as the precheck: re-verify no other assignment
      // won the race while the Twilio purchase ran outside the transaction.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${assignmentLockKey}))`;

      const activeNow = params.installedAgentId
        ? await tx.platformPhoneNumber.findFirst({
            where: {
              businessId: params.businessId,
              installedAgentId: params.installedAgentId,
              status: "ASSIGNED",
              isPlatformSmsSender: false,
              id: { not: platformNumber.id }
            },
            select: { id: true, phoneNumber: true, status: true }
          })
        : null;

      if (activeNow && !params.replaceExisting) {
        throw new PhoneNumberServiceError(
          "This agent already has an active Triven AI number.",
          409,
          "PHONE_NUMBER_ALREADY_ASSIGNED"
        );
      }
      if (params.replaceExisting && activeNow && activeNow.id !== platformNumber.id) {
        await unassignPlatformNumber(tx, { platform: activeNow });
      }
      await assignPlatformNumber(tx, {
        platform: platformNumber,
        businessId: params.businessId,
        installedAgentId: params.installedAgentId ?? null,
        buyerUserId: params.requestedByUserId,
        forwardToPhone
      });
      if (params.installedAgentId && phoneNumberFee) {
        await addPhoneNumberFeeToPendingInvoiceTx(
          tx,
          {
            platformPhoneNumberId: platformNumber.id,
            businessId: params.businessId,
            installedAgentId: params.installedAgentId,
            chargedAt: new Date()
          },
          phoneNumberFee
        );
      }
    });
  } catch (error) {
    if (error instanceof PhoneNumberServiceError && error.code === "PHONE_NUMBER_ALREADY_ASSIGNED") {
      // Purchased on Twilio but a concurrent assignment won: the number stays
      // unassigned in inventory (reconciliation recovers it); never assign two.
      return fail(error.code, error.message);
    }
    return fail(
      "ASSIGNMENT_FAILED",
      "The number was purchased but could not be attached to your business yet. It is reserved for you — retry shortly."
    );
  }

  await transitionRequest(request.id, "VAPI_MAPPING_PENDING", { note: "Checking voice assistant mapping." });

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
