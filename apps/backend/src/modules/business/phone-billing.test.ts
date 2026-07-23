/**
 * Phone-number fee billing (real local DB for the PlatformPhoneNumber /
 * pricing-record paths; suite skips when unreachable).
 *
 * The platform flag is OFF (PHONE_NUMBER_FEE_ENABLED=false): the default state
 * must honestly say billing is not enabled. The enabled path (test seam
 * feeEnabled:true) bills ONE TIME per assigned number via feeBilledAt — never
 * per call, never twice on retry — and purchase line items are immutable
 * value snapshots.
 */

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { calculateUsageLineItems } from "../../lib/usage-pricing";
import {
  buildAgentPurchaseLineItems,
  getPhoneNumberBillingState,
  getPhoneNumberFee,
  markPhoneNumberFeeBilled,
  PHONE_NUMBER_BILLING_DISABLED_MESSAGE,
  resolveUnbilledPhoneFee,
  type PhoneNumberFee
} from "./phone-provisioning";

const RUN = `phonebill-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let phoneServiceSeeded = false;
const createdNumberIds: string[] = [];

let phoneCounter = 0;
function uniquePhone(): string {
  phoneCounter += 1;
  return `+1999${(Date.now() % 1_000_000).toString().padStart(6, "0")}${phoneCounter}${process.pid % 10}`;
}

async function createPlatformNumber(data: {
  status: "AVAILABLE" | "ASSIGNED";
  buyerUserId?: string | null;
  feeBilledAt?: Date | null;
}) {
  const row = await prisma.platformPhoneNumber.create({
    data: {
      phoneNumber: uniquePhone(),
      status: data.status,
      buyerUserId: data.buyerUserId ?? null,
      businessId: null,
      isPlatformSmsSender: false,
      feeBilledAt: data.feeBilledAt ?? null,
      ...(data.status === "ASSIGNED" ? { assignedAt: new Date() } : {})
    }
  });
  createdNumberIds.push(row.id);
  return row;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[phone-billing.test] database unreachable — suite skipped");
    return;
  }
  phoneServiceSeeded =
    (await prisma.platformUsageService.count({
      where: { code: "phone_number", isActive: true, updatedCostMicroUsd: { gt: 0 } }
    })) > 0;
  if (!phoneServiceSeeded) {
    console.warn("[phone-billing.test] active phone_number pricing row missing — enabled-path tests skipped");
  }
}, 30_000);

afterAll(async () => {
  if (!dbAvailable) return;
  if (createdNumberIds.length > 0) {
    await prisma.platformPhoneNumber.deleteMany({ where: { id: { in: createdNumberIds } } });
  }
  await prisma.$disconnect();
});

describe("billing state", () => {
  it("flag off (the production default) → enabled:false, no amount, the honest disabled message", async () => {
    if (!dbAvailable) return;
    const state = await getPhoneNumberBillingState();
    expect(state).toMatchObject({
      enabled: false,
      cadence: "ONE_TIME_PER_ASSIGNED_NUMBER",
      amountCents: null,
      currency: "usd",
      message: PHONE_NUMBER_BILLING_DISABLED_MESSAGE
    });
  });

  it("feeEnabled:true → enabled with the real active phone_number rate and service code", async () => {
    if (!dbAvailable || !phoneServiceSeeded) return;
    const state = await getPhoneNumberBillingState({ feeEnabled: true });
    expect(state.enabled).toBe(true);
    expect(state.cadence).toBe("ONE_TIME_PER_ASSIGNED_NUMBER");
    expect(state.amountCents ?? 0).toBeGreaterThan(0);
    expect(state.serviceCode).toBe("phone_number");
    expect(state.message).toBeNull();
  });
});

describe("one-time-per-assigned-number cadence", () => {
  it("bills an assigned number exactly once — regeneration/retry never re-bills, marking is idempotent", async () => {
    if (!dbAvailable || !phoneServiceSeeded) return;
    const buyerUserId = `${RUN}-buyer-${randomUUID()}`;
    const number = await createPlatformNumber({ status: "ASSIGNED", buyerUserId });

    const unbilled = await resolveUnbilledPhoneFee({ buyerUserId, feeEnabled: true });
    expect(unbilled).not.toBeNull();
    expect(unbilled?.platformPhoneNumberId).toBe(number.id);
    expect(unbilled?.fee.amountCents ?? 0).toBeGreaterThan(0);

    await markPhoneNumberFeeBilled(number.id);
    const firstBilledAt = (
      await prisma.platformPhoneNumber.findUnique({ where: { id: number.id } })
    )?.feeBilledAt;
    expect(firstBilledAt).not.toBeNull();

    // Retry / regeneration: nothing further to bill.
    expect(await resolveUnbilledPhoneFee({ buyerUserId, feeEnabled: true })).toBeNull();

    // Marking again never moves feeBilledAt (first bill wins).
    await markPhoneNumberFeeBilled(number.id);
    const secondBilledAt = (
      await prisma.platformPhoneNumber.findUnique({ where: { id: number.id } })
    )?.feeBilledAt;
    expect(secondBilledAt?.toISOString()).toBe(firstBilledAt?.toISOString());
  });

  it("an unassigned (AVAILABLE) number never produces a fee", async () => {
    if (!dbAvailable) return;
    const buyerUserId = `${RUN}-buyer-unassigned-${randomUUID()}`;
    await createPlatformNumber({ status: "AVAILABLE", buyerUserId: null });
    expect(await resolveUnbilledPhoneFee({ buyerUserId, feeEnabled: true })).toBeNull();
  });

  it("flag off → getPhoneNumberFee is zero and resolveUnbilledPhoneFee finds nothing to bill", async () => {
    if (!dbAvailable) return;
    const buyerUserId = `${RUN}-buyer-flagoff-${randomUUID()}`;
    await createPlatformNumber({ status: "ASSIGNED", buyerUserId });

    const fee = await getPhoneNumberFee();
    expect(fee.amountCents).toBe(0);
    expect(await resolveUnbilledPhoneFee({ buyerUserId })).toBeNull();
  });
});

describe("purchase line items", () => {
  const phoneFee: PhoneNumberFee = {
    amountCents: 200,
    label: "AI Receptionist No.",
    serviceCode: "phone_number",
    pricingVersion: "svc-1@2026-07-01T00:00:00.000Z"
  };

  it("a FREE agent still bills the phone line when a positive fee applies", () => {
    const items = buildAgentPurchaseLineItems({
      agentLabel: "Free Receptionist",
      agentPriceCents: 0,
      phoneFee
    });
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ label: "Free Receptionist", amountCents: 0 });
    expect(items[1]).toMatchObject({
      label: "AI Receptionist No.",
      amountCents: 200,
      serviceCode: "phone_number",
      pricingVersion: "svc-1@2026-07-01T00:00:00.000Z"
    });
  });

  it("zero/absent fee produces no phone line", () => {
    expect(
      buildAgentPurchaseLineItems({
        agentLabel: "Agent",
        agentPriceCents: 500,
        phoneFee: { amountCents: 0, label: "AI Receptionist No." }
      })
    ).toHaveLength(1);
    expect(
      buildAgentPurchaseLineItems({ agentLabel: "Agent", agentPriceCents: 500, phoneFee: null })
    ).toHaveLength(1);
  });

  it("ten calls are never ten phone charges: PER_UNIT phone_number yields no usage line item", () => {
    const phoneService = {
      serviceId: "phone_number",
      name: "AI Receptionist No.",
      unit: "PER_UNIT" as const,
      actualCostMicroUsd: 1_000_000,
      billingCostMicroUsd: 2_000_000
    };
    for (let call = 0; call < 10; call += 1) {
      const lines = calculateUsageLineItems([phoneService], {
        durationMinutes: 3,
        smsCount: 2,
        callCount: 1
      });
      expect(lines).toHaveLength(0);
    }
  });

  it("the billed line-item snapshot survives a later pricing change (value semantics)", () => {
    const items = buildAgentPurchaseLineItems({
      agentLabel: "Agent",
      agentPriceCents: 1_000,
      phoneFee
    });
    const frozen = JSON.parse(JSON.stringify(items)) as typeof items;

    // Conceptual rate change: a NEW fee object with a different amount.
    const laterFee: PhoneNumberFee = { ...phoneFee, amountCents: 900, pricingVersion: "svc-1@2026-08-01T00:00:00.000Z" };
    const laterItems = buildAgentPurchaseLineItems({
      agentLabel: "Agent",
      agentPriceCents: 1_000,
      phoneFee: laterFee
    });

    expect(items).toEqual(frozen); // the first snapshot never moved
    expect(items[1]?.amountCents).toBe(200);
    expect(items[1]?.serviceCode).toBe("phone_number");
    expect(items[1]?.pricingVersion).toBe("svc-1@2026-07-01T00:00:00.000Z");
    expect(laterItems[1]?.amountCents).toBe(900);
  });
});
