import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { dispatchEmailJob } from "./email-queue";
import {
  addEmailSuppression,
  createOrUpdateBusinessEmailAlias,
  handleSesBounceComplaintNotification,
  handleSesInboundNotification,
  isEmailSuppressed,
  isLocalPartAvailable,
  sendBusinessEmail
} from "./ses-mail-service";

/**
 * Integration tests against the local dev database (SES stays in dry-run —
 * test/setup.ts sets SES_DRY_RUN=true, so no AWS call is ever made). All
 * fixtures carry a unique run marker and are deleted afterwards. The whole
 * suite is skipped when the database is unreachable.
 */

const RUN = `ittest-${process.pid}-${Date.now().toString(36)}`;
const alias1 = `${RUN}-smile-dental`;
const alias2 = `${RUN}-second-biz`;

let dbAvailable = false;
let bizA = "";
let bizB = "";
let userA = "";
let userB = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[email-integration] database unreachable — suite skipped");
    return;
  }

  const [ownerA, ownerB] = await Promise.all([
    prisma.user.create({ data: { email: `${RUN}-a@test.local`, role: "BUSINESS" } }),
    prisma.user.create({ data: { email: `${RUN}-b@test.local`, role: "BUSINESS" } })
  ]);
  userA = ownerA.id;
  userB = ownerB.id;

  const [a, b] = await Promise.all([
    prisma.business.create({ data: { ownerId: userA, name: `${RUN} Biz A`, type: "dental" } }),
    prisma.business.create({ data: { ownerId: userB, name: `${RUN} Biz B`, type: "salon" } })
  ]);
  bizA = a.id;
  bizB = b.id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.emailMessage.deleteMany({
    where: { OR: [{ businessId: { in: [bizA, bizB] } }, { toEmail: { contains: RUN } }, { fromEmail: { contains: RUN } }] }
  });
  await prisma.emailSuppression.deleteMany({ where: { emailAddress: { contains: RUN } } });
  await prisma.businessEmailAlias.deleteMany({ where: { businessId: { in: [bizA, bizB] } } });
  await prisma.business.deleteMany({ where: { id: { in: [bizA, bizB] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userA, userB] } } });
  await prisma.$disconnect();
}, 30_000);

