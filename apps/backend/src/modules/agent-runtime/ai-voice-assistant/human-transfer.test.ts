import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  handoffCreate: vi.fn(),
  handoffUpdate: vi.fn(),
  attemptCreate: vi.fn(),
  installedAgentFindUnique: vi.fn(),
  businessProfileFindUnique: vi.fn(),
  loadContext: vi.fn(),
  authHeader: vi.fn(),
  resolveTargets: vi.fn(),
  warmContext: vi.fn()
}));

vi.mock("../../../lib/prisma", () => ({
  prisma: {
    handoffEvent: { create: mocks.handoffCreate, update: mocks.handoffUpdate },
    handoffAttempt: { create: mocks.attemptCreate },
    installedAgent: { findUnique: mocks.installedAgentFindUnique },
    businessProfile: { findUnique: mocks.businessProfileFindUnique }
  }
}));

vi.mock("../../architect/voice-transfer-store", () => ({
  loadVoiceTransferContext: mocks.loadContext
}));

vi.mock("../../business/team/handoff-routing", () => ({
  resolveHandoffTargets: mocks.resolveTargets,
  sendWarmHandoffContext: mocks.warmContext,
  parsePendingTargets: (value: unknown) => (Array.isArray(value) ? value : [])
}));

vi.mock("../../../config/env", () => ({
  env: {
    TWILIO_ACCOUNT_SID: "ACtest",
    BACKEND_URL: "https://api.test.triven.ai",
    TWILIO_FORWARD_TIMEOUT_SECONDS: 20
  }
}));

vi.mock("../../architect/twilio-connector", () => ({
  escapeXml: (value: string) =>
    value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"),
  normalizePhoneE164: (raw?: string | null) => {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) return "";
    const digits = trimmed.replace(/\D/g, "");
    return digits.length >= 10 ? `+${digits}` : "";
  },
  twilioRestAuthHeader: mocks.authHeader
}));

import {
  buildTransferTwiml,
  resolveTransferCallerId,
  runTransferToHumanTool,
  type TransferToolContext
} from "./human-transfer";

function makeCtx(overrides: Partial<TransferToolContext> = {}): TransferToolContext {
  return {
    business: { businessId: "biz-1" },
    customerPhone: "+15552223333",
    callId: "vapi-call-1",
    executionMode: "LIVE",
    installedAgentId: "agent-1",
    ...overrides
  };
}

beforeEach(() => {
  mocks.handoffCreate.mockReset().mockResolvedValue({ id: "handoff-1" });
  mocks.handoffUpdate.mockReset().mockResolvedValue({ id: "handoff-1" });
  mocks.attemptCreate.mockReset().mockResolvedValue({ id: "attempt-1" });
  mocks.loadContext.mockReset();
  mocks.authHeader.mockReset().mockReturnValue("Basic dGVzdA==");
  // Default: no team members configured → legacy teamPhone fallback path.
  mocks.resolveTargets.mockReset().mockResolvedValue([]);
  mocks.warmContext.mockReset();
  // Default buyer config: per-agent team phone set, profile fallback differs.
  mocks.installedAgentFindUnique
    .mockReset()
    .mockResolvedValue({ configJson: { businessDetails: { teamPhone: "+15550001111" } } });
  mocks.businessProfileFindUnique.mockReset().mockResolvedValue({ teamPhone: "+15559990000" });
});

