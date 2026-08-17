import { describe, expect, it } from "vitest";
import { deriveDeclarations } from "./node-declarations";
import { BLOCK_NODE_TYPES, VOICE_NODE_TYPES } from "./node-registry";

/** Builder-shaped node: config lives flat on data, like the canvas saves it. */
function node(id: string, type: string, config: Record<string, unknown> = {}) {
  return { id, type: "coreNode", position: { x: 0, y: 0 }, data: { type, label: config.label ?? "", ...config } };
}

function edge(source: string, target: string) {
  return { id: `${source}->${target}`, source, target };
}

describe("deriveDeclarations", () => {
  it("weather-style API workflow: a {{city}} hole in the URL becomes one text ask", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.manual"),
        node("api1", "action.api_call", {
          apiMethod: "GET",
          apiUrl: "https://api.weather.com/v1/current?city={{city}}&units=metric",
          apiOutputKey: "api.response"
        }),
        node("out1", "output.result", { outputKey: "weather" })
      ],
      edges: [edge("t1", "api1"), edge("api1", "out1")]
    };

    const result = deriveDeclarations(workflow);

    expect(result.asks).toHaveLength(1);
    expect(result.asks[0]).toMatchObject({
      id: "city",
      nodeIds: ["api1"],
      label: "City",
      kind: "text",
      required: true
    });
    // The Output node relays the API reply — data renders as visuals.
    expect(result.shows).toEqual([{ nodeId: "out1", kind: "visual", label: "Output" }]);
    expect(result.shape).toBe("form");
  });

  it("MERGES: three nodes sharing {{latestMessage}} become ONE ask with three nodeIds", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.manual"),
        node("a1", "ai.context_reply", { prompt: "Answer using {{latestMessage}}" }),
        node("a2", "ai.context_reply", { prompt: "Summarize {{latestMessage}}" }),
        node("a3", "ai.context_reply", { prompt: "Translate {{latestMessage}} to Spanish" })
      ],
      edges: [edge("t1", "a1"), edge("t1", "a2"), edge("t1", "a3")]
    };

    const result = deriveDeclarations(workflow);

    expect(result.asks).toHaveLength(1);
    const ask = result.asks[0];
    expect(ask.id).toBe("latestmessage");
    expect(ask.nodeIds).toEqual(["a1", "a2", "a3"]);
    expect(ask.kind).toBe("longtext");
    expect(ask.required).toBe(true);
  });

  it("voice workflow: shape is 'voice' with zero asks — the conversation collects everything", () => {
    const workflow = {
      nodes: [
        node("call", VOICE_NODE_TYPES.phoneCallTrigger),
        node("talk", VOICE_NODE_TYPES.voiceConversation, {
          systemPrompt: "You are the receptionist for {{businessName}}."
        }),
        node("slots", VOICE_NODE_TYPES.calendarAvailability),
        node("book", VOICE_NODE_TYPES.bookAppointment),
        node("mail", VOICE_NODE_TYPES.sendEmail),
        node("end", VOICE_NODE_TYPES.endFlow)
      ],
      edges: [
        edge("call", "talk"),
        edge("talk", "slots"),
        edge("slots", "book"),
        edge("book", "mail"),
        edge("mail", "end")
      ]
    };

    const result = deriveDeclarations(workflow);

    expect(result.shape).toBe("voice");
    // customer.name / customer.phone / selected.slot / service are all produced
    // by the upstream AI Voice Conversation — nothing left to ask on a screen.
    expect(result.asks).toEqual([]);
  });

  it("inputs satisfied by an upstream node's output produce NO ask", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.manual"),
        node("api1", "action.api_call", {
          apiUrl: "https://api.example.com/data",
          apiOutputKey: "weather.data"
        }),
        node("a1", "ai.context_reply", { prompt: "Describe {{weather.data.main.temp}} nicely" })
      ],
      edges: [edge("t1", "api1"), edge("api1", "a1")]
    };

    const result = deriveDeclarations(workflow);
    expect(result.asks).toEqual([]);
  });

  it("infers choice (explicit options), file, date, email and phone kinds", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.manual"),
        node("a1", "ai.context_reply", {
          prompt: "Book {{treatment}} on {{appointmentDate}} for {{customerEmailAddress}} at {{contactPhone}}",
          treatmentChoices: ["Cleaning", "Whitening", "Checkup"]
        }),
        // Registry-required config left empty: telegramPhotoSource is a media hole.
        node("p1", "action.telegram_send_photo", {
          telegramChatIdExpression: "",
          telegramPhotoSource: ""
        })
      ],
      edges: [edge("t1", "a1"), edge("a1", "p1")]
    };

    const result = deriveDeclarations(workflow);
    const byId = new Map(result.asks.map((ask) => [ask.id, ask]));

    expect(byId.get("treatment")).toMatchObject({ kind: "choice", choices: ["Cleaning", "Whitening", "Checkup"] });
    expect(byId.get("appointmentdate")?.kind).toBe("date");
    expect(byId.get("customeremailaddress")?.kind).toBe("email");
    expect(byId.get("contactphone")?.kind).toBe("phone");
    expect(byId.get("telegramphotosource")).toMatchObject({ kind: "file", label: "Photo source" });
  });

  it("sets dependsOnNodeId when an ask shares a template with an earlier node's output", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.manual"),
        node("api1", "action.api_call", { apiUrl: "https://api.example.com/report" }),
        node("a1", "ai.context_reply", {
          prompt: "Given {{api.response}}, answer this follow-up: {{followupQuestion}}"
        })
      ],
      edges: [edge("t1", "api1"), edge("api1", "a1")]
    };

    const result = deriveDeclarations(workflow);

    expect(result.asks).toHaveLength(1);
    expect(result.asks[0]).toMatchObject({
      id: "followupquestion",
      nodeIds: ["a1"],
      dependsOnNodeId: "api1"
    });
  });

  it("product blocks on the canvas count as EXISTING answers — satisfied, never duplicated", () => {
    const workflow = {
      nodes: [
        node("box", BLOCK_NODE_TYPES.promptComposer, { placeholder: "Describe what you want…" }),
        node("brain", "ai.context_reply", { prompt: "Do this: {{latestMessage}}" }),
        node("stage", BLOCK_NODE_TYPES.outputStage, { kind: "auto", label: "Result Viewer" })
      ],
      edges: [edge("box", "brain"), edge("brain", "stage")]
    };

    const result = deriveDeclarations(workflow);

    // The ask still exists (the composer must wire it) but the Prompt Box answers it.
    expect(result.asks).toHaveLength(1);
    expect(result.asks[0]).toMatchObject({ id: "latestmessage", satisfiedByNodeId: "box" });

    // The Result Viewer is a show of its own AND absorbs the brain's end output.
    const stageShow = result.shows.find((show) => show.nodeId === "stage");
    expect(stageShow).toMatchObject({ kind: "visual", satisfiedByNodeId: "stage" });
    const brainShow = result.shows.find((show) => show.nodeId === "brain");
    expect(brainShow).toMatchObject({ kind: "text", satisfiedByNodeId: "stage" });
  });

  it("image generation at the graph end shows an image and shapes the product as 'generation'", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.manual"),
        node("img", "ai.image_generation", { prompt: "A poster of {{subject}}", model: "gemini-3.1-flash-image" })
      ],
      edges: [edge("t1", "img")]
    };

    const result = deriveDeclarations(workflow);

    expect(result.shows).toEqual([{ nodeId: "img", kind: "image", label: "Image Generation" }]);
    expect(result.shape).toBe("generation");
    expect(result.asks.map((ask) => ask.id)).toEqual(["subject"]);
  });

  it("chat-trigger workflows shape as 'conversation' and the inbound text is not an ask", () => {
    const workflow = {
      nodes: [
        node("t1", "trigger.twilio_inbound_sms"),
        node("a1", "ai.context_reply", { prompt: "Reply to {{latestMessage}} as {{businessName}}" })
      ],
      edges: [edge("t1", "a1")]
    };

    const result = deriveDeclarations(workflow);

    // latestMessage arrives with the SMS; businessName is platform context.
    expect(result.asks).toEqual([]);
    expect(result.shape).toBe("conversation");
    expect(result.shows).toEqual([{ nodeId: "a1", kind: "conversation", label: "AI Text Reply" }]);
  });

  it("tolerates garbage input", () => {
    expect(deriveDeclarations(null)).toEqual({ asks: [], shows: [], shape: "form" });
    expect(deriveDeclarations({ nodes: "nope", edges: 42 })).toEqual({ asks: [], shows: [], shape: "form" });
    expect(deriveDeclarations({ nodes: [{}, { data: null }, 7] })).toEqual({ asks: [], shows: [], shape: "form" });
  });
});
