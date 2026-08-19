import { normalizeTimeZone, zonedWallClockToUtc } from "@coreai/shared";
import { Hono } from "hono";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { bodyLimit } from "hono/body-limit";
import { getClientIp } from "../../lib/client-ip";
import { consumeAll, DAY, HOUR } from "../../lib/rate-limit";
import { errorResponse, successResponse } from "../../lib/api-response";
import { validateSmsRecipientE164 } from "../architect/twilio-connector";
import { maskPhone, recordWebFormSmsConsent } from "../notifications/sms-consent";
import { sendTrackedSms } from "../notifications/sms-notification-service";
import { smsAttributionPrefix } from "../notifications/sms-format";

export const publicBookingRoutes = new Hono();

/** URL-safe slug + short id suffix (unique even for duplicate business names). */
export function buildBookingSlug(businessName: string, businessId: string): string {
  const namePart = businessName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = businessId.slice(-6);
  return [namePart, suffix].filter(Boolean).join("-");
}

/** Get (or lazily create) the business's public booking slug. */
export async function ensureBusinessBookingSlug(businessId: string): Promise<string | null> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, name: true, publicBookingSlug: true }
  });
  if (!business) return null;
  if (business.publicBookingSlug) return business.publicBookingSlug;

  const slug = buildBookingSlug(business.name, business.id);
  const updated = await prisma.business.update({
    where: { id: business.id },
    data: { publicBookingSlug: slug },
    select: { publicBookingSlug: true }
  });
  return updated.publicBookingSlug;
}

async function findBusinessBySlug(slug: string) {
  if (!slug || slug.length > 200) return null;
  return prisma.business.findUnique({
    where: { publicBookingSlug: slug },
    select: {
      id: true,
      name: true,
      type: true,
      publicBookingSlug: true,
      profile: { select: { services: true, timeZone: true, hoursJson: true } }
    }
  });
}

/** Public business info needed to render the booking form. */
publicBookingRoutes.get("/booking/:slug", async (c) => {
  const business = await findBusinessBySlug(c.req.param("slug"));
  if (!business) {
    return errorResponse(c, "Booking page not found", 404, "BOOKING_PAGE_NOT_FOUND");
  }
  return successResponse(c, {
    business: {
      slug: business.publicBookingSlug,
      name: business.name,
      type: business.type,
      services: business.profile?.services ?? []
    }
  });
});

const bookingRequestSchema = z.object({
  customerName: z.string().trim().min(1, "Please enter your name.").max(160),
  customerPhone: z
    .string()
    .trim()
    .min(8, "Please enter your mobile phone number.")
    .max(24),
  service: z.string().trim().max(160).optional(),
  preferredDate: z.string().trim().max(40).optional(),
  preferredTime: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(2000).optional(),
  smsConsent: z.boolean().optional().default(false),
  /** Public page URL the form was submitted from (consent evidence). */
  sourceUrl: z.string().trim().max(600).optional()
});

/**
 * Parse "YYYY-MM-DD" + optional "HH:mm" as wall-clock time in the business
 * timezone into a UTC instant; null if unusable. Never interprets the
 * customer's local time as UTC.
 */
function parseRequestedStart(dateStr: string | undefined, timeStr: string | undefined, timeZone: string): Date | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const time = timeStr && /^\d{2}:\d{2}$/.test(timeStr) ? timeStr : "09:00";
  const [hour, minute] = time.split(":").map(Number);
  const parsed = zonedWallClockToUtc(dateStr, hour ?? 9, minute ?? 0, timeZone);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A booking form is a few short fields — anything larger is not a booking. */
const publicBookingBodyLimit = bodyLimit({
  maxSize: 32 * 1024,
  onError: (c) => errorResponse(c, "That request is too large.", 413, "PAYLOAD_TOO_LARGE")
});

