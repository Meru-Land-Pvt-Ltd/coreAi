import { prisma } from "../../../lib/prisma";
import { getActiveCrmConnection } from "./context.service";
import { createContactNote, upsertContactByPhone } from "./service";
import { toE164 } from "./utils/phone";

/**
 * After-call CRM sync.
 *
 * Required behaviour from the product spec:
 *   existing contact (phone match) → UPDATE it, attach the AI call summary
 *   new caller (no match)          → CREATE from the phone number, attach summary
 *
 * Phone is the only required field. A caller who never gave an email or a
 * company is the normal case, not an error — those properties are simply
 * omitted. Nothing here ever fabricates an address, a company, or a name.
 *
 * Runs AFTER the call has ended, so it is allowed to be slow; it is not allowed
 * to throw into the webhook that triggered it.
 */

export interface CallSyncInput {
  businessId: string;
  /** Caller number in any format; normalized to E.164 here. */
  customerPhone: string;
  /** Name spoken during the call, if the agent collected one. */
  spokenName?: string | null;
  /** Email spoken during the call, if any. Never invented. */
  email?: string | null;
  /** AI-written call summary (VapiCall.summary). */
  summary?: string | null;
  /** Classified outcome (BOOKED, LEAD, …) for the note header. */
  outcome?: string | null;
  durationSeconds?: number | null;
  /** Provider call id, used for the idempotency mapping. */
  callId?: string | null;
  channel?: "VOICE" | "SMS" | "WHATSAPP" | "TELEGRAM";
}

export interface CallSyncResult {
  synced: boolean;
  created: boolean;
  contactId: string | null;
  reason?: string;
}

const SKIPPED_NO_CONNECTION: CallSyncResult = {
  synced: false,
  created: false,
  contactId: null,
  reason: "No active CRM connection"
};

/** "Maria Gomez" → first/last. A single token becomes the first name only. */
export function splitSpokenName(spoken: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const trimmed = spoken?.trim();
  if (!trimmed) return { firstName: null, lastName: null };

  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (!parts.length) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0], lastName: null };

  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function buildCallNote(input: CallSyncInput): string {
  const header = [
    input.channel && input.channel !== "VOICE" ? `${titleCase(input.channel)} conversation` : "Phone call",
    input.outcome ? `outcome: ${titleCase(input.outcome)}` : null,
    typeof input.durationSeconds === "number" && input.durationSeconds > 0
      ? `duration: ${formatDuration(input.durationSeconds)}`
      : null
  ]
    .filter(Boolean)
    .join(" · ");

  const body = input.summary?.trim();
  return body ? `${header}\n\n${body}` : `${header}\n\nNo summary was captured for this call.`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  return minutes > 0 ? `${minutes}m ${remainder}s` : `${remainder}s`;
}

/**
 * Name/email the caller actually gave during this call.
 *
 * Sources, in order of confidence: an appointment booked on this call, then a
 * lead captured for this number. Returns nulls when the caller gave nothing —
 * which is the common case, and is fine: the contact is created from the phone
 * number alone and gains a name the first time one is spoken.
 */
async function resolveCollectedIdentity(params: {
  businessId: string;
  phone: string;
  callId: string | null;
}): Promise<{ name: string | null; email: string | null }> {
  try {
    if (params.callId) {
      const appointment = await prisma.appointment.findFirst({
        where: {
          businessId: params.businessId,
          executionMode: "LIVE",
          bookingCallId: params.callId
        },
        orderBy: { createdAt: "desc" },
        select: { customerName: true, customerEmail: true }
      });
      if (appointment?.customerName || appointment?.customerEmail) {
        return {
          name: appointment.customerName ?? null,
          email: appointment.customerEmail ?? null
        };
      }
    }

    const lead = await prisma.lead.findFirst({
      where: { businessId: params.businessId, phoneNumber: params.phone },
      orderBy: { updatedAt: "desc" },
      select: { name: true }
    });

    return { name: lead?.name ?? null, email: null };
  } catch (error) {
    // Identity enrichment is a bonus; never let it block the CRM write.
    console.warn("[hubspot] collected identity lookup failed", {
      businessId: params.businessId,
      error: error instanceof Error ? error.message : String(error)
    });
    return { name: null, email: null };
  }
}

/**
 * Create-or-update the caller in the active CRM and attach the call summary.
 * Never throws — the caller is a webhook handler that must still return 200.
 */
export async function syncCallToCrm(input: CallSyncInput): Promise<CallSyncResult> {
  const phone = toE164(input.customerPhone);
  if (!phone) {
    return { synced: false, created: false, contactId: null, reason: "No usable phone number" };
  }

  try {
    const connection = await getActiveCrmConnection(input.businessId);
    if (!connection) return SKIPPED_NO_CONNECTION;

    // Idempotency: a retried webhook must not write the same note twice.
    if (input.callId) {
      const existing = await prisma.crmObjectMapping.findUnique({
        where: {
          connectionId_trivenEntity_trivenId: {
            connectionId: connection.id,
            trivenEntity: "vapi_call",
            trivenId: input.callId
          }
        }
      });
      if (existing) {
        return {
          synced: true,
          created: false,
          contactId: existing.hubspotId,
          reason: "Already synced"
        };
      }
    }

    // The caller's name is not on the webhook payload — it lands on whatever
    // the agent's tools wrote during the call (a booking, or a captured lead).
    // Read it from there rather than creating every caller name-less.
    const collected = input.spokenName
      ? { name: input.spokenName, email: input.email ?? null }
      : await resolveCollectedIdentity({
          businessId: input.businessId,
          phone,
          callId: input.callId ?? null
        });

    const { firstName, lastName } = splitSpokenName(collected.name);
    const email = input.email?.trim() || collected.email?.trim() || null;

    const { contact, created } = await upsertContactByPhone({
      businessId: input.businessId,
      input: {
        phone,
        // Omitted (undefined) rather than nulled when unknown, so an existing
        // HubSpot name/email is never blanked by a call that did not learn it.
        ...(firstName ? { firstName } : {}),
        ...(lastName ? { lastName } : {}),
        ...(email ? { email } : {})
      }
    });

    const note = await createContactNote({
      businessId: input.businessId,
      contactId: contact.id,
      body: buildCallNote(input),
      aiGenerated: true
    }).catch((error) => {
      // A failed note must not undo a successful contact write.
      console.error("[hubspot] call note failed", {
        businessId: input.businessId,
        contactId: contact.id,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    });

    if (input.callId) {
      await prisma.crmObjectMapping
        .create({
          data: {
            connectionId: connection.id,
            businessId: input.businessId,
            trivenEntity: "vapi_call",
            trivenId: input.callId,
            hubspotObject: note ? "note" : "contact",
            hubspotId: note ? note.id : contact.id
          }
        })
        .catch(() => {
          // Unique-constraint race with a concurrent retry: the other writer won.
        });
    }

    console.info("[hubspot] call synced", {
      businessId: input.businessId,
      contactId: contact.id,
      created,
      noteWritten: Boolean(note)
    });

    return { synced: true, created, contactId: contact.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[hubspot] call sync failed", { businessId: input.businessId, error: message });
    return { synced: false, created: false, contactId: null, reason: message };
  }
}
