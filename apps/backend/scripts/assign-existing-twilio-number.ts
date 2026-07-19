import "dotenv/config";
import twilio from "twilio";
import { prisma } from "../src/lib/prisma";

/**
 * Assign an ALREADY-PURCHASED Twilio number to one Triven business for testing.
 *
 * This script NEVER calls AvailablePhoneNumbers or IncomingPhoneNumbers.create,
 * so it cannot purchase a new number.
 *
 * Dry-run by default. Add --apply to update Twilio webhooks and database rows.
 */

type Args = {
  email?: string;
  businessId?: string;
  installedAgentId?: string;
  phone?: string;
  twilioSid?: string;
  forwardTo?: string;
  backendUrl?: string;
  apply: boolean;
  skipTwilioWebhookUpdate: boolean;
};

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const item = process.argv.find((value) => value.startsWith(prefix));
  return item?.slice(prefix.length).trim() || undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function parseArgs(): Args {
  return {
    email: argValue("email"),
    businessId: argValue("business-id"),
    installedAgentId: argValue("installed-agent-id"),
    phone: argValue("phone"),
    twilioSid: argValue("twilio-sid"),
    forwardTo: argValue("forward-to"),
    backendUrl: argValue("backend-url"),
    apply: hasFlag("apply"),
    skipTwilioWebhookUpdate: hasFlag("skip-twilio-webhook-update")
  };
}

function normalizeE164(value: string | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/[^\d+]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function fail(code: string, message: string): never {
  console.error(JSON.stringify({ ok: false, code, message }, null, 2));
  process.exit(1);
}

async function resolveBusiness(args: Args) {
  if (args.businessId) {
    const business = await prisma.business.findUnique({
      where: { id: args.businessId },
      include: { owner: { select: { id: true, email: true, role: true } } }
    });

    if (!business) fail("BUSINESS_NOT_FOUND", `No business found for ${args.businessId}.`);
    return business;
  }

  if (!args.email) {
    fail("TARGET_REQUIRED", "Pass --business-id=... or --email=buyer@example.com.");
  }

  const owner = await prisma.user.findUnique({
    where: { email: args.email.toLowerCase() },
    select: { id: true, email: true, role: true }
  });

  if (!owner || owner.role !== "BUSINESS") {
    fail("BUSINESS_USER_NOT_FOUND", `No BUSINESS user found for ${args.email}.`);
  }

  const businesses = await prisma.business.findMany({
    where: { ownerId: owner.id },
    orderBy: { createdAt: "desc" },
    include: { owner: { select: { id: true, email: true, role: true } } }
  });

  if (businesses.length === 0) {
    fail("BUSINESS_NOT_FOUND", `The user ${args.email} does not have a Business row.`);
  }

  if (businesses.length > 1) {
    fail(
      "MULTIPLE_BUSINESSES",
      `The user has ${businesses.length} businesses. Re-run with --business-id=<id>.`
    );
  }

  return businesses[0]!;
}

async function resolveInstalledAgent(businessId: string, installedAgentId?: string) {
  if (installedAgentId) {
    const agent = await prisma.installedAgent.findFirst({
      where: { id: installedAgentId, businessId }
    });
    if (!agent) {
      fail(
        "INSTALLED_AGENT_NOT_FOUND",
        `Installed agent ${installedAgentId} does not belong to business ${businessId}.`
      );
    }
    return agent;
  }

  const agents = await prisma.installedAgent.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" }
  });

  if (agents.length === 0) {
    fail("INSTALLED_AGENT_NOT_FOUND", "This business does not have an installed agent.");
  }

  if (agents.length > 1) {
    fail(
      "MULTIPLE_INSTALLED_AGENTS",
      `The business has ${agents.length} installed agents. Re-run with --installed-agent-id=<id>.`
    );
  }

  return agents[0]!;
}

