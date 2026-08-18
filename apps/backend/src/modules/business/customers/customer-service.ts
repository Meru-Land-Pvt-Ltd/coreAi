import type { Prisma } from "@prisma/client";
import { prisma } from "../../../lib/prisma";
import { normalizePhoneE164 } from "../../architect/twilio-connector";
import { logBusinessActivity } from "../activity-log";

/**
 * Canonical Customer domain (plan Part 7).
 *
 * One Customer row per real person per business, resolved through
 * CustomerIdentity rows keyed by (businessId, kind, value):
 *
 * - STRONG identities (PHONE / WHATSAPP / TELEGRAM / personal EMAIL) auto-link:
 *   the same normalized value always resolves to the same customer.
 * - WEAK identities (NAME always; generic shared-inbox emails like info@ or
 *   office@) NEVER auto-link. They get their own customer, and when the same
 *   value is already held by another customer we record a CustomerMergeSuggestion
 *   for a human to confirm — two different people writing from info@acme.com
 *   must never be silently fused into one profile.
 *
 * Merges are reversible: CustomerMergeEvent.movedRefsJson records exactly which
 * rows moved so splitCustomers() can put them back without clobbering data that
 * arrived after the merge.
 */

export type CustomerIdentityKind = "PHONE" | "EMAIL" | "WHATSAPP" | "TELEGRAM" | "NAME";
export type CustomerIdentityConfidence = "STRONG" | "WEAK";

export class CustomerServiceError extends Error {
  constructor(
    public code: string,
    message: string,
    public httpStatus = 400
  ) {
    super(message);
    this.name = "CustomerServiceError";
  }
}

/** Shared/generic inbox local-parts are WEAK evidence — many people share them. */
const GENERIC_EMAIL_PREFIXES = ["info", "office", "contact", "sales", "admin", "hello"];

export function isGenericInboxEmail(email: string): boolean {
  const atIndex = email.indexOf("@");
  if (atIndex <= 0) return false;
  const local = email.slice(0, atIndex).toLowerCase();
  const base = local.split("+")[0];
  return GENERIC_EMAIL_PREFIXES.includes(base);
}

/** Normalize an identity value for its kind. Empty string means "unusable". */
export function normalizeIdentityValue(kind: CustomerIdentityKind, raw: string): string {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return "";
  switch (kind) {
    case "PHONE":
    case "WHATSAPP":
      return normalizePhoneE164(trimmed);
    case "EMAIL": {
      const email = trimmed.toLowerCase();
      return email.includes("@") && !/\s/.test(email) ? email : "";
    }
    case "TELEGRAM":
      // Provider chat/user id — opaque, kept verbatim.
      return trimmed;
    case "NAME":
      return trimmed.replace(/\s+/g, " ").toLowerCase();
    default:
      return "";
  }
}

function identityConfidence(kind: CustomerIdentityKind, normalizedValue: string): CustomerIdentityConfidence {
  if (kind === "NAME") return "WEAK";
  if (kind === "EMAIL" && isGenericInboxEmail(normalizedValue)) return "WEAK";
  return "STRONG";
}

/** Duck-typed so mocked errors in tests behave like Prisma's P2002. */
function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2002";
}

// ---------------------------------------------------------------------------
// ensureCustomerByIdentity
// ---------------------------------------------------------------------------

export type EnsureCustomerInput = {
  businessId: string;
  kind: CustomerIdentityKind;
  value: string;
  displayName?: string | null;
  source?: string | null;
};

export type EnsureCustomerResult =
  | { outcome: "LINKED"; customerId: string; created: boolean }
  | {
      outcome: "SUGGESTED";
      /** The NEW customer created for this weak identity (never the existing one). */
      customerId: string;
      existingCustomerId: string;
      suggestionId: string | null;
    }
  | { outcome: "SKIPPED"; reason: string };

type IdentityHit = {
  customer: { id: string; status: string; mergedIntoId: string | null };
};

/** Follow a MERGED alias to its surviving customer. */
function resolveSurvivor(hit: IdentityHit): string {
  return hit.customer.status === "MERGED" && hit.customer.mergedIntoId
    ? hit.customer.mergedIntoId
    : hit.customer.id;
}

/**
 * Resolve (or create) the canonical customer for one observed identity.
 * Race-safe: concurrent first-contact events for the same identity collapse to
 * one customer via the (businessId, kind, value) unique + P2002 re-read.
 */
