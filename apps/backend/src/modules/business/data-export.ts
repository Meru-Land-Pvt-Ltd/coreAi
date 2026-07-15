import JSZip from "jszip";
import { prisma } from "../../lib/prisma";

/**
 * Builds a ZIP containing data owned by one business. Ownership is always
 * checked against the authenticated business user before any records load.
 * Password hashes, session tokens, OAuth tokens, and encryption material are
 * intentionally excluded.
 */
export async function buildBusinessDataExportZip(
  ownerUserId: string,
  requestedBusinessId?: string
): Promise<{ filename: string; zip: ArrayBuffer }> {
  const [user, business] = await Promise.all([
    prisma.user.findUnique({
      where: { id: ownerUserId },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        location: true,
        timezone: true,
        role: true,
        profilePhotoUrl: true,
        createdAt: true,
        updatedAt: true
      }
    }),
    prisma.business.findFirst({
      where: {
        ownerId: ownerUserId,
        ...(requestedBusinessId ? { id: requestedBusinessId } : {})
      },
      orderBy: { createdAt: "desc" },
      include: { profile: true }
    })
  ]);

  if (!user || !business) {
    throw new Error("Business not found");
  }

  const businessId = business.id;
  const [
    phoneNumbers,
    platformPhoneNumbers,
    installedAgents,
    knowledgeBases,
    conversations,
    leads,
    appointments,
    calls,
    payments,
    workflowRuns,
    emailAliases,
    emailMessages,
    smsExecutions,
    usageInvoices,
    loginHistory,
    connectors
  ] = await Promise.all([
    prisma.businessPhoneNumber.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.platformPhoneNumber.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.installedAgent.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        businessId: true,
        workflowId: true,
        listingId: true,
        name: true,
        status: true,
        configJson: true,
        createdAt: true,
        updatedAt: true,
        listing: {
          select: { id: true, name: true, description: true, category: true }
        },
        workflow: {
          select: { id: true, name: true, description: true }
        }
      }
    }),
    prisma.businessKnowledgeBase.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.conversation.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      include: { messages: { orderBy: { createdAt: "asc" } } }
    }),
    prisma.lead.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.appointment.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.vapiCall.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.payment.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      include: { listing: { select: { id: true, name: true } } }
    }),
    prisma.workflowRun.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      include: {
        nodeRuns: { orderBy: { executionOrder: "asc" } },
        contextLinks: { orderBy: { createdAt: "asc" } }
      }
    }),
    prisma.businessEmailAlias.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.emailMessage.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.smsExecution.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.businessUsageInvoice.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
      include: { lineItems: { orderBy: { createdAt: "asc" } } }
    }),
    prisma.userLoginHistory.findMany({
      where: { userId: ownerUserId },
      orderBy: { createdAt: "asc" }
    }),
    prisma.connectorCredential.findMany({
      where: { userId: ownerUserId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        provider: true,
        externalAccountEmail: true,
        scope: true,
        tokenType: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true
      }
    })
  ]);

  const generatedAt = new Date();
  const zip = new JSZip();
  const pretty = (value: unknown) => JSON.stringify(value, null, 2);

  zip.file(
    "README.txt",
    [
      "Triven - Business data export",
      `Generated: ${generatedAt.toISOString()}`,
      `Business ID: ${businessId}`,
      `Business: ${business.name}`,
      "",
      "This archive contains account and business profile data, installed agent",
      "configuration, communications, appointments, activity logs, billing data,",
      "and integration metadata belonging to this business.",
      "",
      "Security credentials, password hashes, session tokens, OAuth access and",
      "refresh tokens, and marketplace agent source definitions are excluded.",
      ""
    ].join("\n")
  );

  zip.file("account.json", pretty(user));
  zip.file("business.json", pretty(business));
  zip.file("agent-configurations.json", pretty(installedAgents));
  zip.file("knowledge-base.json", pretty(knowledgeBases));
  zip.file("phone-numbers.json", pretty({ assigned: phoneNumbers, inventory: platformPhoneNumbers }));
  zip.file("conversations.json", pretty(conversations));
  zip.file("leads.json", pretty(leads));
  zip.file("appointments.json", pretty(appointments));
  zip.file("calls.json", pretty(calls));
  zip.file("workflow-activity.json", pretty(workflowRuns));
  zip.file("email.json", pretty({ aliases: emailAliases, messages: emailMessages }));
  zip.file("sms.json", pretty(smsExecutions));
  zip.file("billing.json", pretty({ payments, usageInvoices }));
  zip.file("login-history.json", pretty(loginHistory));
  zip.file("integrations.json", pretty(connectors));

  const zipBuffer = await zip.generateAsync({ type: "arraybuffer" });
  const dateStamp = generatedAt.toISOString().slice(0, 10);

  return {
    filename: `triven-business-${businessId}-data-${dateStamp}.zip`,
    zip: zipBuffer
  };
}
