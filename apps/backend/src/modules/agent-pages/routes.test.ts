import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Public agent-page API (triven.ai/a/<slug>): 404 unless the page is LIVE and
 * its listing APPROVED, zod 422s before any DB read, every action consumes the
 * shared rate limit (429 PAGE_LIMIT_REACHED when exhausted), chat runs the
 * sandboxed ARCHITECT_DRY_RUN engine under the architect's identity (calendar
 * availability pinned to test slots, session ids namespaced per page), and
 * /run extracts text + media from context.image_url / imagePipeline plus
 * explicit media keys in logs. Failed engine turns refund the consumed use.
 * All engines, prisma, and the limiter are mocked — same style as
 * admin/routes.test.ts.
 */

const {
  pageFindUniqueMock,
  workflowFindUniqueMock,
  remainingTodayMock,
  consumeLimitMock,
  refundLimitMock,
  conversationTestMock,
  runWorkflowTestMock,
  startPublicDemoMock
} = vi.hoisted(() => ({
  pageFindUniqueMock: vi.fn(),
  workflowFindUniqueMock: vi.fn(),
  remainingTodayMock: vi.fn(),
  consumeLimitMock: vi.fn(),
  refundLimitMock: vi.fn(),
  conversationTestMock: vi.fn(),
  runWorkflowTestMock: vi.fn(),
  startPublicDemoMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    publishedAgentPage: { findUnique: pageFindUniqueMock },
    workflowDefinition: { findUnique: workflowFindUniqueMock }
  }
}));

vi.mock("./rate-limit", () => ({
  agentPageRemainingToday: remainingTodayMock,
  consumeAgentPageLimit: consumeLimitMock,
  refundAgentPageUse: refundLimitMock
}));

vi.mock("../architect/workflow-conversation-test", () => ({
  runArchitectConversationTest: conversationTestMock
}));

vi.mock("../architect/workflow-runner", () => ({
  runWorkflowTest: runWorkflowTestMock
}));

vi.mock("../business/marketplace-demo", () => {
  class MarketplaceDemoError extends Error {
    status: 404 | 422 | 429 | 503;
    code: string;

    constructor(message: string, status: 404 | 422 | 429 | 503, code: string) {
      super(message);
      this.name = "MarketplaceDemoError";
      this.status = status;
      this.code = code;
    }
  }
  return { MarketplaceDemoError, startPublicMarketplaceDemoCall: startPublicDemoMock };
});

// Manage endpoints are covered by their own tests — keep this module graph
// to the public surface only.
vi.mock("./manage-routes", () => ({ registerAgentPageManageRoutes: () => {} }));

import { MarketplaceDemoError } from "../business/marketplace-demo";
import { agentPagesRoutes } from "./routes";

const SLUG = "smile-agent-abc123";
const VISITOR_SESSION_ID = "123e4567-e89b-42d3-a456-426614174000";

function livePage() {
  return {
    id: "page-1",
    slug: SLUG,
    listingId: "listing-1",
    workflowId: "workflow-1",
    architectUserId: "architect-1",
    template: "chat",
    headline: "Meet Smile Agent",
    welcomeMessage: "Hi! Ask me anything.",
    suggestedPrompts: ["Book a cleaning", "What are your hours?"],
    accentColor: "#f59e0b",
    status: "LIVE",
    createdAt: new Date("2026-08-01T00:00:00.000Z"),
    updatedAt: new Date("2026-08-01T00:00:00.000Z"),
    listing: {
      id: "listing-1",
      name: "Smile Agent",
      tagline: "Never miss a call again",
      shortDescription: "AI receptionist for service businesses",
      iconUrl: null,
      category: "Reception",
      pricingModel: "SUBSCRIPTION",
      priceCents: 14900,
      freeTrialEnabled: true,
      trialDays: 7,
      status: "APPROVED",
      architect: {
        fullName: "Ada Builder",
        architectProfile: {
          displayName: "Ada",
          marketplacePhotoUrl: "https://cdn.example.com/ada.png"
        }
      }
    }
  };
}