export async function ensureCustomerByIdentity(input: EnsureCustomerInput): Promise<EnsureCustomerResult> {
  const value = normalizeIdentityValue(input.kind, input.value);
  if (!value) return { outcome: "SKIPPED", reason: `unusable ${input.kind} value` };

  const confidence = identityConfidence(input.kind, value);
  const displayName =
    input.displayName?.trim() || (input.kind === "NAME" ? input.value.trim().replace(/\s+/g, " ") : null);

  const existing = await prisma.customerIdentity.findUnique({
    where: { businessId_kind_value: { businessId: input.businessId, kind: input.kind, value } },
    include: { customer: { select: { id: true, status: true, mergedIntoId: true } } }
  });

  if (existing) {
    const survivorId = resolveSurvivor(existing);
    if (confidence === "STRONG") {
      await prisma.customer.update({ where: { id: survivorId }, data: { lastSeenAt: new Date() } });
      if (displayName) {
        // Backfill a name only when the profile has none — never overwrite.
        await prisma.customer.updateMany({
          where: { id: survivorId, displayName: null },
          data: { displayName }
        });
      }
      return { outcome: "LINKED", customerId: survivorId, created: false };
    }
    // WEAK evidence against an existing holder: never auto-link — new customer + suggestion.
    return createDetachedCustomerWithSuggestion({ input, value, displayName, existingCustomerId: survivorId });
  }

  try {
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          businessId: input.businessId,
          displayName,
          primaryPhone: input.kind === "PHONE" || input.kind === "WHATSAPP" ? value : null,
          primaryEmail: input.kind === "EMAIL" ? value : null,
          lastSeenAt: new Date()
        }
      });
      await tx.customerIdentity.create({
        data: {
          businessId: input.businessId,
          customerId: created.id,
          kind: input.kind,
          value,
          confidence,
          source: input.source ?? null
        }
      });
      return created;
    });
    return { outcome: "LINKED", customerId: customer.id, created: true };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // Lost the creation race — another request just claimed this identity.
    const winner = await prisma.customerIdentity.findUnique({
      where: { businessId_kind_value: { businessId: input.businessId, kind: input.kind, value } },
      include: { customer: { select: { id: true, status: true, mergedIntoId: true } } }
    });
    if (!winner) throw error;
    const survivorId = resolveSurvivor(winner);
    if (confidence === "STRONG") {
      await prisma.customer.update({ where: { id: survivorId }, data: { lastSeenAt: new Date() } });
      return { outcome: "LINKED", customerId: survivorId, created: false };
    }
    return createDetachedCustomerWithSuggestion({ input, value, displayName, existingCustomerId: survivorId });
  }
}

/**
 * Weak-identity path when the value is already owned by another customer: the
 * new contact gets its OWN customer row (no identity row — the unique index
 * holds the value on the existing customer) plus a merge suggestion so a human
 * can decide whether they are the same person.
 */
async function createDetachedCustomerWithSuggestion(args: {
  input: EnsureCustomerInput;
  value: string;
  displayName: string | null;
  existingCustomerId: string;
}): Promise<EnsureCustomerResult> {
  const { input, value, displayName, existingCustomerId } = args;
  const created = await prisma.customer.create({
    data: {
      businessId: input.businessId,
      displayName,
      primaryPhone: input.kind === "PHONE" || input.kind === "WHATSAPP" ? value : null,
      primaryEmail: input.kind === "EMAIL" ? value : null,
      lastSeenAt: new Date()
    }
  });
  const suggestion = await suggestWeakMatch(
    input.businessId,
    created.id,
    existingCustomerId,
    input.kind === "NAME" ? `Same name "${value}"` : `Shared inbox email ${value}`,
    0.5
  );
  return {
    outcome: "SUGGESTED",
    customerId: created.id,
    existingCustomerId,
    suggestionId: suggestion?.id ?? null
  };
}

// ---------------------------------------------------------------------------
// Merge suggestions
// ---------------------------------------------------------------------------

/**
 * Upsert a PENDING merge suggestion for a customer pair. Pairs are stored in
 * canonical (sorted) order so (A,B) and (B,A) collapse onto the unique index.
 * A pair a human already resolved (MERGED / DISMISSED) is never resurfaced.
 */
