type WorkflowNodeData = {
  label?: string;
  title?: string;
  subtitle?: string;
  type?: string;
  nodeKind?: string;
  connector?: string;
  connectorAction?: string;
  smsBody?: string;
  gmailBody?: string;
  gmailSubject?: string;
  firstMessage?: string;
  prompt?: string;
  llmPrompt?: string;
  llmSystemPrompt?: string;
  appointmentService?: string;
};

type WorkflowNode = {
  data?: WorkflowNodeData;
};

type WorkflowPreviewListing = {
  name: string;
  shortDescription?: string | null;
  tagline?: string | null;
  description?: string | null;
  requiredConnectors?: string[] | null;
  workflow?: {
    description?: string | null;
    workflowJson?: {
      nodes?: WorkflowNode[] | null;
    } | null;
  } | null;
};

type PreviewChannel = "sms" | "missed-call" | "voice" | "whatsapp" | "email" | "manual";

type PreviewStep = {
  side: "agent" | "customer" | "event" | "action";
  title?: string;
  body: string;
};

type JourneyPreview = {
  channel: PreviewChannel;
  header: string;
  subheader: string;
  triggerTitle: string;
  triggerBody: string;
  steps: PreviewStep[];
};

function BotIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="10" rx="2" />
      <path d="M12 11V7" />
      <circle cx="12" cy="5" r="2" />
      <path d="M8 15h0M16 15h0" strokeWidth="2.5" />
    </svg>
  );
}

function ChannelIcon({ channel, className = "h-4 w-4" }: { channel: PreviewChannel; className?: string }) {
  if (channel === "email") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 7 9 6 9-6" />
      </svg>
    );
  }

  if (channel === "sms" || channel === "whatsapp") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-8 8H7l-4 2 1.5-4.5A8 8 0 1 1 21 12Z" />
      </svg>
    );
  }

  if (channel === "manual") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m8 5 11 7-11 7Z" />
      </svg>
    );
  }

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
    </svg>
  );
}