describe("runTransferToHumanTool", () => {
  it("simulates (never touches telephony) outside LIVE mode and records a SIMULATED handoff", async () => {
    const fetchImpl = vi.fn();
    const result = await runTransferToHumanTool(
      { reason: "caller asked" },
      makeCtx({ executionMode: "BUSINESS_TEST" }),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe("TRANSFER_SIMULATED");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(mocks.handoffCreate.mock.calls[0][0].data.status).toBe("SIMULATED");
    expect(mocks.handoffCreate.mock.calls[0][0].data.executionMode).toBe("BUSINESS_TEST");
  });

  it("fails closed with take-a-message instructions when no team phone is configured anywhere", async () => {
    mocks.installedAgentFindUnique.mockResolvedValue({ configJson: {} });
    mocks.businessProfileFindUnique.mockResolvedValue({ teamPhone: null });

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx());

    expect(result.success).toBe(false);
    expect(result.code).toBe("NO_TRANSFER_DESTINATION");
    expect(result.message).toContain("send_notification");
    expect(mocks.handoffCreate).not.toHaveBeenCalled();
  });

  it("resolves the destination from the DATABASE: per-agent team phone beats the profile", async () => {
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await runTransferToHumanTool({ reason: "caller asked" }, makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const twiml = decodeURIComponent(String(fetchImpl.mock.calls[0][1].body).replace(/\+/g, "%20"));
    expect(twiml).toContain("<Number>+15550001111</Number>");
    expect(twiml).not.toContain("+15559990000");
  });

  it("falls back to the business profile team phone when the agent has none", async () => {
    mocks.installedAgentFindUnique.mockResolvedValue({ configJson: { businessDetails: {} } });
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await runTransferToHumanTool({ reason: "caller asked" }, makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const twiml = decodeURIComponent(String(fetchImpl.mock.calls[0][1].body).replace(/\+/g, "%20"));
    expect(twiml).toContain("<Number>+15559990000</Number>");
  });

  it("ignores model-supplied destination numbers — prompt injection cannot redirect a call", async () => {
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await runTransferToHumanTool(
      {
        reason: "caller asked",
        destinationNumber: "+19998887777",
        department: "+19998887777",
        teamPhone: "+19998887777"
      },
      makeCtx(),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    const twiml = decodeURIComponent(String(fetchImpl.mock.calls[0][1].body).replace(/\+/g, "%20"));
    expect(twiml).not.toContain("9998887777");
    expect(twiml).toContain("<Number>+15550001111</Number>");
  });

  it("blocks a transfer that would dial the caller back", async () => {
    const result = await runTransferToHumanTool(
      { reason: "caller asked" },
      makeCtx({ customerPhone: "+15550001111" })
    );

    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSFER_LOOP_BLOCKED");
  });

  it("blocks a transfer whose destination is the business's own AI number", async () => {
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CAxyz", calledNumber: "+15550001111" });

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx());

    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSFER_LOOP_BLOCKED");
  });

  it("fails closed when the live Twilio leg is unknown (no stored context)", async () => {
    mocks.loadContext.mockResolvedValue(null);

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx());

    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSFER_UNAVAILABLE");
    expect(result.message).toContain("send_notification");
  });

  it("fails closed when Twilio credentials are missing (API-key or auth-token — either works)", async () => {
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    mocks.authHeader.mockReturnValue(null);

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx());

    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSFER_UNAVAILABLE");
  });

  it("redirects the live Twilio call and records the handoff", async () => {
    mocks.loadContext.mockResolvedValue({
      twilioCallSid: "CA123",
      calledNumber: "+15559998888",
      callerNumber: "+15552223333",
      workflowId: "wf-1"
    });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await runTransferToHumanTool(
      { reason: "caller asked for the front desk", caller_requested: true },
      makeCtx(),
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    expect(result.success).toBe(true);
    expect(result.code).toBe("TRANSFER_INITIATED");

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("/Accounts/ACtest/Calls/CA123.json");
    expect(init.headers.Authorization).toBe("Basic dGVzdA==");
    const twiml = decodeURIComponent(String(init.body).replace(/\+/g, "%20"));
    expect(twiml).toContain("transfer-result/handoff-1");

    const created = mocks.handoffCreate.mock.calls[0][0].data;
    expect(created.status).toBe("INITIATED");
    expect(created.destination).toBe("+15550001111");
    expect(created.twilioCallSid).toBe("CA123");
    expect(created.metadataJson.workflowId).toBe("wf-1");
  });

  it("marks the handoff FAILED and fails closed when Twilio rejects the redirect", async () => {
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 400 }));

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSFER_FAILED");
    expect(result.message).toContain("send_notification");
    expect(mocks.handoffUpdate.mock.calls[0][0].data.status).toBe("FAILED");
  });

  it("marks the handoff FAILED when the Twilio request itself throws", async () => {
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.success).toBe(false);
    expect(result.code).toBe("TRANSFER_FAILED");
    expect(mocks.handoffUpdate.mock.calls[0][0].data.status).toBe("FAILED");
  });
});