export async function suggestWeakMatch(
  businessId: string,
  customerAId: string,
  customerBId: string,
  reason: string,
  score?: number | null
): Promise<{ id: string; status: string } | null> {
  if (!customerAId || !customerBId || customerAId === customerBId) return null;
  const [a, b] = customerAId < customerBId ? [customerAId, customerBId] : [customerBId, customerAId];

  const pairWhere = { businessId_customerAId_customerBId: { businessId, customerAId: a, customerBId: b } };
  const existing = await prisma.customerMergeSuggestion.findUnique({ where: pairWhere });
  if (existing) return existing.status === "PENDING" ? existing : null;

  try {
    return await prisma.customerMergeSuggestion.create({
      data: { businessId, customerAId: a, customerBId: b, reason, score: score ?? null }
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.customerMergeSuggestion.findUnique({ where: pairWhere });
    return raced && raced.status === "PENDING" ? raced : null;
  }
}

export async function listMergeSuggestions(businessId: string) {
  const suggestions = await prisma.customerMergeSuggestion.findMany({
    where: { businessId, status: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 100
  });
  const customerIds = [...new Set(suggestions.flatMap((s) => [s.customerAId, s.customerBId]))];
  const customers = customerIds.length
    ? await prisma.customer.findMany({
        where: { businessId, id: { in: customerIds } },
        select: { id: true, displayName: true, primaryPhone: true, primaryEmail: true, status: true }
      })
    : [];
  const byId = new Map(customers.map((c) => [c.id, c]));
  return suggestions.map((s) => ({
    id: s.id,
    reason: s.reason,
    score: s.score,
    status: s.status,
    createdAt: s.createdAt,
    customerA: byId.get(s.customerAId) ?? { id: s.customerAId },
    customerB: byId.get(s.customerBId) ?? { id: s.customerBId }
  }));
}

export async function dismissMergeSuggestion(args: {
  businessId: string;
  suggestionId: string;
  actorUserId?: string | null;
}) {
  const suggestion = await prisma.customerMergeSuggestion.findFirst({
    where: { id: args.suggestionId, businessId: args.businessId }
  });
  if (!suggestion) throw new CustomerServiceError("SUGGESTION_NOT_FOUND", "Merge suggestion not found", 404);
  if (suggestion.status !== "PENDING") {
    throw new CustomerServiceError("SUGGESTION_ALREADY_RESOLVED", "This suggestion was already resolved", 409);
  }
  return prisma.customerMergeSuggestion.update({
    where: { id: suggestion.id },
    data: { status: "DISMISSED", resolvedByUserId: args.actorUserId ?? null, resolvedAt: new Date() }
  });
}

// ---------------------------------------------------------------------------
// Merge / split
// ---------------------------------------------------------------------------

const LINKABLE_TABLES = [
  "conversations",
  "vapiCalls",
  "appointments",
  "leads",
  "handoffEvents",
  "emailMessages"
] as const;
type LinkableTable = (typeof LINKABLE_TABLES)[number];

export type MovedRefs = Record<LinkableTable, string[]> & {
  identities: string[];
  deletedDuplicateIdentities: Array<{ kind: string; value: string; confidence: string; source: string | null }>;
};

/** Narrow delegate view — only what merge/split need (findMany ids, updateMany). */
type LinkableDelegate = {
  findMany(args: { where: Record<string, unknown>; select: { id: true } }): Promise<Array<{ id: string }>>;
  updateMany(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<{ count: number }>;
};

function linkableDelegates(tx: Prisma.TransactionClient): Record<LinkableTable, LinkableDelegate> {
  return {
    conversations: tx.conversation as unknown as LinkableDelegate,
    vapiCalls: tx.vapiCall as unknown as LinkableDelegate,
    appointments: tx.appointment as unknown as LinkableDelegate,
    leads: tx.lead as unknown as LinkableDelegate,
    handoffEvents: tx.handoffEvent as unknown as LinkableDelegate,
    emailMessages: tx.emailMessage as unknown as LinkableDelegate
  };
}

function parseMovedRefs(raw: unknown): MovedRefs {
  const record = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  return {
    conversations: ids(record.conversations),
    vapiCalls: ids(record.vapiCalls),
    appointments: ids(record.appointments),
    leads: ids(record.leads),
    handoffEvents: ids(record.handoffEvents),
    emailMessages: ids(record.emailMessages),
    identities: ids(record.identities),
    deletedDuplicateIdentities: Array.isArray(record.deletedDuplicateIdentities)
      ? (record.deletedDuplicateIdentities as MovedRefs["deletedDuplicateIdentities"])
      : []
  };
}

/**
 * Merge two customers of the SAME business. Everything the merged customer
 * owned (identities + linked operational rows) moves to the survivor; the
 * merged row is kept as a MERGED alias so the operation is reversible.
 */
export async function mergeCustomers(args: {
  businessId: string;
  survivingId: string;
  mergedId: string;
  actorUserId?: string | null;
}): Promise<{ mergeEventId: string; movedRefs: MovedRefs }> {
  const { businessId, survivingId, mergedId, actorUserId } = args;
  if (survivingId === mergedId) {
    throw new CustomerServiceError("MERGE_SELF", "A customer cannot be merged into itself", 422);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Tenant guard: BOTH customers must belong to this business — a foreign id
    // must fail loudly, never move another tenant's rows.
    const surviving = await tx.customer.findFirst({ where: { id: survivingId, businessId } });
    if (!surviving) {
      throw new CustomerServiceError("CUSTOMER_NOT_FOUND", "Surviving customer not found in this business", 404);
    }
    const merged = await tx.customer.findFirst({ where: { id: mergedId, businessId } });
    if (!merged) {
      throw new CustomerServiceError("CUSTOMER_NOT_FOUND", "Customer to merge not found in this business", 404);
    }
    if (surviving.status === "MERGED" || merged.status === "MERGED") {
      throw new CustomerServiceError("CUSTOMER_ALREADY_MERGED", "One of these customers is already merged", 409);
    }

    // Move identities. Values already on the survivor would violate the
    // (businessId, kind, value) unique — those duplicates are deleted from the
    // merged side and recorded (value-level) for the audit trail.
    const survivingIdentities = await tx.customerIdentity.findMany({ where: { customerId: survivingId } });
    const mergedIdentities = await tx.customerIdentity.findMany({ where: { customerId: mergedId } });
    const taken = new Set(survivingIdentities.map((i) => `${i.kind} ${i.value}`));

    const movedIdentityIds: string[] = [];
    const deletedDuplicateIdentities: MovedRefs["deletedDuplicateIdentities"] = [];
    for (const identity of mergedIdentities) {
      if (taken.has(`${identity.kind} ${identity.value}`)) {
        await tx.customerIdentity.delete({ where: { id: identity.id } });
        deletedDuplicateIdentities.push({
          kind: identity.kind,
          value: identity.value,
          confidence: identity.confidence,
          source: identity.source ?? null
        });
      } else {
        await tx.customerIdentity.update({ where: { id: identity.id }, data: { customerId: survivingId } });
        movedIdentityIds.push(identity.id);
      }
    }

    // Move linked operational rows, capturing exact ids BEFORE the update so
    // the merge event records precisely what a split must put back.
    const delegates = linkableDelegates(tx);
    const movedRefs = {
      conversations: [],
      vapiCalls: [],
      appointments: [],
      leads: [],
      handoffEvents: [],
      emailMessages: [],
      identities: movedIdentityIds,
      deletedDuplicateIdentities
    } as MovedRefs;

    for (const table of LINKABLE_TABLES) {
      const rows = await delegates[table].findMany({
        where: { businessId, customerId: mergedId },
        select: { id: true }
      });
      movedRefs[table] = rows.map((row) => row.id);
      if (rows.length > 0) {
        await delegates[table].updateMany({
          where: { businessId, customerId: mergedId },
          data: { customerId: survivingId }
        });
      }
    }

    await tx.customer.update({
      where: { id: mergedId },
      data: { status: "MERGED", mergedIntoId: survivingId }
    });

    // Fill survivor profile gaps from the merged profile (never overwrite).
    const profilePatch: Record<string, unknown> = {};
    if (!surviving.displayName && merged.displayName) profilePatch.displayName = merged.displayName;
    if (!surviving.primaryPhone && merged.primaryPhone) profilePatch.primaryPhone = merged.primaryPhone;
    if (!surviving.primaryEmail && merged.primaryEmail) profilePatch.primaryEmail = merged.primaryEmail;
    if (
      merged.lastSeenAt &&
      (!surviving.lastSeenAt || merged.lastSeenAt.getTime() > surviving.lastSeenAt.getTime())
    ) {
      profilePatch.lastSeenAt = merged.lastSeenAt;
    }
    if (Object.keys(profilePatch).length > 0) {
      await tx.customer.update({ where: { id: survivingId }, data: profilePatch });
    }

    const event = await tx.customerMergeEvent.create({
      data: {
        businessId,
        survivingCustomerId: survivingId,
        mergedCustomerId: mergedId,
        movedRefsJson: movedRefs as unknown as Prisma.InputJsonValue,
        mergedByUserId: actorUserId ?? null
      }
    });

    // Resolve the pending suggestion for this pair (either stored order).
    await tx.customerMergeSuggestion.updateMany({
      where: {
        businessId,
        status: "PENDING",
        OR: [
          { customerAId: survivingId, customerBId: mergedId },
          { customerAId: mergedId, customerBId: survivingId }
        ]
      },
      data: { status: "MERGED", resolvedByUserId: actorUserId ?? null, resolvedAt: new Date() }
    });

    return { mergeEventId: event.id, movedRefs };
  });

  await logBusinessActivity({
    businessId,
    action: "CUSTOMER_MERGED",
    actorUserId: actorUserId ?? null,
    targetType: "Customer",
    targetId: survivingId,
    detail: {
      mergedCustomerId: mergedId,
      mergeEventId: result.mergeEventId,
      movedCounts: Object.fromEntries(LINKABLE_TABLES.map((table) => [table, result.movedRefs[table].length])),
      movedIdentities: result.movedRefs.identities.length
    }
  });

  return result;
}

/**
 * Reverse a merge using the recorded movedRefsJson. Only rows STILL pointing
 * at the survivor are moved back — anything re-linked after the merge (new
 * data, later merges) is left alone rather than clobbered.
 */
export async function splitCustomers(args: {
  businessId: string;
  mergeEventId: string;
  actorUserId?: string | null;
}): Promise<{ mergeEventId: string; restoredCustomerId: string }> {
  const { businessId, mergeEventId, actorUserId } = args;

  const event = await prisma.customerMergeEvent.findFirst({ where: { id: mergeEventId, businessId } });
  if (!event) throw new CustomerServiceError("MERGE_EVENT_NOT_FOUND", "Merge event not found", 404);
  if (event.reversedAt) {
    throw new CustomerServiceError("MERGE_ALREADY_REVERSED", "This merge was already reversed", 409);
  }

  const movedRefs = parseMovedRefs(event.movedRefsJson);

  await prisma.$transaction(async (tx) => {
    const delegates = linkableDelegates(tx);
    for (const table of LINKABLE_TABLES) {
      const ids = movedRefs[table];
      if (ids.length === 0) continue;
      await delegates[table].updateMany({
        where: { id: { in: ids }, businessId, customerId: event.survivingCustomerId },
        data: { customerId: event.mergedCustomerId }
      });
    }

    if (movedRefs.identities.length > 0) {
      await tx.customerIdentity.updateMany({
        where: {
          id: { in: movedRefs.identities },
          businessId,
          customerId: event.survivingCustomerId
        },
        data: { customerId: event.mergedCustomerId }
      });
    }

    // Reactivate the alias (tenant-guarded via updateMany filter).
    await tx.customer.updateMany({
      where: { id: event.mergedCustomerId, businessId },
      data: { status: "ACTIVE", mergedIntoId: null }
    });

    await tx.customerMergeEvent.update({ where: { id: event.id }, data: { reversedAt: new Date() } });
  });

  await logBusinessActivity({
    businessId,
    action: "CUSTOMER_SPLIT",
    actorUserId: actorUserId ?? null,
    targetType: "Customer",
    targetId: event.mergedCustomerId,
    detail: { mergeEventId, survivingCustomerId: event.survivingCustomerId }
  });

  return { mergeEventId, restoredCustomerId: event.mergedCustomerId };
}

// ---------------------------------------------------------------------------
// Timeline / search / export / delete
// ---------------------------------------------------------------------------

type LinkedWheres = {
  conversation: Prisma.ConversationWhereInput;
  vapiCall: Prisma.VapiCallWhereInput;
  appointment: Prisma.AppointmentWhereInput;
  lead: Prisma.LeadWhereInput;
  handoffEvent: Prisma.HandoffEventWhereInput;
  emailMessage: Prisma.EmailMessageWhereInput;
};

/**
 * Where-clauses that find a customer's rows: explicit customerId links first,
 * plus a phone fallback (customerId still null + phone matches one of the
 * customer's PHONE/WHATSAPP identities) so history predating linking appears.
 */
function buildLinkedWheres(businessId: string, customerIds: string[], phoneValues: string[]): LinkedWheres {
  const linked = { customerId: { in: customerIds } };
  const hasPhones = phoneValues.length > 0;
  return {
    conversation: {
      businessId,
      OR: [linked, ...(hasPhones ? [{ customerId: null, customerPhone: { in: phoneValues } }] : [])]
    },
    vapiCall: {
      businessId,
      OR: [linked, ...(hasPhones ? [{ customerId: null, customerPhone: { in: phoneValues } }] : [])]
    },
    appointment: {
      businessId,
      OR: [linked, ...(hasPhones ? [{ customerId: null, customerPhone: { in: phoneValues } }] : [])]
    },
    lead: {
      businessId,
      OR: [linked, ...(hasPhones ? [{ customerId: null, phoneNumber: { in: phoneValues } }] : [])]
    },
    handoffEvent: { businessId, customerId: { in: customerIds } },
    emailMessage: { businessId, customerId: { in: customerIds } }
  };
}

async function loadCustomerScope(businessId: string, customerId: string) {
  const customer = await prisma.customer.findFirst({
    where: { id: customerId, businessId },
    include: { identities: true }
  });
  if (!customer) throw new CustomerServiceError("CUSTOMER_NOT_FOUND", "Customer not found", 404);

  const aliases = await prisma.customer.findMany({
    where: { businessId, mergedIntoId: customerId },
    select: { id: true }
  });
  const customerIds = [customerId, ...aliases.map((a) => a.id)];
  const phoneValues = [
    ...new Set(
      [
        customer.primaryPhone,
        ...customer.identities
          .filter((i) => i.kind === "PHONE" || i.kind === "WHATSAPP")
          .map((i) => i.value)
      ].filter((v): v is string => Boolean(v))
    )
  ];
  return { customer, customerIds, phoneValues };
}

function customerProfile(customer: {
  id: string;
  displayName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  status: string;
  mergedIntoId: string | null;
  notes: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date | null;
  identities: Array<{ id: string; kind: string; value: string; confidence: string; source: string | null }>;
}) {
  return {
    id: customer.id,
    displayName: customer.displayName,
    primaryPhone: customer.primaryPhone,
    primaryEmail: customer.primaryEmail,
    status: customer.status,
    mergedIntoId: customer.mergedIntoId,
    notes: customer.notes,
    firstSeenAt: customer.firstSeenAt,
    lastSeenAt: customer.lastSeenAt,
    identities: customer.identities.map((i) => ({
      id: i.id,
      kind: i.kind,
      value: i.value,
      confidence: i.confidence,
      source: i.source
    }))
  };
}

export type CustomerTimelineEventType = "CALL" | "CONVERSATION" | "APPOINTMENT" | "LEAD" | "HANDOFF" | "EMAIL";

export type CustomerTimelineEvent = {
  type: CustomerTimelineEventType;
  /** Our own stored timestamp — the timeline orders on OUR clock, not providers'. */
  at: Date;
  title: string;
  meta: Record<string, unknown>;
};

export async function getCustomerTimeline(args: {
  businessId: string;
  customerId: string;
  limit?: number;
}): Promise<{ customer: ReturnType<typeof customerProfile>; events: CustomerTimelineEvent[] }> {
  const { businessId, customerId } = args;
  const limit = Math.min(Math.max(args.limit ?? 100, 1), 500);
  const { customer, customerIds, phoneValues } = await loadCustomerScope(businessId, customerId);
  const wheres = buildLinkedWheres(businessId, customerIds, phoneValues);

  const [conversations, calls, appointments, leads, handoffs, emails] = await Promise.all([
    prisma.conversation.findMany({
      where: wheres.conversation,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        channel: true,
        status: true,
        outcome: true,
        sentiment: true,
        summary: true,
        createdAt: true,
        lastInboundAt: true,
        lastOutboundAt: true
      }
    }),
    prisma.vapiCall.findMany({
      where: wheres.vapiCall,
      orderBy: { startedAt: "desc" },
      take: limit,
      select: {
        id: true,
        callId: true,
        status: true,
        outcome: true,
        sentiment: true,
        summary: true,
        durationSeconds: true,
        executionMode: true,
        startedAt: true,
        endedAt: true
      }
    }),
    prisma.appointment.findMany({
      where: wheres.appointment,
      orderBy: { startAt: "desc" },
      take: limit,
      select: {
        id: true,
        service: true,
        status: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        source: true,
        cancelledAt: true,
        createdAt: true
      }
    }),
    prisma.lead.findMany({
      where: wheres.lead,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, source: true, status: true, name: true, createdAt: true }
    }),
    prisma.handoffEvent.findMany({
      where: wheres.handoffEvent,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, channel: true, status: true, reason: true, createdAt: true, resolvedAt: true }
    }),
    prisma.emailMessage.findMany({
      where: wheres.emailMessage,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: { id: true, direction: true, subject: true, status: true, createdAt: true }
    })
  ]);

  const events: CustomerTimelineEvent[] = [
    ...conversations.map((row) => ({
      type: "CONVERSATION" as const,
      at: row.createdAt,
      title: `${row.channel} conversation${row.outcome ? ` — ${row.outcome}` : ""}`,
      meta: {
        id: row.id,
        channel: row.channel,
        status: row.status,
        outcome: row.outcome,
        sentiment: row.sentiment,
        summary: row.summary,
        lastInboundAt: row.lastInboundAt,
        lastOutboundAt: row.lastOutboundAt
      }
    })),
    ...calls.map((row) => ({
      type: "CALL" as const,
      at: row.startedAt,
      title: `Call — ${row.outcome ?? row.status}`,
      meta: {
        id: row.id,
        callId: row.callId,
        status: row.status,
        outcome: row.outcome,
        sentiment: row.sentiment,
        summary: row.summary,
        durationSeconds: row.durationSeconds,
        executionMode: row.executionMode,
        endedAt: row.endedAt
      }
    })),
    ...appointments.map((row) => ({
      type: "APPOINTMENT" as const,
      at: row.startAt,
      title: `Appointment${row.service ? ` — ${row.service}` : ""} (${row.status})`,
      meta: {
        id: row.id,
        service: row.service,
        status: row.status,
        startAt: row.startAt,
        endAt: row.endAt,
        timeZone: row.timeZone,
        source: row.source,
        cancelledAt: row.cancelledAt
      }
    })),
    ...leads.map((row) => ({
      type: "LEAD" as const,
      at: row.createdAt,
      title: `Lead — ${row.status}`,
      meta: { id: row.id, source: row.source, status: row.status, name: row.name }
    })),
    ...handoffs.map((row) => ({
      type: "HANDOFF" as const,
      at: row.createdAt,
      title: `Handoff (${row.channel}) — ${row.status}`,
      meta: { id: row.id, channel: row.channel, status: row.status, reason: row.reason, resolvedAt: row.resolvedAt }
    })),
    ...emails.map((row) => ({
      type: "EMAIL" as const,
      at: row.createdAt,
      title: row.subject ? `Email — ${row.subject}` : "Email",
      meta: { id: row.id, direction: row.direction, status: row.status }
    }))
  ];

  events.sort((a, b) => b.at.getTime() - a.at.getTime());

  return { customer: customerProfile(customer), events: events.slice(0, limit) };
}