describe.sequential("email integration (dev DB, SES dry-run)", () => {
  it("claims an alias and rejects the same alias for another business (concurrent)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const [first, second] = await Promise.all([
      createOrUpdateBusinessEmailAlias({
        businessId: bizA,
        buyerUserId: userA,
        localPart: alias1,
        displayName: "Biz A"
      }),
      createOrUpdateBusinessEmailAlias({
        businessId: bizB,
        buyerUserId: userB,
        localPart: alias1,
        displayName: "Biz B"
      })
    ]);

    const winners = [first, second].filter((r) => r.ok);
    expect(winners).toHaveLength(1);

    // Cross-business availability check reflects ownership.
    const owner = first.ok ? bizA : bizB;
    const other = first.ok ? bizB : bizA;
    expect(await isLocalPartAvailable(alias1, owner)).toBe(true);
    expect(await isLocalPartAvailable(alias1, other)).toBe(false);

    // Give the loser its own alias for the rest of the suite.
    const loserFix = await createOrUpdateBusinessEmailAlias({
      businessId: other,
      buyerUserId: other === bizA ? userA : userB,
      localPart: alias2,
      displayName: "Second Biz",
      forwardToEmail: `${RUN}-team@test.local`
    });
    expect(loserFix.ok).toBe(true);

    // Ensure the winner also has a forward-to for later tests.
    const winnerFix = await createOrUpdateBusinessEmailAlias({
      businessId: owner,
      buyerUserId: owner === bizA ? userA : userB,
      localPart: alias1,
      displayName: "Winner Biz",
      forwardToEmail: `${RUN}-team@test.local`
    });
    expect(winnerFix.ok).toBe(true);
  });

  it("sends only once for a duplicate idempotency key", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const key = `${RUN}:booking:1`;
    const input = {
      businessId: bizA,
      to: `${RUN}-cust@test.local`,
      subject: "Confirmation",
      textBody: "Hello",
      purpose: "BOOKING_CONFIRMATION" as const,
      idempotencyKey: key
    };

    const first = await sendBusinessEmail(input);
    const second = await sendBusinessEmail(input);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.duplicate).toBe(true);

    const rows = await prisma.emailMessage.count({ where: { idempotencyKey: key } });
    expect(rows).toBe(1);
  });

  it("routes the email through the business's own alias (From/Reply-To)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const message = await prisma.emailMessage.findFirst({
      where: { businessId: bizA, idempotencyKey: `${RUN}:booking:1` }
    });
    expect(message?.fromEmail).toContain("@reply.triven.ai");
    expect(message?.fromEmail).toContain(RUN);
    expect(message?.replyToEmail).toBe(message?.fromEmail);
  });

  it("permanent bounce creates a suppression; suppressed recipients are blocked", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const victim = `${RUN}-bounce@test.local`;

    const result = await handleSesBounceComplaintNotification({
      notificationType: "Bounce",
      bounce: { bounceType: "Permanent", bouncedRecipients: [{ emailAddress: victim }] },
      mail: { messageId: `${RUN}-ses-1` }
    });
    expect(result.handled).toBe(true);
    expect(await isEmailSuppressed(victim)).toBe(true);

    const blocked = await sendBusinessEmail({
      businessId: bizA,
      to: victim,
      subject: "should not send",
      textBody: "x",
      purpose: "CUSTOMER_FOLLOW_UP"
    });
    expect(blocked.ok).toBe(false);

    const suppressedRow = await prisma.emailMessage.findFirst({
      where: { toEmail: victim, status: "SUPPRESSED" }
    });
    expect(suppressedRow).not.toBeNull();
  });

  it("complaint creates a locked (complaint-reason) suppression", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const complainer = `${RUN}-complaint@test.local`;
    await handleSesBounceComplaintNotification({
      notificationType: "Complaint",
      complaint: { complainedRecipients: [{ emailAddress: complainer }] },
      mail: { messageId: `${RUN}-ses-2` }
    });

    const entry = await prisma.emailSuppression.findUnique({ where: { emailAddress: complainer } });
    expect(entry?.active).toBe(true);
    // Admin reactivation refuses /complain/i reasons — the lock is the reason text.
    expect(entry?.reason ?? "").toMatch(/complain/i);
  });

  it("transient bounce does NOT suppress", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const transient = `${RUN}-transient@test.local`;
    await handleSesBounceComplaintNotification({
      notificationType: "Bounce",
      bounce: { bounceType: "Transient", bouncedRecipients: [{ emailAddress: transient }] },
      mail: { messageId: `${RUN}-ses-3` }
    });
    const entry = await prisma.emailSuppression.findUnique({ where: { emailAddress: transient } });
    expect(entry).toBeNull();
  });

  it("routes inbound mail to the right business and never attaches unknown aliases", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");

    const routed = await handleSesInboundNotification({
      mail: {
        messageId: `${RUN}-inbound-1`,
        commonHeaders: { from: [`Customer <${RUN}-cust@test.local>`], subject: "Re: appointment" }
      },
      receipt: { recipients: [`${alias2}@reply.triven.ai`] },
      content: "Content-Type: text/plain\r\n\r\nSee you then"
    });
    expect(routed).toHaveLength(1);
    expect(routed[0].routed).toBe(true);
    if (routed[0].routed) {
      // alias2 belongs to whichever business lost the first claim — assert it's one of ours and consistent.
      const alias = await prisma.businessEmailAlias.findUnique({
        where: { emailAddress: `${alias2}@reply.triven.ai` }
      });
      expect(routed[0].businessId).toBe(alias?.businessId);
    }

    // Duplicate SNS delivery of the same inbound message is ignored (no second row).
    await handleSesInboundNotification({
      mail: { messageId: `${RUN}-inbound-1`, commonHeaders: { from: [`x <${RUN}-cust@test.local>`], subject: "dup" } },
      receipt: { recipients: [`${alias2}@reply.triven.ai`] }
    });
    const stored = await prisma.emailMessage.count({
      where: { sesMessageId: `${RUN}-inbound-1`, direction: "INBOUND" }
    });
    expect(stored).toBe(1);

    // Unknown alias: stored unrouted with NO business attached.
    const unknown = await handleSesInboundNotification({
      mail: { messageId: `${RUN}-inbound-2`, commonHeaders: { from: ["stranger@test.local"], subject: "?" } },
      receipt: { recipients: [`${RUN}-does-not-exist@reply.triven.ai`] }
    });
    expect(unknown[0].routed).toBe(false);
    if (!unknown[0].routed && unknown[0].messageId) {
      const row = await prisma.emailMessage.findUnique({ where: { id: unknown[0].messageId } });
      expect(row?.businessId).toBeNull();
    }
  });

  it("email sending never touches billable call usage", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    // Scoped to THIS business: a global count races with other test files
    // creating VapiCall rows concurrently on the shared dev database.
    const before = await prisma.vapiCall.count({ where: { businessId: bizA } });
    await sendBusinessEmail({
      businessId: bizA,
      to: `${RUN}-nobill@test.local`,
      subject: "no billing",
      textBody: "x",
      purpose: "CUSTOMER_FOLLOW_UP"
    });
    expect(await prisma.vapiCall.count({ where: { businessId: bizA } })).toBe(before);
  });

  it("a failing email job resolves without throwing (appointment flow stays safe)", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    // Business B... use a fresh business with NO alias — permanent config failure.
    const orphan = await prisma.business.create({
      data: { ownerId: userA, name: `${RUN} Orphan`, type: "gym" }
    });
    try {
      const result = await dispatchEmailJob({
        kind: "customer_follow_up",
        input: {
          businessId: orphan.id,
          customerEmail: `${RUN}-x@test.local`,
          businessName: "Orphan",
          idempotencyKey: null
        }
      });
      expect(result.ok).toBe(false); // permanent failure, resolved — not thrown
    } finally {
      await prisma.business.delete({ where: { id: orphan.id } });
    }
  });
});