async function main() {
  const args = parseArgs();

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    fail("TWILIO_CONFIG_MISSING", "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required.");
  }

  if (!args.phone && !args.twilioSid) {
    fail("NUMBER_REQUIRED", "Pass --phone=+1... or --twilio-sid=PN...");
  }

  const requestedPhone = args.phone ? normalizeE164(args.phone) : null;
  if (args.phone && !requestedPhone) {
    fail("INVALID_PHONE", "--phone must be valid E.164, for example +12135550123.");
  }

  const forwardTo = args.forwardTo ? normalizeE164(args.forwardTo) : null;
  if (args.forwardTo && !forwardTo) {
    fail("INVALID_FORWARD_TO", "--forward-to must be valid E.164.");
  }

  const backendUrl = normalizeBaseUrl(
    args.backendUrl || process.env.BACKEND_URL || "https://triven.ai/api"
  );
  const voiceUrl = `${backendUrl}/architect/connectors/twilio/voice`;
  const smsUrl = `${backendUrl}/architect/connectors/twilio/inbound-sms`;

  const business = await resolveBusiness(args);
  const installedAgent = await resolveInstalledAgent(business.id, args.installedAgentId);

  const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

  let incoming: any;
  if (args.twilioSid) {
    if (!/^PN[0-9a-fA-F]{32}$/.test(args.twilioSid)) {
      fail("INVALID_TWILIO_SID", "--twilio-sid must be a PN SID.");
    }
    incoming = await client.incomingPhoneNumbers(args.twilioSid).fetch();
  } else {
    const matches = await client.incomingPhoneNumbers.list({
      phoneNumber: requestedPhone!,
      limit: 20
    });
    incoming = matches.find((item) => item.phoneNumber === requestedPhone);
    if (!incoming) {
      fail(
        "TWILIO_NUMBER_NOT_OWNED",
        `${requestedPhone} is not an already-purchased number in this Twilio account.`
      );
    }
  }

  const phoneNumber = normalizeE164(incoming.phoneNumber);
  if (!phoneNumber) {
    fail("TWILIO_PHONE_INVALID", "Twilio returned a phone number that is not valid E.164.");
  }

  if (requestedPhone && requestedPhone !== phoneNumber) {
    fail("PHONE_SID_MISMATCH", `The PN SID belongs to ${phoneNumber}, not ${requestedPhone}.`);
  }

  const sharedSmsNumber = normalizeE164(process.env.TWILIO_SHARED_SMS_NUMBER);
  if (sharedSmsNumber && sharedSmsNumber === phoneNumber) {
    fail(
      "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE",
      `${phoneNumber} is the shared Triven SMS sender and cannot be assigned to a buyer.`
    );
  }

  const existingPlatform = await prisma.platformPhoneNumber.findUnique({
    where: { phoneNumber }
  });

  if (existingPlatform?.isPlatformSmsSender) {
    fail(
      "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE",
      `${phoneNumber} is marked as the platform SMS sender.`
    );
  }

  if (existingPlatform?.businessId && existingPlatform.businessId !== business.id) {
    fail(
      "NUMBER_ASSIGNED_TO_ANOTHER_BUSINESS",
      `${phoneNumber} is already assigned to business ${existingPlatform.businessId}.`
    );
  }

  const existingRouting = await prisma.businessPhoneNumber.findUnique({
    where: { phoneNumber }
  });

  if (existingRouting && existingRouting.businessId !== business.id) {
    fail(
      "NUMBER_ROUTED_TO_ANOTHER_BUSINESS",
      `${phoneNumber} already routes to business ${existingRouting.businessId}.`
    );
  }

  const otherActiveRouting = await prisma.businessPhoneNumber.findFirst({
    where: {
      businessId: business.id,
      isActive: true,
      NOT: { phoneNumber }
    },
    select: { phoneNumber: true, installedAgentId: true }
  });

  if (otherActiveRouting) {
    fail(
      "BUSINESS_ALREADY_HAS_ACTIVE_NUMBER",
      `This business already has active number ${otherActiveRouting.phoneNumber}. ` +
        "Do not assign a second number; use the existing one or perform an admin replacement."
    );
  }

  const capabilities = {
    voice: Boolean(incoming.capabilities?.voice),
    sms: Boolean(incoming.capabilities?.sms),
    mms: Boolean(incoming.capabilities?.mms)
  };

  const plan = {
    mode: args.apply ? "APPLY" : "DRY_RUN",
    purchaseApiCalled: false,
    business: {
      id: business.id,
      name: business.name,
      ownerEmail: business.owner.email
    },
    installedAgent: {
      id: installedAgent.id,
      name: installedAgent.name
    },
    number: {
      phoneNumber,
      twilioSid: incoming.sid,
      country: incoming.isoCountry ?? null,
      capabilities
    },
    routing: {
      forwardToPhone: forwardTo,
      voiceUrl,
      smsUrl
    }
  };

  console.log(JSON.stringify(plan, null, 2));

  if (!args.apply) {
    console.log("\nDry run only. Re-run with --apply after checking the business, agent, and number.");
    return;
  }

  if (!args.skipTwilioWebhookUpdate) {
    await client.incomingPhoneNumbers(incoming.sid).update({
      friendlyName: `Triven test - ${business.name}`.slice(0, 64),
      voiceUrl,
      voiceMethod: "POST",
      smsUrl,
      smsMethod: "POST"
    });
  }

  const now = new Date();

  const result = await prisma.$transaction(async (tx) => {
    const platform = await tx.platformPhoneNumber.upsert({
      where: { phoneNumber },
      create: {
        phoneNumber,
        e164: phoneNumber,
        provider: "TWILIO",
        status: "ASSIGNED",
        twilioSid: incoming.sid,
        providerNumberId: incoming.sid,
        country: incoming.isoCountry ?? null,
        capabilities,
        voiceEnabled: capabilities.voice,
        smsEnabled: capabilities.sms,
        mmsEnabled: capabilities.mms,
        businessId: business.id,
        buyerUserId: business.ownerId,
        installedAgentId: installedAgent.id,
        assignedAt: now,
        voiceWebhookUrl: voiceUrl,
        smsWebhookUrl: smsUrl,
        webhookStatus: args.skipTwilioWebhookUpdate ? "UNKNOWN" : "CONFIGURED",
        isPlatformSmsSender: false,
        lastSyncedAt: now,
        lastError: null
      },
      update: {
        e164: phoneNumber,
        provider: "TWILIO",
        status: "ASSIGNED",
        twilioSid: incoming.sid,
        providerNumberId: incoming.sid,
        country: incoming.isoCountry ?? null,
        capabilities,
        voiceEnabled: capabilities.voice,
        smsEnabled: capabilities.sms,
        mmsEnabled: capabilities.mms,
        businessId: business.id,
        buyerUserId: business.ownerId,
        installedAgentId: installedAgent.id,
        assignedAt: existingPlatform?.assignedAt ?? now,
        releasedAt: null,
        voiceWebhookUrl: voiceUrl,
        smsWebhookUrl: smsUrl,
        webhookStatus: args.skipTwilioWebhookUpdate ? "UNKNOWN" : "CONFIGURED",
        isPlatformSmsSender: false,
        lastSyncedAt: now,
        lastError: null
      }
    });

    const routing = await tx.businessPhoneNumber.upsert({
      where: { phoneNumber },
      create: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        phoneNumber,
        provider: "TWILIO",
        twilioPhoneNumberSid: incoming.sid,
        forwardToPhone: forwardTo,
        isActive: true,
        configJson: {
          source: "ASSIGN_EXISTING_TWILIO_NUMBER_SCRIPT",
          testingOnly: true,
          assignedAt: now.toISOString()
        }
      },
      update: {
        businessId: business.id,
        installedAgentId: installedAgent.id,
        provider: "TWILIO",
        twilioPhoneNumberSid: incoming.sid,
        ...(forwardTo ? { forwardToPhone: forwardTo } : {}),
        isActive: true,
        configJson: {
          source: "ASSIGN_EXISTING_TWILIO_NUMBER_SCRIPT",
          testingOnly: true,
          assignedAt: now.toISOString()
        }
      }
    });

    return { platform, routing };
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        purchasedNewNumber: false,
        phoneNumber: result.platform.phoneNumber,
        platformPhoneNumberId: result.platform.id,
        businessPhoneNumberId: result.routing.id,
        businessId: business.id,
        installedAgentId: installedAgent.id,
        webhookStatus: result.platform.webhookStatus
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          code: "ASSIGN_EXISTING_NUMBER_FAILED",
          message: error instanceof Error ? error.message : String(error)
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