export async function searchCustomers(args: { businessId: string; q?: string | null; limit?: number }) {
  const { businessId } = args;
  const take = Math.min(Math.max(args.limit ?? 25, 1), 100);
  const query = (args.q ?? "").trim();
  const orderBy: Prisma.CustomerOrderByWithRelationInput[] = [
    { lastSeenAt: { sort: "desc", nulls: "last" } },
    { firstSeenAt: "desc" }
  ];

  if (!query) {
    return prisma.customer.findMany({
      where: { businessId, status: { not: "MERGED" } },
      include: { identities: true },
      orderBy,
      take
    });
  }

  const normalizedPhone = normalizePhoneE164(query);
  const needles = [...new Set([query.toLowerCase(), ...(normalizedPhone ? [normalizedPhone] : [])])];

  const identityMatches = await prisma.customerIdentity.findMany({
    where: {
      businessId,
      OR: needles.map((needle) => ({ value: { contains: needle, mode: "insensitive" as const } }))
    },
    select: { customerId: true },
    take: 200
  });
  const identityCustomerIds = [...new Set(identityMatches.map((m) => m.customerId))];

  return prisma.customer.findMany({
    where: {
      businessId,
      status: { not: "MERGED" },
      OR: [
        { displayName: { contains: query, mode: "insensitive" } },
        { primaryPhone: { contains: normalizedPhone || query } },
        { primaryEmail: { contains: query.toLowerCase() } },
        ...(identityCustomerIds.length ? [{ id: { in: identityCustomerIds } }] : [])
      ]
    },
    include: { identities: true },
    orderBy,
    take
  });
}