publicBookingRoutes.post("/booking/:slug", publicBookingBodyLimit, async (c) => {
  const business = await findBusinessBySlug(c.req.param("slug"));
  if (!business) {
    return errorResponse(c, "Booking page not found", 404, "BOOKING_PAGE_NOT_FOUND");
  }

  let input: z.infer<typeof bookingRequestSchema>;
  try {
    input = bookingRequestSchema.parse(await c.req.json());
  } catch (error) {
    if (error instanceof z.ZodError) {
      return errorResponse(
        c,
        error.issues[0]?.message ?? "Invalid booking request",
        422,
        "VALIDATION_ERROR"
      );
    }
    return errorResponse(c, "Invalid booking request", 422, "VALIDATION_ERROR");
  }

  const phone = validateSmsRecipientE164(input.customerPhone);
  if (!phone.ok) {
    return errorResponse(c, phone.error, 422, "INVALID_PHONE");
  }

  // THIS ENDPOINT SENDS A TEXT MESSAGE AND HAD NO LIMIT OF ANY KIND.
  //
  // Anyone could post to it in a loop with a stranger's phone number and the
  // business's Twilio account would text that person, over and over, with the
  // business's name on it. Three separate rules, because one is never enough:
  // the sender, the target, and the business whose bill it is.
  const clientIp = getClientIp(c);
  const limited = await consumeAll([
    {
      key: `booking:ip:${clientIp}`,
      limit: 5,
      windowMs: HOUR,
      message: "You've sent a few requests already. Please try again in a little while."
    },
    {
      key: `booking:phone:${phone.e164}`,
      limit: 3,
      windowMs: DAY,
      message: "We already have a request for this number today. The team will be in touch."
    },
    {
      key: `booking:business:${business.id}`,
      limit: 200,
      windowMs: DAY,
      message: "This booking page is busy right now. Please try again shortly."
    }
  ]);
  if (!limited.allowed) {
    return errorResponse(c, limited.message, 429, "RATE_LIMITED");
  }

  const bookingTimeZone = normalizeTimeZone(business.profile?.timeZone);
  const requestedStart = parseRequestedStart(input.preferredDate, input.preferredTime, bookingTimeZone);
  const startAt = requestedStart ?? new Date();
  const endAt = new Date(startAt.getTime() + 30 * 60 * 1000);
  const preferredText = [input.preferredDate, input.preferredTime].filter(Boolean).join(" ");

  // Status REQUESTED: a web request the team still confirms — deliberately not
  // written to Google Calendar and never auto-BOOKED.
  const appointment = await prisma.appointment.create({
    data: {
      businessId: business.id,
      customerPhone: phone.e164,
      customerName: input.customerName,
      service: input.service || null,
      startAt,
      endAt,
      timeZone: bookingTimeZone,
      status: "REQUESTED",
      notes: [
        "Public booking form request.",
        preferredText ? `Preferred: ${preferredText}${requestedStart ? "" : " (time to be confirmed)"}` : "Preferred time: to be confirmed",
        input.notes ? `Notes: ${input.notes}` : null
      ]
        .filter(Boolean)
        .join("\n")
    },
    select: { id: true, status: true }
  });

  await prisma.lead
    .upsert({
      where: { businessId_phoneNumber: { businessId: business.id, phoneNumber: phone.e164 } },
      update: { name: input.customerName, status: "ENGAGED", notes: `Web booking request ${appointment.id}` },
      create: {
        businessId: business.id,
        phoneNumber: phone.e164,
        name: input.customerName,
        source: "WEB_BOOKING_FORM",
        status: "NEW",
        notes: `Web booking request ${appointment.id}`
      }
    })
    .catch(() => null);

  // Optional SMS consent — recorded ONLY when the customer actively checked
  // the box. Failures here never fail the booking.
  let consentStatus: "OPTED_IN" | "NOT_REQUESTED" | "FAILED" = "NOT_REQUESTED";
  if (input.smsConsent === true) {
    try {
      // The address is the evidence that this consent was real. Reading it
      // from a header the caller controls let them write their own alibi into
      // the record we would rely on if the person ever complained.
      const ipAddress = clientIp === "unknown" ? null : clientIp;
      const userAgent = (c.req.header("user-agent") ?? "").slice(0, 500) || null;
      const consent = await recordWebFormSmsConsent({
        businessId: business.id,
        phoneNumber: phone.e164,
        businessName: business.name,
        appointmentId: appointment.id,
        sourceUrl: input.sourceUrl ?? null,
        ipAddress,
        userAgent
      });
      consentStatus = consent.ok ? "OPTED_IN" : "FAILED";
      if (!consent.ok) {
        console.error("[public-booking] consent record failed", { reason: consent.error });
      }
    } catch (error) {
      consentStatus = "FAILED";
      console.error("[public-booking] consent record error", error);
    }
  }

  // Acknowledgement text — only ever after consent was recorded successfully.
  // The central gate re-verifies; without consent nothing is sent.
  let smsSent = false;
  if (consentStatus === "OPTED_IN") {
    const whenText = preferredText || "your requested time";
    const outcome = await sendTrackedSms({
      to: phone.e164,
      body: `${smsAttributionPrefix(business.name)}Hi ${input.customerName}, we received your ${input.service ? `${input.service} ` : ""}request for ${whenText}. The team will confirm shortly. Reply STOP to opt out or HELP for assistance. Msg & data rates may apply.`,
      messageType: "WORKFLOW_SMS",
      businessId: business.id,
      businessName: business.name,
      smsPurpose: "BOOKING_ACKNOWLEDGEMENT",
      appointmentId: appointment.id,
      dedupeKey: `booking-request:${appointment.id}`
    }).catch(() => null);
    smsSent = Boolean(outcome && (outcome.sent || outcome.alreadySent));
  }

  console.log("[public-booking] request created", {
    businessId: business.id,
    appointmentId: appointment.id,
    phone: maskPhone(phone.e164),
    consentStatus,
    smsSent
  });

  return successResponse(
    c,
    {
      booking: { id: appointment.id, status: appointment.status },
      smsConsent: consentStatus,
      smsSent
    },
    "Booking request received",
    201
  );
});
