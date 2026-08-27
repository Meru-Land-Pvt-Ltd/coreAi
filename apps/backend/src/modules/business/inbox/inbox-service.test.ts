import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  conversationFindFirst: vi.fn(),
  conversationFindMany: vi.fn(),
  conversationUpdate: vi.fn(),
  conversationUpdateMany: vi.fn(),
  conversationMessageCreate: vi.fn(),
  handoffCreate: vi.fn(),
  handoffUpdateMany: vi.fn(),
  teamMemberFindMany: vi.fn(),
  businessFindUnique: vi.fn(),
  businessProfileFindUnique: vi.fn(),
  transaction: vi.fn(),
  sendTrackedSms: vi.fn(),
  logActivity: vi.fn()
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    conversation: {
      findFirst: mocks.conversationFindFirst,
      findMany: mocks.conversationFindMany,
      update: mocks.conversationUpdate,
      updateMany: mocks.conversationUpdateMany
    },
    conversationMessage: { create: mocks.conversationMessageCreate },
    handoffEvent: { create: mocks.handoffCreate, updateMany: mocks.handoffUpdateMany },
    businessTeamMember: { findMany: mocks.teamMemberFindMany },
    business: { findUnique: mocks.businessFindUnique },
    businessProfile: { findUnique: mocks.businessProfileFindUnique },
    $transaction: mocks.transaction
  }
}));

vi.mock("../../notifications/sms-notification-service", () => ({
  sendTrackedSms: mocks.sendTrackedSms
}));

vi.mock("../activity-log", () => ({
  logBusinessActivity: mocks.logActivity
}));

import {
  escalateStaleWaiting,
  isAiPausedForConversation,
  requestHumanTakeover
} from "./inbox-service";

function conversationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "conv-1",
    businessId: "biz-1",
    channel: "SMS",
    customerPhone: "+15552223333",
    customerId: null,
    aiState: "AI_ACTIVE",
    assignedTeamMemberId: null,
    waitingSince: null,
    humanSince: null,
    slaEscalatedAt: null,
    ...overrides
  };
}

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  mocks.transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  mocks.conversationUpdate.mockResolvedValue(conversationRow({ aiState: "HUMAN_ACTIVE" }));
  mocks.conversationUpdateMany.mockResolvedValue({ count: 1 });
  mocks.handoffCreate.mockResolvedValue({ id: "handoff-1" });
  mocks.handoffUpdateMany.mockResolvedValue({ count: 1 });
  mocks.teamMemberFindMany.mockResolvedValue([]);
  mocks.businessFindUnique.mockResolvedValue({ name: "Bright Smiles" });
  mocks.businessProfileFindUnique.mockResolvedValue({ teamPhone: "+15550001111" });
  mocks.sendTrackedSms.mockResolvedValue({ sent: true, alreadySent: false, messageSid: "SM1" });
  mocks.conversationMessageCreate.mockResolvedValue({ id: "msg-1" });
});

describe("AI pause gate", () => {
  it("pauses the AI while waiting for or held by a human, resumes otherwise", () => {
    expect(isAiPausedForConversation({ aiState: "WAITING_FOR_HUMAN", waitingSince: new Date() })).toBe(true);
    expect(isAiPausedForConversation({ aiState: "HUMAN_ACTIVE" })).toBe(true);
    expect(isAiPausedForConversation({ aiState: "AI_ACTIVE" })).toBe(false);
  });

  it("starts helping again when nobody ever took the thread", () => {
    /* A customer must never text into permanent silence: if no person claims
       the wait, the AI comes back rather than leaving them with nobody. */
    const longAgo = new Date(Date.now() - 60 * 60 * 1000);
    expect(isAiPausedForConversation({ aiState: "WAITING_FOR_HUMAN", waitingSince: longAgo })).toBe(false);
    /* But a person actually holding the thread is never talked over. */
    expect(isAiPausedForConversation({ aiState: "HUMAN_ACTIVE", waitingSince: longAgo })).toBe(true);
    /* And a wait with no clock on it is not a reason to go quiet forever. */
    expect(isAiPausedForConversation({ aiState: "WAITING_FOR_HUMAN", waitingSince: null })).toBe(false);
    expect(isAiPausedForConversation({ aiState: "RETURNED_TO_AI" })).toBe(false);
    expect(isAiPausedForConversation({ aiState: null })).toBe(false);
  });
});

describe("requestHumanTakeover", () => {
  it("moves the thread to WAITING_FOR_HUMAN and opens a handoff record", async () => {
    mocks.conversationFindFirst.mockResolvedValue(conversationRow());

    const result = await requestHumanTakeover({
      businessId: "biz-1",
      conversationId: "conv-1",
      reason: "customer asked for a person"
    });

    expect(result.alreadyWaiting).toBe(false);
    expect(result.handoffEventId).toBe("handoff-1");
    expect(mocks.handoffCreate.mock.calls[0][0].data.channel).toBe("SMS");
    expect(mocks.handoffCreate.mock.calls[0][0].data.status).toBe("INITIATED");
  });

  it("is idempotent while already waiting or human-held", async () => {
    mocks.conversationFindFirst.mockResolvedValue(conversationRow({ aiState: "WAITING_FOR_HUMAN" }));
    const result = await requestHumanTakeover({
      businessId: "biz-1",
      conversationId: "conv-1",
      reason: "again"
    });
    expect(result.alreadyWaiting).toBe(true);
    expect(mocks.handoffCreate).not.toHaveBeenCalled();
  });

  it("tenant-guards the conversation lookup", async () => {
    mocks.conversationFindFirst.mockResolvedValue(null);
    await expect(
      requestHumanTakeover({ businessId: "biz-OTHER", conversationId: "conv-1", reason: "x" })
    ).rejects.toMatchObject({ code: "CONVERSATION_NOT_FOUND" });
  });
});

describe("SLA escalation", () => {
  it("escalates stale waiting threads exactly once", async () => {
    mocks.conversationFindMany.mockResolvedValue([
      conversationRow({ id: "conv-9", aiState: "WAITING_FOR_HUMAN", waitingSince: new Date(Date.now() - 10 * 60_000) })
    ]);
    mocks.conversationUpdateMany.mockResolvedValueOnce({ count: 1 });

    const escalated = await escalateStaleWaiting({ slaMinutes: 5 });
    expect(escalated).toBe(1);
    expect(mocks.conversationUpdateMany.mock.calls[0][0].where.slaEscalatedAt).toBe(null);
  });

  it("skips escalation when another worker already claimed it", async () => {
    mocks.conversationFindMany.mockResolvedValue([
      conversationRow({ id: "conv-9", aiState: "WAITING_FOR_HUMAN", waitingSince: new Date(Date.now() - 10 * 60_000) })
    ]);
    mocks.conversationUpdateMany.mockResolvedValueOnce({ count: 0 });
    await escalateStaleWaiting({ slaMinutes: 5 });
    // No staff notification path reached for the already-claimed row.
    expect(mocks.teamMemberFindMany).not.toHaveBeenCalled();
  });
});