describe("staff-aware cascade", () => {
  it("dials the highest-priority available member and stores the rest for the cascade", async () => {
    mocks.resolveTargets.mockResolvedValue([
      { teamMemberId: "tm-1", destination: "+15551110001", displayName: "Dana" },
      { teamMemberId: "tm-2", destination: "+15551110002", displayName: "Riley" }
    ]);
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const result = await runTransferToHumanTool({ reason: "caller asked" }, makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    expect(result.success).toBe(true);
    const twiml = decodeURIComponent(String(fetchImpl.mock.calls[0][1].body).replace(/\+/g, "%20"));
    expect(twiml).toContain("<Number>+15551110001</Number>");

    const created = mocks.handoffCreate.mock.calls[0][0].data;
    expect(created.assignedTeamMemberId).toBe("tm-1");
    expect(created.attemptsCount).toBe(1);
    expect(created.metadataJson.pendingTargets).toEqual([
      { teamMemberId: "tm-2", destination: "+15551110002", displayName: "Riley" }
    ]);
    expect(mocks.attemptCreate).toHaveBeenCalledTimes(1);
    expect(mocks.warmContext).toHaveBeenCalledTimes(1);
    // Legacy teamPhone lookup is not consulted when members exist.
    expect(mocks.installedAgentFindUnique).not.toHaveBeenCalled();
  });

  it("drops a member whose phone matches the caller and keeps the cascade going", async () => {
    mocks.resolveTargets.mockResolvedValue([
      { teamMemberId: "tm-1", destination: "+15552223333", displayName: "SamePhone" },
      { teamMemberId: "tm-2", destination: "+15551110002", displayName: "Riley" }
    ]);
    mocks.loadContext.mockResolvedValue({ twilioCallSid: "CA123", calledNumber: "+15559998888" });
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    await runTransferToHumanTool({ reason: "caller asked" }, makeCtx(), {
      fetchImpl: fetchImpl as unknown as typeof fetch
    });

    const twiml = decodeURIComponent(String(fetchImpl.mock.calls[0][1].body).replace(/\+/g, "%20"));
    expect(twiml).toContain("<Number>+15551110002</Number>");
    expect(twiml).not.toContain("+15552223333");
  });
});

describe("buildTransferTwiml", () => {
  it("bridges with answerOnBridge and reports the dial result to the action URL", () => {
    const twiml = buildTransferTwiml({
      destination: "+15550001111",
      actionUrl: "https://api.test.triven.ai/architect/connectors/twilio/transfer-result/h1?a=1&b=2",
      timeoutSeconds: 20
    });

    expect(twiml).toContain('answerOnBridge="true"');
    expect(twiml).toContain('timeout="20"');
    expect(twiml).toContain("<Number>+15550001111</Number>");
    // Ampersands in the action URL must be XML-escaped or Twilio rejects the document.
    expect(twiml).toContain("a=1&amp;b=2");
    expect(twiml).toContain("<Say>");
    // Domestic default: caller-ID passthrough (no callerId attribute).
    expect(twiml).not.toContain("callerId=");
  });

  it("stamps an explicit callerId when one is provided", () => {
    const twiml = buildTransferTwiml({
      destination: "+918006045606",
      actionUrl: "https://api.test.triven.ai/x",
      timeoutSeconds: 20,
      callerId: "+17252245895"
    });
    expect(twiml).toContain('callerId="+17252245895"');
  });
});

describe("resolveTransferCallerId", () => {
  it("international destinations present the business's own Twilio number", () => {
    expect(resolveTransferCallerId("+918006045606", "+17252245895")).toBe("+17252245895");
    expect(resolveTransferCallerId("+447700900123", "+17252245895")).toBe("+17252245895");
  });

  it("domestic (+1) destinations keep caller-ID passthrough", () => {
    expect(resolveTransferCallerId("+15550001111", "+17252245895")).toBeNull();
  });

  it("degrades to passthrough when the business number is unknown", () => {
    expect(resolveTransferCallerId("+918006045606", null)).toBeNull();
  });
});
