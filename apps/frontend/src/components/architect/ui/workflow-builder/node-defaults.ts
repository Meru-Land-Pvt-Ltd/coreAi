import type { BuilderNodeData, NodeKind } from "./types";

export const defaultAgentName = "Untitled Agent";
export const defaultAgentDescription = "Build a reusable AI agent template for businesses.";

export function defaultNodeData(
  nodeKind: NodeKind,
  overrides?: Partial<BuilderNodeData>
): BuilderNodeData {
  const base: BuilderNodeData = {
    label: "Node",
    title: "Node",
    nodeKind,
    kind: nodeKind.toUpperCase(),
    accent: "slate",
    icon: "message",
    subtitle: "",
    footer: ""
  };

  if (nodeKind === "trigger") {
    return {
      ...base,
      label: "Incoming Event",
      title: "Incoming Event",
      kind: "TRIGGER",
      icon: "phone",
      accent: "amber",
      subtitle: "Starts the workflow when a customer event happens",
      footer: "Buyer setup decides the live source",
      ...overrides
    };
  }

  if (nodeKind === "ai") {
    if (overrides?.type === "ai.llm_call") {
      return {
        ...base,
        label: "AI Brain",
        title: "AI Brain",
        kind: "AI Brain",
        icon: "sparkles",
        accent: "violet",
        subtitle: "Generate text/JSON response using an LLM model",
        llmProvider: "openai",
        llmModel: "gpt-5.4-mini",
        llmRequirements: "",
        llmSystemPrompt: "You are a helpful assistant.",
        llmPrompt: "",
        llmContext: "",
        llmTemperature: "0.7",
        llmMaxTokens: "1024",
        llmOutputFormat: "text",
        llmOutputKey: "ai.output",
        ...overrides
      };
    }

    if (overrides?.type === "ai.deepgram_stt") {
      return {
        ...base,
        label: "Deepgram STT",
        title: "Deepgram STT",
        kind: "DEEPGRAM STT",
        icon: "mic",
        accent: "violet",
        subtitle: "Transcribe audio to text with Deepgram",
        model: "nova-3",
        language: "en",
        audioSource: "",
        smartFormat: "true",
        punctuate: "true",
        diarize: "false",
        outputKey: "transcript",
        ...overrides,
        type: "ai.deepgram_stt",
        mode: "stt"
      };
    }

    if (overrides?.type === "ai.deepgram_tts") {
      return {
        ...base,
        label: "Deepgram TTS",
        title: "Deepgram TTS",
        kind: "DEEPGRAM TTS",
        icon: "mic",
        accent: "violet",
        subtitle: "Convert text to speech with Deepgram Aura",
        model: "aura-2-thalia-en",
        text: "",
        textSource: "",
        outputKey: "audio",
        ...overrides,
        type: "ai.deepgram_tts",
        mode: "tts"
      };
    }

    // Legacy unified node
    if (overrides?.type === "ai.deepgram") {
      const mode = overrides?.mode === "tts" ? "tts" : "stt";
      return {
        ...base,
        label: "Deepgram",
        title: mode === "tts" ? "Deepgram TTS" : "Deepgram STT",
        kind: mode === "tts" ? "DEEPGRAM TTS" : "DEEPGRAM STT",
        icon: "mic",
        accent: "violet",
        subtitle:
          mode === "tts"
            ? "Convert text to speech with Deepgram Aura"
            : "Transcribe audio to text with Deepgram",
        model: mode === "tts" ? "aura-2-thalia-en" : "nova-3",
        language: "en",
        audioSource: "",
        smartFormat: "true",
        punctuate: "true",
        diarize: "false",
        text: "",
        textSource: "",
        outputKey: mode === "tts" ? "audio" : "transcript",
        ...overrides,
        type: "ai.deepgram",
        mode
      };
    }

    return {
      ...base,
      label: "AI Step",
      title: "AI Step",
      kind: "AI",
      icon: "sparkles",
      accent: "violet",
      subtitle: "Understand the customer and decide the next response",
      prompt: "",
      maxTokens: "2048",
      ...overrides
    };
  }

  if (nodeKind === "condition") {
    return {
      ...base,
      label: "Rule Check",
      title: "Rule Check",
      kind: "CONDITION",
      icon: "diamond",
      accent: "orange",
      subtitle: "Route the workflow based on a rule",
      condition: "",
      ...overrides
    };
  }

  if (nodeKind === "block") {
    /* Product blocks — pre-designed sections of the customer page. The library
       overrides always supply the real title/subtitle/icon and the block's
       flattened config fields (placeholder, presets, options, kind, label). */
    return {
      ...base,
      label: "Product Section",
      title: "Product Section",
      kind: "PRODUCT",
      icon: "gallery",
      accent: "rose",
      subtitle: "A section of your customer's page",
      ...overrides
    };
  }

  if (nodeKind === "connector") {
    const connector = overrides?.connector ?? "SMS";

    if (connector === "Gmail") {
      return {
        ...base,
        label: "Read Gmail Emails",
        title: "Read Gmail Emails",
        kind: "GMAIL",
        icon: "mail",
        accent: "blue",
        subtitle: "Read, draft, or send email from a connected Gmail account",
        connector: "Gmail",
        connectorAction: "read_emails",
        gmailQuery: "newer_than:7d",
        gmailTo: "{{gmail.senderEmail}}",
        gmailSubject: "Re: {{gmail.subject}}",
        gmailBody: "{{ai.output}}",
        ...overrides
      };
    }

    if (connector === "Vapi") {
      return {
        ...base,
        label: "AI Voice Call",
        title: "AI Voice Call",
        kind: "VAPI AI",
        icon: "phone-call",
        accent: "violet",
        subtitle: "Start or continue a voice call through buyer phone setup",
        connector: "Vapi",
        connectorAction: "start_voice_call",
        vapiAssistantId: "{{business.vapiAssistantId}}",
        vapiPhoneNumberId: "{{business.vapiPhoneNumberId}}",
        ...overrides
      };
    }

    if (connector === "Google Calendar") {
      return {
        ...base,
        label: "Book Appointment",
        title: "Book Appointment",
        kind: "CALENDAR",
        icon: "calendar",
        accent: "blue",
        subtitle: "Create a Google Calendar event when the customer chooses a slot",
        connector: "Google Calendar",
        connectorAction: "book_appointment",
        calendarId: "{{business.calendarId}}",
        appointmentService: "",
        calendarSummary: "",
        calendarDescription: "",
        ...overrides
      };
    }

    if (connector === "Triven" || connector === "CoreAI") {
      return {
        ...base,
        label: "Save Lead",
        title: "Save Lead",
        kind: "TRIVEN",
        icon: "capture",
        accent: "blue",
        subtitle: "Triven platform action for leads, conversations, handoff, or workflow chaining",
        connector: "Triven",
        connectorAction: "save_lead",
        ...overrides
      };
    }

    if (connector === "WhatsApp") {
      return {
        ...base,
        label: "Send WhatsApp",
        title: "Send WhatsApp",
        kind: "WHATSAPP",
        icon: "whatsapp",
        accent: "green",
        subtitle: "Send a WhatsApp text message via Meta Cloud API",
        connector: "WhatsApp",
        connectorAction: "send_text",
        connectionId: "",
        recipient: "{{contact.phone}}",
        message: "Hello {{contact.name}}",
        ...overrides
      };
    }

    return {
      ...base,
      label: "Send SMS",
      title: "Send SMS",
      kind: "ACTION",
      icon: "message",
      accent: "green",
      subtitle: "Send a message using the buyer SMS setup",
      connector: "SMS",
      connectorAction: "send_sms",
      smsTo: "",
      smsBody: "",
      ...overrides
    };
  }

  return {
    ...base,
    label: "Flow Complete",
    title: "Flow Complete",
    kind: "OUTPUT",
    icon: "capture",
    accent: "blue",
    subtitle: "Finish the workflow or pass the result to another step",
    outputKey: "",
    ...overrides
  };
}
