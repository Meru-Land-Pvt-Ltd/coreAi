import "dotenv/config";
import twilio from "twilio";
import { prisma } from "../src/lib/prisma";
import { userHasBusinessCapability } from "../src/lib/roles";

type Args = {
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
    // --agent-id is the preferred public argument.
    // --installed-agent-id remains as a backward-compatible alias.
    installedAgentId:
      argValue("agent-id") ??
      argValue("installed-agent-id"),
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
  console.error(
    JSON.stringify(
      {
        ok: false,
        code,
        message
      },
      null,
      2
    )
  );

  process.exit(1);
}

async function resolveAssignmentTarget(installedAgentId: string | undefined) {
  if (!installedAgentId) {
    fail(
      "AGENT_ID_REQUIRED",
      "Pass the buyer-specific InstalledAgent ID using --agent-id=<installed-agent-id>."
    );
  }

  const installedAgent = await prisma.installedAgent.findUnique({
    where: {
      id: installedAgentId
    },
    include: {
      business: {
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              role: true,
              roleMemberships: {
                select: {
                  role: true
                }
              }
            }
          }
        }
      }
    }
  });

  if (!installedAgent) {
    fail(
      "INSTALLED_AGENT_NOT_FOUND",
      `No InstalledAgent was found for ${installedAgentId}.`
    );
  }

  if (!installedAgent.business) {
    fail(
      "BUSINESS_NOT_FOUND",
      "The InstalledAgent is not attached to a Business."
    );
  }

  if (!installedAgent.business.owner) {
    fail(
      "BUSINESS_OWNER_NOT_FOUND",
      "The Business does not have an owner."
    );
  }

  // Capability check, not identity: dual-role owners (e.g. an ARCHITECT who
  // self-installed their own listing) qualify through their BUSINESS role
  // membership.
  if (!userHasBusinessCapability(installedAgent.business.owner)) {
    fail(
      "INVALID_BUSINESS_OWNER",
      "The InstalledAgent owner does not have the BUSINESS capability (role or role membership)."
    );
  }

  return {
    installedAgent,
    business: installedAgent.business,
    buyer: installedAgent.business.owner
  };
}

