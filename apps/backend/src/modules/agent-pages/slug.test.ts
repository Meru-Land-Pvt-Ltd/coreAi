import { describe, expect, it } from "vitest";
import { buildAgentPageSlug, inferAgentPageTemplate } from "./slug";

/**
 * Pure-function coverage for the agent page slug builder and the default
 * template inference (voice > media > chat; "form" is manual-only).
 */

describe("buildAgentPageSlug", () => {
  it("lowercases, dashes non-alphanumerics, and appends the last 6 of the id", () => {
    expect(buildAgentPageSlug("Dental Front Desk AI", "cmlisting123abc456")).toBe(
      "dental-front-desk-ai-abc456"
    );
  });

  it("collapses runs of symbols and trims leading/trailing dashes", () => {
    expect(buildAgentPageSlug("  --Café & Co.!!  ", "id_999xyz")).toBe("caf-co-999xyz");
  });

  it("falls back to the id suffix alone when the name has no usable characters", () => {
    expect(buildAgentPageSlug("!!!", "abcdef123456")).toBe("123456");
  });

  it("stays unique for duplicate names via the id suffix", () => {
    const a = buildAgentPageSlug("Receptionist", "cksomeidaaaaaa");
    const b = buildAgentPageSlug("Receptionist", "cksomeidbbbbbb");
    expect(a).not.toBe(b);
  });
});

describe("inferAgentPageTemplate", () => {
  const graph = (types: string[]) => ({
    nodes: types.map((type, index) => ({ id: `n${index}`, data: { type } })),
    edges: []
  });

  it("picks voice when any node type includes voice_conversation", () => {
    expect(
      inferAgentPageTemplate(graph(["trigger.phone_call", "ai.voice_conversation", "flow.end"]))
    ).toBe("voice");
  });

  it("picks media for image generation nodes", () => {
    expect(inferAgentPageTemplate(graph(["trigger.manual", "ai.image_generation"]))).toBe("media");
  });

  it("picks media for video generation nodes", () => {
    expect(inferAgentPageTemplate(graph(["ai.video_generation"]))).toBe("media");
  });

  it("prefers voice over media when both appear", () => {
    expect(inferAgentPageTemplate(graph(["ai.image_generation", "ai.voice_conversation"]))).toBe(
      "voice"
    );
  });

  it("does not treat media message-sending nodes as media generation", () => {
    expect(
      inferAgentPageTemplate(graph(["action.send_whatsapp_image", "action.send_whatsapp_video"]))
    ).toBe("chat");
  });

  it("defaults to chat for plain conversational graphs", () => {
    expect(inferAgentPageTemplate(graph(["trigger.inbound_sms", "ai.reply"]))).toBe("chat");
  });

  it("reads the top-level node type when data.type is missing", () => {
    expect(
      inferAgentPageTemplate({ nodes: [{ id: "n0", type: "ai.voice_conversation" }] })
    ).toBe("voice");
  });

  it("defaults to chat for malformed or empty workflow JSON", () => {
    expect(inferAgentPageTemplate(null)).toBe("chat");
    expect(inferAgentPageTemplate(undefined)).toBe("chat");
    expect(inferAgentPageTemplate({})).toBe("chat");
    expect(inferAgentPageTemplate({ nodes: "nope" })).toBe("chat");
    expect(inferAgentPageTemplate({ nodes: [null, 42, { id: "x" }] })).toBe("chat");
  });
});
