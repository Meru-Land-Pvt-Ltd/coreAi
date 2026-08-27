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
  iconUrl?: string | null;
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

  if (channel === "whatsapp") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
      </svg>
    );
  }

  if (channel === "sms") {
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
    baseSteps.push({ side: "event", title: "Input", body: "A workflow run starts from the configured trigger." });
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
  if (step.side === "customer") return "ml-auto max-w-[82%] rounded-2xl rounded-br-md bg-amber-500 px-3.5 py-2.5 text-[12.5px] font-medium leading-snug text-slate-950";
  if (step.side === "event") return "max-w-full rounded-xl border border-gray-100 bg-white px-3.5 py-2.5 text-[12.5px] leading-snug text-slate-700";
  if (step.side === "action") return "max-w-[88%] rounded-xl border border-emerald-100 bg-emerald-50/80 px-3.5 py-2.5 text-[12.5px] leading-snug text-emerald-900";
  return "max-w-[86%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-3.5 py-2.5 text-[12.5px] leading-snug text-slate-700";
}

function getInitials(name: string) {
  const clean = name.replace(/[^\w\s]/g, "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "AI";
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function formatMessageBody(body: string) {
  if (body.includes("View available times")) {
    const parts = body.split("View available times");
    return (
      <>
        {parts[0]}
        <span className="font-semibold text-amber-600 underline cursor-pointer">View available times</span>
        {parts[1]}
      </>
    );
  }
  if (body.includes("view available times")) {
    const parts = body.split("view available times");
    return (
      <>
        {parts[0]}
        <span className="font-semibold text-amber-600 underline cursor-pointer">view available times</span>
        {parts[1]}
      </>
    );
  }
  return body;
}

export function AgentWorkflowPreview({ listing }: { listing: WorkflowPreviewListing }) {
  const preview = buildJourneyPreview(listing);
  const initials = getInitials(preview.header);

  const subheaderText = (() => {
    if (preview.channel === "missed-call" || preview.channel === "sms") return "Text Message · SMS";
    if (preview.channel === "whatsapp") return "WhatsApp · Chat";
    if (preview.channel === "email") return "Email · Thread";
    if (preview.channel === "voice") return "Voice Call";
    return "Workflow · Triven";
  })();

  const renderTriggerCard = () => {
    if (preview.channel === "missed-call") {
      return (
        <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3.5 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-500">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 5a2 2 0 0 1 2-2h2l2 5-2 1a11 11 0 0 0 5 5l1-2 5 2v2a2 2 0 0 1-2 2A16 16 0 0 1 3 5z" />
              <path d="M22 2l-6 6m0-6l6 6" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-[12.5px] font-semibold text-slate-900">Missed call</div>
            <div className="truncate text-[11px] text-slate-500">
              {preview.header} · just now
            </div>
          </div>
        </div>
      );
    }

    let iconBg = "bg-amber-50 text-amber-600";
    const icon = <ChannelIcon channel={preview.channel} />;
    if (preview.channel === "whatsapp") {
      iconBg = "bg-emerald-50 text-emerald-600";
    } else if (preview.channel === "email") {
      iconBg = "bg-blue-50 text-blue-600";
    } else if (preview.channel === "manual") {
      iconBg = "bg-slate-50 text-slate-600";
    }

    return (
      <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-3.5 py-2.5">
        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${iconBg}`}>
          {icon}
        </span>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold text-slate-900">{preview.triggerTitle}</div>
          <div className="truncate text-[11px] text-slate-500">{preview.triggerBody}</div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative mx-auto w-full max-w-[300px] overflow-hidden transform-gpu [backface-visibility:hidden]">
      <div className="mx-auto w-full" data-testid="agent-workflow-preview">
        <div className="rounded-[2rem] border-2 border-amber-400 bg-gradient-to-b from-slate-100 to-slate-50 p-[7px] ring-1 ring-amber-200/60 sm:rounded-[2.25rem] sm:p-2 transform-gpu [backface-visibility:hidden]">
          <div className="overflow-hidden rounded-[1.55rem] bg-white sm:rounded-[1.85rem]">
            {/* status bar */}
            <div className="flex items-center justify-between px-5 pt-3.5 pb-1 text-[10px] font-semibold tracking-wide text-slate-400">
              <span>9:41</span>
              <span className="inline-flex items-center gap-1" aria-hidden="true">
                <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2 16h3v5H2zM7 11h3v10H7zM12 7h3v14h-3zM17 3h3v18h-3z" />
                </svg>
                5G
                <svg className="h-3 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="2" y="7" width="17" height="10" rx="2" />
                  <path d="M21 10v4" />
                </svg>
              </span>
            </div>

            {/* conversation header */}
            <div className="flex items-center gap-2.5 border-b border-gray-100 bg-white px-4 py-3">
              {listing.iconUrl ? (
                <div className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-full ring-1 ring-gray-100">
                  <img src={listing.iconUrl} alt="" className="h-full w-full object-cover" />
                </div>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-[11px] font-bold text-amber-700 ring-1 ring-amber-100">
                  {initials}
                </span>
              )}
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-slate-900">{preview.header}</div>
                <div className="text-[10px] font-medium text-slate-400">{subheaderText}</div>
              </div>
            </div>

            {/* messages */}
            <div className="space-y-3 bg-gray-50/50 px-4 py-4">
              {renderTriggerCard()}

              {preview.steps.map((step, index) => (
                <div key={`${step.side}-${index}`} className={step.side === "customer" ? "flex justify-end" : "flex"}>
                  <div className={stepClass(step)}>
                    {step.title ? <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{step.title}</p> : null}
                    <p className="line-clamp-3">{formatMessageBody(step.body)}</p>
                  </div>
                </div>
              ))}

              <div className="flex items-center justify-center gap-1.5 pt-1 text-[10px] font-medium text-slate-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                Automated by Triven AI
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

