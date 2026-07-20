import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import {
  PHONE_NUMBER_FEE_ENABLED,
  buildAgentPurchaseLineItems,
  getPhoneNumberFee,
  resolveUnbilledPhoneFee
} from "./phone-provisioning";

const RUN = `phonefee-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
let numberId = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[phone-fee-disabled.test] database unreachable — DB checks skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;

  const number = await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: `+1999${String(Date.now()).slice(-7)}`,
      e164: `+1999${String(Date.now()).slice(-7)}`,
      provider: "TWILIO",
      status: "ASSIGNED",
      buyerUserId: ownerId,
      assignedAt: new Date(),
      feeBilledAt: null
    }
  });
  numberId = number.id;
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.platformPhoneNumber.deleteMany({ where: { id: numberId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("AI Receptionist number fee is fully disabled", () => {
  it("the kill switch is off", () => {
    expect(PHONE_NUMBER_FEE_ENABLED).toBe(false);
  });

  it("getPhoneNumberFee returns zero regardless of admin pricing rows", async () => {
    if (!dbAvailable) return;
    const fee = await getPhoneNumberFee();
    expect(fee.amountCents).toBe(0);
  });

  it("an assigned, never-billed number adds NO fee to a purchase", async () => {
    if (!dbAvailable) return;
    const unbilled = await resolveUnbilledPhoneFee({ buyerUserId: ownerId });
    expect(unbilled).toBeNull();
  });

  it("a $2 listing produces a single $2 line item — the buyer total equals the listing price", async () => {
    if (!dbAvailable) return;
    const unbilled = await resolveUnbilledPhoneFee({ buyerUserId: ownerId });

    const lineItems = buildAgentPurchaseLineItems({
      agentLabel: "Any Agent",
      agentPriceCents: 200,
      phoneFee: unbilled?.fee ?? null
    });

    expect(lineItems).toEqual([{ label: "Any Agent", amountCents: 200 }]);
    expect(lineItems.reduce((sum, item) => sum + item.amountCents, 0)).toBe(200);
  });
});