async function main() {
  const args = parseArgs();

  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    fail(
      "TWILIO_CONFIG_MISSING",
      "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required."
    );
  }

  if (!args.phone && !args.twilioSid) {
    fail(
      "NUMBER_REQUIRED",
      "Pass an already-purchased Twilio number using --phone=+1... or --twilio-sid=PN..."
    );
  }

  const requestedPhone = args.phone ? normalizeE164(args.phone) : null;

  if (args.phone && !requestedPhone) {
    fail(
      "INVALID_PHONE",
      "--phone must be valid E.164, for example +12135550123."
    );
  }

  const forwardTo = args.forwardTo
    ? normalizeE164(args.forwardTo)
    : null;

  if (args.forwardTo && !forwardTo) {
    fail(
      "INVALID_FORWARD_TO",
      "--forward-to must be valid E.164."
    );
  }

  const {
    installedAgent,
    business,
    buyer
  } = await resolveAssignmentTarget(args.installedAgentId);

  const backendUrl = normalizeBaseUrl(
    args.backendUrl ||
      process.env.BACKEND_URL ||
      "https://triven.ai/api"
  );

  const voiceUrl =
    `${backendUrl}/architect/connectors/twilio/voice`;

  const smsUrl =
    `${backendUrl}/architect/connectors/twilio/inbound-sms`;

  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  let incoming: any;

  if (args.twilioSid) {
    if (!/^PN[0-9a-fA-F]{32}$/.test(args.twilioSid)) {
      fail(
        "INVALID_TWILIO_SID",
        "--twilio-sid must be a Twilio IncomingPhoneNumber PN SID."
      );
    }

    incoming = await client
      .incomingPhoneNumbers(args.twilioSid)
      .fetch();
  } else {
    const matches = await client.incomingPhoneNumbers.list({
      phoneNumber: requestedPhone!,
      limit: 20
    });

    incoming = matches.find(
      (item) => item.phoneNumber === requestedPhone
    );

    if (!incoming) {
      fail(
        "TWILIO_NUMBER_NOT_OWNED",
        `${requestedPhone} is not an already-purchased number in this Twilio account.`
      );
    }
  }

  const phoneNumber = normalizeE164(incoming.phoneNumber);

  if (!phoneNumber) {
    fail(
      "TWILIO_PHONE_INVALID",
      "Twilio returned an invalid phone number."
    );
  }

  if (requestedPhone && requestedPhone !== phoneNumber) {
    fail(
      "PHONE_SID_MISMATCH",
      `The supplied PN SID belongs to ${phoneNumber}, not ${requestedPhone}.`
    );
  }

  const sharedSmsNumber = normalizeE164(
    process.env.TWILIO_SHARED_SMS_NUMBER
  );

  if (sharedSmsNumber && sharedSmsNumber === phoneNumber) {
    fail(
      "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE",
      `${phoneNumber} is the shared Triven SMS sender and cannot be assigned to a buyer.`
    );
  }

  const existingPlatform =
    await prisma.platformPhoneNumber.findUnique({
      where: {
        phoneNumber
      }
    });

  if (existingPlatform?.isPlatformSmsSender) {
    fail(
      "PLATFORM_SMS_SENDER_NOT_ASSIGNABLE",
      `${phoneNumber} is marked as the platform SMS sender.`
    );
  }

  if (
    existingPlatform?.businessId &&
    existingPlatform.businessId !== business.id
  ) {
    fail(
      "NUMBER_ASSIGNED_TO_ANOTHER_BUSINESS",
      `${phoneNumber} is already assigned to another Business.`
    );
  }

  if (
    existingPlatform?.installedAgentId &&
    existingPlatform.installedAgentId !== installedAgent.id
  ) {
    fail(
      "NUMBER_ASSIGNED_TO_ANOTHER_AGENT",
      `${phoneNumber} is already assigned to another InstalledAgent.`
    );
  }

  const existingRouting =
    await prisma.businessPhoneNumber.findUnique({
      where: {
        phoneNumber
      }
    });

  if (
    existingRouting &&
    existingRouting.businessId !== business.id
  ) {
    fail(
      "NUMBER_ROUTED_TO_ANOTHER_BUSINESS",
      `${phoneNumber} already routes to another Business.`
    );
  }

  if (
    existingRouting?.installedAgentId &&
    existingRouting.installedAgentId !== installedAgent.id
  ) {
    fail(
      "NUMBER_ROUTED_TO_ANOTHER_AGENT",
      `${phoneNumber} already routes to another InstalledAgent.`
    );
  }

  const otherActiveBusinessNumber =
    await prisma.businessPhoneNumber.findFirst({
      where: {
        businessId: business.id,
        isActive: true,
        NOT: {
          phoneNumber
        }
      },
      select: {
        phoneNumber: true,
        installedAgentId: true
      }
    });

  if (otherActiveBusinessNumber) {
    fail(
      "BUSINESS_ALREADY_HAS_ACTIVE_NUMBER",
      `This Business already has active number ${otherActiveBusinessNumber.phoneNumber}.`
    );
  }

  const otherActiveAgentNumber =
    await prisma.businessPhoneNumber.findFirst({
      where: {
        installedAgentId: installedAgent.id,
        isActive: true,
        NOT: {
          phoneNumber
        }
      },
      select: {
        phoneNumber: true
      }
    });

  if (otherActiveAgentNumber) {
    fail(
      "AGENT_ALREADY_HAS_ACTIVE_NUMBER",
      `This InstalledAgent already has active number ${otherActiveAgentNumber.phoneNumber}.`
    );
  }

  const capabilities = {
    voice: Boolean(incoming.capabilities?.voice),
    sms: Boolean(incoming.capabilities?.sms),
    mms: Boolean(incoming.capabilities?.mms)
  };

  if (!capabilities.voice) {
    fail(
      "VOICE_CAPABILITY_REQUIRED",
      "The selected Twilio number does not support voice calls."
    );
  }

  const plan = {
    mode: args.apply ? "APPLY" : "DRY_RUN",
    purchaseApiCalled: false,
    buyer: {
      id: buyer.id,
      email: buyer.email
    },
    business: {
      id: business.id,
      name: business.name
    },
    installedAgent: {
      id: installedAgent.id
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
    console.log(
      "\nDry run only. Re-run the same command with --apply after checking the buyer, Business, InstalledAgent, and number."
    );
    return;
  }

  if (!args.skipTwilioWebhookUpdate) {
    await client.incomingPhoneNumbers(incoming.sid).update({
      friendlyName:
        `Triven test - ${business.name}`.slice(0, 64),
      voiceUrl,
      voiceMethod: "POST",
      smsUrl,
      smsMethod: "POST"
    });
  }

  const now = new Date();

  const result = await prisma.$transaction(
    async (tx) => {
      // Recheck inside the transaction so a repeated/manual second run is
      // rejected before either assignment row is changed.
      const activeBusinessNumber =
        await tx.businessPhoneNumber.findFirst({
          where: {
            businessId: business.id,
            isActive: true,
            NOT: {
              phoneNumber
            }
          },
          select: {
            phoneNumber: true
          }
        });

      if (activeBusinessNumber) {
        throw new Error(
          `BUSINESS_ALREADY_HAS_ACTIVE_NUMBER: This Business already has active number ${activeBusinessNumber.phoneNumber}.`
        );
      }

      const activeAgentNumber =
        await tx.businessPhoneNumber.findFirst({
          where: {
            installedAgentId: installedAgent.id,
            isActive: true,
            NOT: {
              phoneNumber
            }
          },
          select: {
            phoneNumber: true
          }
        });

      if (activeAgentNumber) {
        throw new Error(
          `AGENT_ALREADY_HAS_ACTIVE_NUMBER: This InstalledAgent already has active number ${activeAgentNumber.phoneNumber}.`
        );
      }

      const platform =
        await tx.platformPhoneNumber.upsert({
          where: {
            phoneNumber
          },
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
            buyerUserId: buyer.id,
            installedAgentId: installedAgent.id,
            assignedAt: now,
            voiceWebhookUrl: voiceUrl,
            smsWebhookUrl: smsUrl,
            webhookStatus:
              args.skipTwilioWebhookUpdate
                ? "UNKNOWN"
                : "CONFIGURED",
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
            buyerUserId: buyer.id,
            installedAgentId: installedAgent.id,
            assignedAt:
              existingPlatform?.assignedAt ?? now,
            releasedAt: null,
            voiceWebhookUrl: voiceUrl,
            smsWebhookUrl: smsUrl,
            webhookStatus:
              args.skipTwilioWebhookUpdate
                ? "UNKNOWN"
                : "CONFIGURED",
            isPlatformSmsSender: false,
            lastSyncedAt: now,
            lastError: null
          }
        });

      const routing =
        await tx.businessPhoneNumber.upsert({
          where: {
            phoneNumber
          },
          create: {
            businessId: business.id,
            installedAgentId: installedAgent.id,
            phoneNumber,
            provider: "TWILIO",
            twilioPhoneNumberSid: incoming.sid,
            forwardToPhone: forwardTo,
            isActive: true,
            configJson: {
              source:
                "ASSIGN_EXISTING_TWILIO_NUMBER_SCRIPT",
              testingOnly: true,
              assignedAt: now.toISOString()
            }
          },
          update: {
            businessId: business.id,
            installedAgentId: installedAgent.id,
            provider: "TWILIO",
            twilioPhoneNumberSid: incoming.sid,
            ...(forwardTo
              ? {
                  forwardToPhone: forwardTo
                }
              : {}),
            isActive: true,
            configJson: {
              source:
                "ASSIGN_EXISTING_TWILIO_NUMBER_SCRIPT",
              testingOnly: true,
              assignedAt: now.toISOString()
            }
          }
        });

      return {
        platform,
        routing
      };
    }
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        purchasedNewNumber: false,
        buyerEmail: buyer.email,
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
          message:
            error instanceof Error
              ? error.message
              : String(error)
        },
        null,
        2
      )
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