function buildApp() {
  const app = new Hono();
  app.route("/agent-pages", agentPagesRoutes);
  return app;
}

function postJson(app: Hono, path: string, body: unknown, headers?: Record<string, string>) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  pageFindUniqueMock.mockResolvedValue(livePage());
  workflowFindUniqueMock.mockResolvedValue({ workflowJson: { nodes: [], edges: [] } });
  remainingTodayMock.mockResolvedValue(20);
  consumeLimitMock.mockResolvedValue({ allowed: true, remainingToday: 12 });
  refundLimitMock.mockResolvedValue(undefined);
  conversationTestMock.mockResolvedValue({ reply: "Hello from the agent!", configError: null });
  runWorkflowTestMock.mockResolvedValue({ logs: [], context: {} });
  startPublicDemoMock.mockResolvedValue({ webCallToken: "tok-1", assistantId: "asst-1" });
});

describe("GET /agent-pages/:slug", () => {
  it("404s with AGENT_PAGE_NOT_FOUND for an unknown slug", async () => {
    pageFindUniqueMock.mockResolvedValue(null);

    const response = await buildApp().request(`/agent-pages/${SLUG}`);

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("AGENT_PAGE_NOT_FOUND");
  });

  it("404s when the listing is not APPROVED", async () => {
    const page = livePage();
    page.listing.status = "PENDING_REVIEW";
    pageFindUniqueMock.mockResolvedValue(page);

    const response = await buildApp().request(`/agent-pages/${SLUG}`);

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("AGENT_PAGE_NOT_FOUND");
  });

  it("404s when the page itself is not LIVE", async () => {
    const page = livePage();
    page.status = "DISABLED";
    pageFindUniqueMock.mockResolvedValue(page);

    const response = await buildApp().request(`/agent-pages/${SLUG}`);
    expect(response.status).toBe(404);
  });

  it("returns page + listing + architect + limits without consuming an allowance", async () => {
    remainingTodayMock.mockResolvedValue(17);

    const response = await buildApp().request(`/agent-pages/${SLUG}`, {
      headers: { "x-forwarded-for": "203.0.113.9" }
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: {
        page: { slug: string; template: string; status: string; suggestedPrompts: string[] };
        listing: { id: string; name: string; priceCents: number; pricingModel: string };
        architect: { displayName: string; photoUrl: string | null } | null;
        limits: { remainingToday: number };
      };
    };
    expect(json.data.page.slug).toBe(SLUG);
    expect(json.data.page.template).toBe("chat");
    expect(json.data.page.status).toBe("LIVE");
    expect(json.data.listing.name).toBe("Smile Agent");
    expect(json.data.listing.priceCents).toBe(14900);
    expect(json.data.architect).toEqual({
      displayName: "Ada",
      photoUrl: "https://cdn.example.com/ada.png"
    });
    expect(json.data.limits.remainingToday).toBe(17);

    expect(remainingTodayMock).toHaveBeenCalledWith("203.0.113.9", SLUG);
    expect(consumeLimitMock).not.toHaveBeenCalled();
  });

  it("falls back to the user's full name when the profile has no display name", async () => {
    const page = livePage();
    page.listing.architect.architectProfile = {
      displayName: "",
      marketplacePhotoUrl: "https://cdn.example.com/ada.png"
    } as never;
    pageFindUniqueMock.mockResolvedValue(page);

    const response = await buildApp().request(`/agent-pages/${SLUG}`);
    const json = (await response.json()) as {
      data: { architect: { displayName: string } | null };
    };
    expect(json.data.architect?.displayName).toBe("Ada Builder");
  });
});

describe("client IP resolution", () => {
  it("never trusts the client-controlled leftmost x-forwarded-for hop", async () => {
    await buildApp().request(`/agent-pages/${SLUG}`, {
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }
    });

    // Rightmost hop — appended by our own proxy — wins.
    expect(remainingTodayMock).toHaveBeenCalledWith("203.0.113.9", SLUG);
  });

  it("prefers cf-connecting-ip over x-forwarded-for", async () => {
    await buildApp().request(`/agent-pages/${SLUG}`, {
      headers: {
        "cf-connecting-ip": "198.51.100.4",
        "x-forwarded-for": "6.6.6.6, 203.0.113.9"
      }
    });

    expect(remainingTodayMock).toHaveBeenCalledWith("198.51.100.4", SLUG);
  });
});