/**
 * Data-portability bundle: profile + identities + every linked row (safe
 * fields only — no billing/pricing internals, no provider payload blobs).
 */
export async function exportCustomerData(args: { businessId: string; customerId: string }) {
  const { businessId, customerId } = args;
  const { customer, customerIds, phoneValues } = await loadCustomerScope(businessId, customerId);
  const wheres = buildLinkedWheres(businessId, customerIds, phoneValues);

  const [conversations, calls, appointments, leads, handoffs, emails] = await Promise.all([
    prisma.conversation.findMany({
      where: wheres.conversation,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channel: true,
        customerPhone: true,
        status: true,
        outcome: true,
        sentiment: true,
        summary: true,
        createdAt: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: { direction: true, body: true, createdAt: true }
        }
      }
    }),
    prisma.vapiCall.findMany({
      where: wheres.vapiCall,
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        callId: true,
        customerPhone: true,
        status: true,
        outcome: true,
        sentiment: true,
        transcript: true,
        summary: true,
        recordingUrl: true,
        durationSeconds: true,
        executionMode: true,
        startedAt: true,
        endedAt: true
      }
    }),
    prisma.appointment.findMany({
      where: wheres.appointment,
      orderBy: { startAt: "asc" },
      select: {
        id: true,
        customerPhone: true,
        customerName: true,
        customerEmail: true,
        service: true,
        status: true,
        startAt: true,
        endAt: true,
        timeZone: true,
        source: true,
        notes: true,
        cancelledAt: true,
        createdAt: true
      }
    }),
    prisma.lead.findMany({
      where: wheres.lead,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        source: true,
        status: true,
        notes: true,
        createdAt: true
      }
    }),
    prisma.handoffEvent.findMany({
      where: wheres.handoffEvent,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        channel: true,
        customerPhone: true,
        status: true,
        reason: true,
        createdAt: true,
        resolvedAt: true
      }
    }),
    prisma.emailMessage.findMany({
      where: wheres.emailMessage,
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        direction: true,
        fromEmail: true,
        toEmail: true,
        subject: true,
        textBody: true,
        status: true,
        sentAt: true,
        receivedAt: true,
        createdAt: true
      }
    })
  ]);

  return {
    exportedAt: new Date().toISOString(),
    customer: customerProfile(customer),
    conversations,
    calls,
    appointments,
    leads,
    handoffEvents: handoffs,
    emailMessages: emails
  };
}

