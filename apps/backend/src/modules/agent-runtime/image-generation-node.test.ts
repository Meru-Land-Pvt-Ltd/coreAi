import { describe, expect, test, vi } from "vitest";
import { executeNode } from "./node-handlers";
import { type AgentRuntimeContext } from "./runtime-context";
import * as imageExecutor from "../ai-provider-engine/langchain/langchain-image-executor";

function createMockContext(): AgentRuntimeContext {
  return {
    mode: "architect_test",
    channel: "browser_voice",
    workflowId: "test-wf-1",
    currentNodeId: "",
    userMessage: "Generate a futuristic logo",
    history: [],
    variables: {},
    business: {
      name: "Acme AI",
      type: "Technology",
      assistantName: "Bot",
      timezone: "America/New_York",
      calendarId: "primary",
      appointmentService: "Demo",
      services: [],
      faqs: []
    },
    caller: { name: "Test User", phone: "+15555550100" },
    conversation: {
      schedulingIntent: false,
      currentContributes: false,
      ending: false,
      isQuestion: false,
      smsRequested: false,
      smsDeclined: false,
      detailsComplaint: false,
      wantsMessage: false,
      messageFollowUp: false,
      vagueQuestion: false,
      collectedName: "",
      collectedPhone: "",
      requestedService: "",
      requestedDate: "",
      lastTimeMessage: ""
    },
    turn: {
      bookedThisTurn: false,
      smsThisTurn: false,
      slotsOffered: false,
      missingVariables: [],
      endReached: false
    },
    executedNodes: [],
    toolCalls: []
  };
}

const mockProviders: any = {
  calendar: {},
  sms: {}
};

describe("Image Generation Node Runtime", () => {
  test("successfully executes text-to-image generation node and stores binary in context", async () => {
    const context = createMockContext();
    const mockImageBuffer = Buffer.from("fake-png-binary-data");

    vi.spyOn(imageExecutor, "executeImageGeneration").mockResolvedValueOnce({
      status: "success",
      capability: "image-gen",
      text: null,
      structuredOutput: null,
      imageUrl: "data:image/png;base64,ZmFrZS1wbmctYmluYXJ5LWRhdGE=",
      imageBuffer: mockImageBuffer,
      imageMimeType: "image/png",
      revisedPrompt: "A sleek futuristic neon logo of Acme AI",
      attachments: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: { inputCostUsd: 0.03, outputCostUsd: 0, totalCostUsd: 0.03, model: "imagen-3.0-generate-002" },
      conversationId: null,
      providerMetadata: {},
      providerId: "gemini-imagen",
      modelName: "imagen-3.0-generate-002",
      durationMs: 120,
      error: null
    });

    const node = {
      id: "node-img-1",
      data: {
        type: "ai.image_generation",
        label: "Logo Generator",
        prompt: "A futuristic logo for {{business.name}}",
        model: "imagen-3.0-generate-002"
      }
    };

    const result = await executeNode(node, context, mockProviders);

    expect(result.status).toBe("executed");
    expect(context.variables["image"]).toEqual(mockImageBuffer);
    expect(context.variables["prompt"]).toBe("A futuristic logo for Acme AI");
    expect(context.variables["model"]).toBe("imagen-3.0-generate-002");
    expect(context.variables["revised_prompt"]).toBe("A sleek futuristic neon logo of Acme AI");
    expect(context.variables["node.node-img-1.image"]).toEqual(mockImageBuffer);

    const logEntry = context.executedNodes.find((n) => n.nodeId === "node-img-1");
    expect(logEntry).toBeDefined();
    expect(logEntry?.status).toBe("success");
  });

  test("handles image-to-image sequential chaining using reference_image", async () => {
    const context = createMockContext();
    const baseImage = Buffer.from("base-image-binary");
    const improvedImage = Buffer.from("improved-image-binary");
    context.variables["image"] = baseImage;

    const spy = vi.spyOn(imageExecutor, "executeImageGeneration").mockResolvedValueOnce({
      status: "success",
      capability: "image-gen",
      text: null,
      structuredOutput: null,
      imageUrl: "data:image/png;base64,aW1wcm92ZWQ=",
      imageBuffer: improvedImage,
      imageMimeType: "image/png",
      revisedPrompt: "Enhanced resolution image",
      attachments: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: null,
      conversationId: null,
      providerMetadata: {},
      providerId: "gemini-imagen",
      modelName: "imagen-3.0-generate-002",
      durationMs: 100,
      error: null
    });

    const node = {
      id: "node-img-2",
      data: {
        type: "ai.image_generation",
        label: "Enhance Image",
        prompt: "Enhance lighting and sharpness",
        reference_image: "image",
        model: "imagen-3.0-generate-002"
      }
    };

    const result = await executeNode(node, context, mockProviders);

    expect(result.status).toBe("executed");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Enhance lighting and sharpness",
        referenceImage: baseImage
      })
    );
    expect(context.variables["image"]).toEqual(improvedImage);
  });

  test("executes node when prompt is omitted/empty using default fallback prompt", async () => {
    const context = createMockContext();
    const mockImageBuffer = Buffer.from("optional-prompt-image");

    const spy = vi.spyOn(imageExecutor, "executeImageGeneration").mockResolvedValueOnce({
      status: "success",
      capability: "image-gen",
      text: null,
      structuredOutput: null,
      imageUrl: "data:image/png;base64,b3B0aW9uYWw=",
      imageBuffer: mockImageBuffer,
      imageMimeType: "image/png",
      revisedPrompt: "Generate image",
      attachments: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: null,
      conversationId: null,
      providerMetadata: {},
      providerId: "gemini-imagen",
      modelName: "imagen-3.0-generate-002",
      durationMs: 80,
      error: null
    });

    const node = {
      id: "node-img-3",
      data: {
        type: "ai.image_generation",
        label: "Optional Prompt Node",
        prompt: "",
        model: "imagen-3.0-generate-002"
      }
    };

    const result = await executeNode(node, context, mockProviders);

    expect(result.status).toBe("executed");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "Generate image"
      })
    );
    expect(context.variables["image"]).toEqual(mockImageBuffer);
  });

  test("inherits prompt from previous node output when prompt is empty", async () => {
    const context = createMockContext();
    context.variables["output"] = "A futuristic cyberpunk city with neon lights";
    const mockImageBuffer = Buffer.from("inherited-prompt-image");

    const spy = vi.spyOn(imageExecutor, "executeImageGeneration").mockResolvedValueOnce({
      status: "success",
      capability: "image-gen",
      text: null,
      structuredOutput: null,
      imageUrl: "data:image/png;base64,aW5oZXJpdGVk",
      imageBuffer: mockImageBuffer,
      imageMimeType: "image/png",
      revisedPrompt: "A futuristic cyberpunk city with neon lights",
      attachments: [],
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      cost: null,
      conversationId: null,
      providerMetadata: {},
      providerId: "gemini-imagen",
      modelName: "gemini-3.1-flash-image",
      durationMs: 90,
      error: null
    });

    const node = {
      id: "node-img-4",
      data: {
        type: "ai.image_generation",
        label: "Inherited Prompt Node",
        prompt: "",
        model: "gemini-3.1-flash-image"
      }
    };

    const result = await executeNode(node, context, mockProviders);

    expect(result.status).toBe("executed");
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: "A futuristic cyberpunk city with neon lights"
      })
    );
    expect(context.variables["image"]).toEqual(mockImageBuffer);
  });
});