describe("POST /agent-pages/:slug/chat", () => {
  it("422s on an empty message before touching the database", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "  " });

    expect(response.status).toBe(422);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(pageFindUniqueMock).not.toHaveBeenCalled();
    expect(conversationTestMock).not.toHaveBeenCalled();
  });

  it("422s when the message exceeds 2000 characters", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, {
      message: "a".repeat(2001)
    });
    expect(response.status).toBe(422);
  });

  it("422s when a history message exceeds 4000 characters", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, {
      message: "Hi",
      history: [{ role: "user", content: "a".repeat(4001) }]
    });
    expect(response.status).toBe(422);
    expect(pageFindUniqueMock).not.toHaveBeenCalled();
  });

  it("422s when the sessionId is not a UUID", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, {
      message: "Hi",
      sessionId: "visitor-session-1"
    });
    expect(response.status).toBe(422);
    expect(conversationTestMock).not.toHaveBeenCalled();
  });

  it("413s on an oversized body without parsing it", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, {
      message: "Hi",
      history: [{ role: "user", content: "x".repeat(300 * 1024) }]
    });

    expect(response.status).toBe(413);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
    expect(pageFindUniqueMock).not.toHaveBeenCalled();
  });

  it("404s for an unknown slug", async () => {
    pageFindUniqueMock.mockResolvedValue(null);

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "Hi" });

    expect(response.status).toBe(404);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("AGENT_PAGE_NOT_FOUND");
  });

  it("404s without consuming any allowance when the workflow row is missing", async () => {
    workflowFindUniqueMock.mockResolvedValue(null);

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "Hi" });

    expect(response.status).toBe(404);
    expect(consumeLimitMock).not.toHaveBeenCalled();
    expect(conversationTestMock).not.toHaveBeenCalled();
  });

  it("runs a sandboxed dry-run turn and returns reply + server sessionId + remainingToday", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, {
      message: "What are your hours?",
      history: [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello! How can I help?" }
      ]
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { reply: string; sessionId: string; remainingToday: number };
    };
    expect(json.data.reply).toBe("Hello from the agent!");
    expect(json.data.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(json.data.remainingToday).toBe(12);

    expect(conversationTestMock).toHaveBeenCalledTimes(1);
    expect(conversationTestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "architect-1",
        workflowId: "workflow-1",
        message: "What are your hours?",
        executionMode: "ARCHITECT_DRY_RUN",
        // Namespaced per page so visitors can never collide with the
        // architect's own builder test sessions.
        testSessionId: `page:${SLUG}:${json.data.sessionId}`,
        // Anonymous traffic must never read the architect's real calendar.
        forceTestAvailability: true
      })
    );
  });

  it("reuses a caller-provided UUID sessionId (namespaced for the engine)", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, {
      message: "Hi",
      sessionId: VISITOR_SESSION_ID
    });

    const json = (await response.json()) as { data: { sessionId: string } };
    expect(json.data.sessionId).toBe(VISITOR_SESSION_ID);
    expect(conversationTestMock).toHaveBeenCalledWith(
      expect.objectContaining({ testSessionId: `page:${SLUG}:${VISITOR_SESSION_ID}` })
    );
  });

  it("429s with PAGE_LIMIT_REACHED when the limiter is exhausted", async () => {
    consumeLimitMock.mockResolvedValue({ allowed: false, remainingToday: 0 });

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "Hi" });

    expect(response.status).toBe(429);
    const json = (await response.json()) as { code: string; error: string };
    expect(json.code).toBe("PAGE_LIMIT_REACHED");
    expect(json.error).toBe("This agent's free preview is done for today");
    expect(conversationTestMock).not.toHaveBeenCalled();
  });

  it("500s with AGENT_PAGE_CHAT_FAILED and refunds the use when the engine throws", async () => {
    conversationTestMock.mockRejectedValue(new Error("boom: internal stack details"));

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "Hi" });

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string; error: string };
    expect(json.code).toBe("AGENT_PAGE_CHAT_FAILED");
    expect(json.error).toBe("This agent had trouble replying. Please try again.");
    expect(json.error).not.toContain("boom");
    expect(refundLimitMock).toHaveBeenCalledWith("127.0.0.1", SLUG);
  });

  it("hides architect-facing config errors and refunds the use", async () => {
    conversationTestMock.mockResolvedValue({
      reply: "Select a valid test timezone before running this test.",
      configError: { code: "CALENDAR_TIMEZONE_MISSING", message: "x", remediation: "y" }
    });

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "Hi" });

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string; error: string };
    expect(json.code).toBe("AGENT_PAGE_CHAT_FAILED");
    expect(json.error).not.toContain("timezone");
    expect(refundLimitMock).toHaveBeenCalledTimes(1);
  });

  it("does not refund on success", async () => {
    await postJson(buildApp(), `/agent-pages/${SLUG}/chat`, { message: "Hi" });
    expect(refundLimitMock).not.toHaveBeenCalled();
  });
});