/**
 * Right-to-erasure, anonymize strategy. Tradeoff, deliberately: operational /
 * financial rows (calls with billed cost, appointments, invoiced usage) are
 * KEPT as a non-PII skeleton — statuses, durations, costs — because billing
 * and revenue accounting must stay reconstructible. What is removed:
 *
 * - the Customer row (and its MERGED aliases), identities, merge suggestions/events
 * - customerId links on every linked row
 * - person-identifying columns: phone tombstoned ("DELETED" — per-row-unique
 *   "DELETED:<rowId>" on Conversation/Lead whose phone columns carry unique
 *   indexes), names/emails nulled
 * - call content: transcript, summary, recordingUrl
 *
 * Conversation message bodies are retained (business operational record); the
 * thread is unlinked and its phone tombstoned so it no longer identifies anyone.
 */
export async function deleteCustomerData(args: {
  businessId: string;
  customerId: string;
  actorUserId?: string | null;
}) {
  const { businessId, customerId, actorUserId } = args;

  const counts = await prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: customerId, businessId },
      include: { identities: true }
    });
    if (!customer) throw new CustomerServiceError("CUSTOMER_NOT_FOUND", "Customer not found", 404);

    const aliases = await tx.customer.findMany({
      where: { businessId, mergedIntoId: customerId },
      select: { id: true }
    });
    const customerIds = [customerId, ...aliases.map((a) => a.id)];
    const phoneValues = [
      ...new Set(
        [
          customer.primaryPhone,
          ...customer.identities
            .filter((i) => i.kind === "PHONE" || i.kind === "WHATSAPP")
            .map((i) => i.value)
        ].filter((v): v is string => Boolean(v))
      )
    ];
    const wheres = buildLinkedWheres(businessId, customerIds, phoneValues);

    // Conversation + Lead phone columns sit under unique indexes
    // (businessId, channel, customerPhone) / (businessId, phoneNumber), so each
    // row gets a distinct tombstone instead of a shared "DELETED" literal.
    const conversationRows = await tx.conversation.findMany({
      where: wheres.conversation,
      select: { id: true }
    });
    for (const row of conversationRows) {
      await tx.conversation.update({
        where: { id: row.id },
        data: { customerId: null, customerPhone: `DELETED:${row.id}` }
      });
    }

    const leadRows = await tx.lead.findMany({ where: wheres.lead, select: { id: true } });
    for (const row of leadRows) {
      await tx.lead.update({
        where: { id: row.id },
        data: { customerId: null, phoneNumber: `DELETED:${row.id}`, name: null }
      });
    }

    const appointmentsRes = await tx.appointment.updateMany({
      where: wheres.appointment,
      data: { customerId: null, customerPhone: "DELETED", customerName: null, customerEmail: null }
    });

    const callsRes = await tx.vapiCall.updateMany({
      where: wheres.vapiCall,
      data: {
        customerId: null,
        customerPhone: "DELETED",
        transcript: null,
        summary: null,
        recordingUrl: null
      }
    });

    const handoffsRes = await tx.handoffEvent.updateMany({
      where: { businessId, customerId: { in: customerIds } },
      data: { customerId: null, customerPhone: null }
    });

    const emailsRes = await tx.emailMessage.updateMany({
      where: { businessId, customerId: { in: customerIds } },
      data: { customerId: null }
    });

    const suggestionsRes = await tx.customerMergeSuggestion.deleteMany({
      where: {
        businessId,
        OR: [{ customerAId: { in: customerIds } }, { customerBId: { in: customerIds } }]
      }
    });
    const mergeEventsRes = await tx.customerMergeEvent.deleteMany({
      where: {
        businessId,
        OR: [
          { survivingCustomerId: { in: customerIds } },
          { mergedCustomerId: { in: customerIds } }
        ]
      }
    });
    const identitiesRes = await tx.customerIdentity.deleteMany({
      where: { customerId: { in: customerIds } }
    });
    // MERGED aliases are the same person — they go too.
    const customersRes = await tx.customer.deleteMany({
      where: { id: { in: customerIds }, businessId }
    });

    return {
      conversationsRedacted: conversationRows.length,
      leadsRedacted: leadRows.length,
      appointmentsRedacted: appointmentsRes.count,
      callsRedacted: callsRes.count,
      handoffsUnlinked: handoffsRes.count,
      emailsUnlinked: emailsRes.count,
      suggestionsDeleted: suggestionsRes.count,
      mergeEventsDeleted: mergeEventsRes.count,
      identitiesDeleted: identitiesRes.count,
      customersDeleted: customersRes.count
    };
  });

  await logBusinessActivity({
    businessId,
    action: "CUSTOMER_DELETED",
    actorUserId: actorUserId ?? null,
    targetType: "Customer",
    targetId: customerId,
    detail: counts
  });

  return counts;
}