function cleanText(value: unknown) {
  if (typeof value !== "string") return "";
  return value
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(value: string, needles: string[]) {
  return needles.some((needle) => value.includes(needle));
}

function nodeText(node: WorkflowNode) {
  const data = node.data ?? {};
  return [
    data.type,
    data.nodeKind,
    data.connector,
    data.connectorAction,
    data.label,
    data.title,
    data.subtitle
  ]
    .map((value) => String(value ?? "").toLowerCase())
    .join(" ");
}

function inferChannel(nodes: WorkflowNode[], connectors: string[]): PreviewChannel {
  const haystack = [...nodes.map(nodeText), connectors.join(" ").toLowerCase()].join(" ");

  if (includesAny(haystack, ["missed_call", "missed call", "no-answer", "no_answer"])) return "missed-call";
  if (includesAny(haystack, ["phone_call", "voice_conversation", "vapi", "voice call", "incoming call"])) return "voice";
  if (includesAny(haystack, ["whatsapp"])) return "whatsapp";
  if (includesAny(haystack, ["gmail", "email", "mail"])) return "email";
  if (includesAny(haystack, ["inbound_sms", "send_sms", "sms", "text message", "twilio"])) return "sms";
  return "manual";
}

function firstNode(nodes: WorkflowNode[], predicates: Array<(text: string) => boolean>) {
  return nodes.find((node) => {
    const text = nodeText(node);
    return predicates.some((predicate) => predicate(text));
  });
}

function fallbackPurpose(listing: WorkflowPreviewListing) {
  return (
    cleanText(listing.shortDescription) ||
    cleanText(listing.tagline) ||
    cleanText(listing.description) ||
    cleanText(listing.workflow?.description) ||
    "I can help with customer questions, follow-up, and next steps."
  );
}

function responseFromWorkflow(nodes: WorkflowNode[], listing: WorkflowPreviewListing) {
  const explicit =
    nodes
      .map((node) => cleanText(node.data?.smsBody) || cleanText(node.data?.gmailBody) || cleanText(node.data?.firstMessage))
      .find(Boolean) || "";

  if (explicit) return explicit;

  const prompt =
    nodes
      .map((node) => cleanText(node.data?.prompt) || cleanText(node.data?.llmPrompt) || cleanText(node.data?.llmSystemPrompt))
      .find(Boolean) || "";

  if (prompt) return `I'll use the configured instructions to help: ${prompt}`;
  return fallbackPurpose(listing);
}

function buildJourneyPreview(listing: WorkflowPreviewListing): JourneyPreview {
  const nodes = listing.workflow?.workflowJson?.nodes ?? [];
  const connectors = listing.requiredConnectors ?? [];
  const channel = inferChannel(nodes, connectors);
  const agentResponse = responseFromWorkflow(nodes, listing);
  const hasBooking = nodes.some((node) => includesAny(nodeText(node), ["book_appointment", "calendar", "appointment", "availability"]));
  const hasSms = nodes.some((node) => includesAny(nodeText(node), ["send_sms", "sms", "text message"]));
  const hasEmail = nodes.some((node) => includesAny(nodeText(node), ["gmail", "email", "mail"]));
  const hasLeadCapture = nodes.some((node) => includesAny(nodeText(node), ["save_lead", "capture", "lead"]));
  const smsNode = firstNode(nodes, [(text) => includesAny(text, ["send_sms", "sms"])]);
  const emailNode = firstNode(nodes, [(text) => includesAny(text, ["gmail", "email", "mail"])]);
  const bookingNode = firstNode(nodes, [(text) => includesAny(text, ["book_appointment", "calendar", "availability"])]);
  const bookingLabel = cleanText(bookingNode?.data?.appointmentService) || cleanText(bookingNode?.data?.label) || "available times";

  const baseSteps: PreviewStep[] = [];

  if (channel === "voice") {
    const greeting = cleanText(nodes.find((node) => includesAny(nodeText(node), ["voice_conversation"]))?.data?.firstMessage);
    return {
      channel,
      header: listing.name,
      subheader: "Incoming call",
      triggerTitle: "Incoming call",
      triggerBody: "Customer calls the business number.",
      steps: [
        { side: "agent", title: "AI speaks", body: greeting || `Hi, this is ${listing.name}. How can I help today?` },
        { side: "customer", body: hasBooking ? "I'd like to schedule a visit." : "I have a question about your services." },
        { side: "agent", body: hasBooking ? `I can help with ${bookingLabel}. Let me check the next openings.` : agentResponse },
        ...(hasSms ? [{ side: "action" as const, title: cleanText(smsNode?.data?.label) || "Follow-up SMS", body: cleanText(smsNode?.data?.smsBody) || "Send the configured follow-up text after the call." }] : [])
      ]
    };
  }

  if (channel === "missed-call") {
    baseSteps.push({ side: "event", title: "Missed call detected", body: "The customer call was not answered." });
    if (hasSms) {
      baseSteps.push({
        side: "agent",
        title: cleanText(smsNode?.data?.label) || "Automated text-back",
        body: cleanText(smsNode?.data?.smsBody) || agentResponse
      });
    } else if (nodes.some((node) => includesAny(nodeText(node), ["vapi", "voice call", "callback"]))) {
      baseSteps.push({ side: "action", title: "Callback triggered", body: agentResponse });
    } else {
      baseSteps.push({ side: "action", title: "Workflow action", body: agentResponse });
    }
  } else if (channel === "email") {
    baseSteps.push({ side: "customer", title: "Incoming email", body: cleanText(emailNode?.data?.gmailSubject) || "Question about your services" });
    baseSteps.push({ side: "agent", title: cleanText(emailNode?.data?.label) || "AI email response", body: cleanText(emailNode?.data?.gmailBody) || agentResponse });
  } else if (channel === "sms" || channel === "whatsapp") {
    baseSteps.push({ side: "customer", title: channel === "whatsapp" ? "Incoming WhatsApp" : "Incoming SMS", body: hasBooking ? "Hi, can I book an appointment?" : "Hi, can you help me with this?" });
    baseSteps.push({ side: "agent", title: cleanText(smsNode?.data?.label) || "AI reply", body: cleanText(smsNode?.data?.smsBody) || agentResponse });
  } else {
    baseSteps.push({ side: "event", title: "Manual trigger", body: "A workflow run starts from the configured trigger." });
    baseSteps.push({ side: "agent", title: "AI processing", body: agentResponse });
  }

  if (hasBooking) {
    baseSteps.push({ side: "action", title: cleanText(bookingNode?.data?.label) || "Booking step", body: `Offer ${bookingLabel} and continue the configured scheduling flow.` });
  }

  if (hasLeadCapture) {
    baseSteps.push({ side: "action", title: "Lead saved", body: "Store the customer and conversation details in Triven." });
  }

  return {
    channel,
    header: listing.name,
    subheader:
      channel === "missed-call"
        ? "Missed call workflow"        : channel === "email"
            ? "Email workflow"
            : channel === "whatsapp"
              ? "WhatsApp workflow"
              : channel === "sms"
                ? "SMS workflow"
                : "Workflow preview",
    triggerTitle:
      channel === "missed-call"
        ? "Missed call"
        : channel === "email"
          ? "Email received"          : channel === "whatsapp"
              ? "WhatsApp message"
              : channel === "sms"
                ? "SMS received"
                : "Trigger received",
    triggerBody:
      channel === "missed-call"
        ? "Customer call goes unanswered."
        : channel === "email"
          ? "Customer sends an email."          : channel === "whatsapp"
              ? "Customer starts a WhatsApp chat."
              : channel === "sms"
                ? "Customer sends a text message."
                : "Configured workflow trigger runs.",
    steps: baseSteps.slice(0, 5)
  };
}

function stepClass(step: PreviewStep) {
  if (step.side === "customer") return "ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-amber-500 px-3 py-2 text-[12px] font-medium leading-snug text-slate-950 shadow-sm";
  if (step.side === "event") return "max-w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-sm";
  if (step.side === "action") return "max-w-[88%] rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[12px] leading-snug text-emerald-900 shadow-sm";
  return "max-w-[86%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3 py-2 text-[12px] leading-snug text-slate-700 shadow-sm";
}

export function AgentWorkflowPreview({ listing }: { listing: WorkflowPreviewListing }) {
  const preview = buildJourneyPreview(listing);

  return (
    <div className="relative">
      <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[3rem] bg-[radial-gradient(60%_60%_at_50%_40%,rgba(245,158,11,0.12),transparent_70%)]" />

      <div className="mx-auto w-full max-w-[320px] animate-float" data-testid="agent-workflow-preview">
        <div className="rounded-[2.5rem] border border-gray-200 bg-white p-2.5 shadow-2xl">
          <div className="overflow-hidden rounded-[2rem] bg-gray-50">
            <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[10px] font-semibold text-slate-500">
              <span>9:41</span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">5G</span>
            </div>

            <div className="flex items-center gap-2 border-b border-gray-100 bg-white px-4 py-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <BotIcon />
              </span>
              <div className="min-w-0">
                <div className="truncate text-xs font-semibold text-slate-900">{preview.header}</div>
                <div className="text-[10px] text-slate-500">{preview.subheader}</div>
              </div>
              <span className="ml-auto flex h-2 w-2 rounded-full bg-emerald-500" />
            </div>

            <div className="px-4 pt-4 pb-2">
              <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-3 py-2 shadow-sm">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <ChannelIcon channel={preview.channel} />
                </span>
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-900">{preview.triggerTitle}</div>
                  <div className="truncate text-[11px] text-slate-500">{preview.triggerBody}</div>
                </div>
              </div>
            </div>

            <div className="space-y-3 px-4 py-3">
              {preview.steps.map((step, index) => (
                <div key={`${step.side}-${index}`} className={step.side === "customer" ? "flex justify-end" : "flex"}>
                  <div className={stepClass(step)}>
                    {step.title ? <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{step.title}</p> : null}
                    {step.body}
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Powered by Triven workflow config
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}