describe("POST /agent-pages/:slug/voice-session", () => {
  it("starts a public demo call keyed by client IP and listing id", async () => {
    const response = await buildApp().request(`/agent-pages/${SLUG}/voice-session`, {
      method: "POST",
      headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { session: { webCallToken: string } } };
    expect(json.data.session.webCallToken).toBe("tok-1");
    // Rightmost (proxy-appended) hop — the spoofable leftmost entry is ignored.
    expect(startPublicDemoMock).toHaveBeenCalledWith("203.0.113.9", "listing-1");
  });

  it("maps MarketplaceDemoError to its status/code", async () => {
    startPublicDemoMock.mockRejectedValue(
      new MarketplaceDemoError("Daily demo limit reached.", 429, "DEMO_LIMIT_REACHED")
    );

    const response = await buildApp().request(`/agent-pages/${SLUG}/voice-session`, {
      method: "POST"
    });

    expect(response.status).toBe(429);
    const json = (await response.json()) as { code: string; error: string };
    expect(json.code).toBe("DEMO_LIMIT_REACHED");
    expect(json.error).toBe("Daily demo limit reached.");
  });

  it("404s before starting anything when the page is not live", async () => {
    pageFindUniqueMock.mockResolvedValue(null);

    const response = await buildApp().request(`/agent-pages/${SLUG}/voice-session`, {
      method: "POST"
    });

    expect(response.status).toBe(404);
    expect(startPublicDemoMock).not.toHaveBeenCalled();
  });
});

describe("POST /agent-pages/:slug/run", () => {
  it("422s on a missing prompt", async () => {
    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, {});

    expect(response.status).toBe(422);
    const json = (await response.json()) as { code: string };
    expect(json.code).toBe("VALIDATION_ERROR");
    expect(runWorkflowTestMock).not.toHaveBeenCalled();
  });

  it("429s with PAGE_LIMIT_REACHED when the limiter is exhausted", async () => {
    consumeLimitMock.mockResolvedValue({ allowed: false, remainingToday: 0 });

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, { prompt: "Go" });

    expect(response.status).toBe(429);
    expect(runWorkflowTestMock).not.toHaveBeenCalled();
  });

  it("extracts media from context.image_url and imagePipeline (the real image-node output path)", async () => {
    // The runner's image node logs {..., image: "[Binary Image Data]"} — no
    // URL key — and writes the actual result (usually a data: URI) to
    // context.image_url / context.imagePipeline[nodeId].imageUrl.
    const dataUri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    runWorkflowTestMock.mockResolvedValue({
      context: {
        ai: { output: "Here is your image." },
        image_url: dataUri,
        imagePipeline: {
          img1: { label: "Generate image", imageUrl: dataUri, prompt: "a cat" },
          img2: { label: "Upscale", imageUrl: "https://cdn.example.com/cat-large.png" }
        }
      },
      logs: [
        {
          nodeId: "img1",
          label: "Generate image",
          status: "success",
          message: "ok",
          output: { prompt: "a cat", model: "gpt-image-1", image: "[Binary Image Data]" }
        }
      ]
    });

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, {
      prompt: "Draw me a cat"
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as {
      data: { output: { text: string | null; mediaUrls: string[] }; remainingToday: number };
    };
    expect(json.data.output.text).toBe("Here is your image.");
    expect(json.data.output.mediaUrls).toEqual([dataUri, "https://cdn.example.com/cat-large.png"]);
    expect(json.data.remainingToday).toBe(12);

    expect(runWorkflowTestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "architect-1",
        workflowId: "workflow-1",
        input: { message: "Draw me a cat" },
        mode: "test"
      })
    );
  });

  it("collects explicit media keys from logs but never generic url fields", async () => {
    runWorkflowTestMock.mockResolvedValue({
      context: { ai: { output: "Done." } },
      logs: [
        {
          nodeId: "vid1",
          label: "Render video",
          status: "success",
          message: "ok",
          output: {
            videoUrl: "https://cdn.example.com/clip.mp4",
            details: { mediaUrl: "https://cdn.example.com/thumb.png" }
          }
        },
        {
          nodeId: "misc1",
          label: "Other node",
          status: "success",
          message: "ok",
          output: {
            // A generic url field (booking link etc.) must never surface as media.
            url: "https://calendly.com/some-booking-link",
            imageUrl: "not-a-url",
            nested: { deeper: { mediaUrl: "https://cdn.example.com/too-deep.png" } }
          }
        }
      ]
    });

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, { prompt: "Go" });

    const json = (await response.json()) as { data: { output: { mediaUrls: string[] } } };
    expect(json.data.output.mediaUrls).toEqual(
      expect.arrayContaining(["https://cdn.example.com/clip.mp4", "https://cdn.example.com/thumb.png"])
    );
    expect(json.data.output.mediaUrls).not.toContain("https://calendly.com/some-booking-link");
    expect(json.data.output.mediaUrls).not.toContain("not-a-url");
    expect(json.data.output.mediaUrls).not.toContain("https://cdn.example.com/too-deep.png");
  });

  it("returns null text and empty media when the run produced nothing usable", async () => {
    runWorkflowTestMock.mockResolvedValue({ context: {}, logs: [] });

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, { prompt: "Go" });

    const json = (await response.json()) as {
      data: { output: { text: string | null; mediaUrls: string[] } };
    };
    expect(json.data.output.text).toBeNull();
    expect(json.data.output.mediaUrls).toEqual([]);
  });

  it("404s without consuming any allowance when the workflow row is missing", async () => {
    workflowFindUniqueMock.mockResolvedValue(null);

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, { prompt: "Go" });

    expect(response.status).toBe(404);
    expect(consumeLimitMock).not.toHaveBeenCalled();
  });

  it("500s with AGENT_PAGE_RUN_FAILED and refunds the use when the runner throws", async () => {
    runWorkflowTestMock.mockRejectedValue(new Error("runner exploded"));

    const response = await postJson(buildApp(), `/agent-pages/${SLUG}/run`, { prompt: "Go" });

    expect(response.status).toBe(500);
    const json = (await response.json()) as { code: string; error: string };
    expect(json.code).toBe("AGENT_PAGE_RUN_FAILED");
    expect(json.error).not.toContain("exploded");
    expect(refundLimitMock).toHaveBeenCalledWith("127.0.0.1", SLUG);
  });
});
