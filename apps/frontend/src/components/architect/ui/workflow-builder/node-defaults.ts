import type { BuilderNodeData, NodeKind } from "./types";

export const defaultAgentName = "Missed Call Text-Back";
export const defaultAgentDescription =
  "Customer calls, no one picks up, the agent texts back in 5 seconds and captures the lead.";

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
      label: "Customer Calls",
      title: "Customer Calls",
      kind: "TRIGGER",
      icon: "phone",
      accent: "amber",
      subtitle: "When someone calls and no one picks up",
      footer: "Twilio detects the missed call instantly",
      ...overrides
    };
  }

  if (nodeKind === "ai") {
    return {
      ...base,
      label: "Personalize Text",
      title: "Personalize Text",
      kind: "AI PROCESS",
      icon: "sparkles",
      accent: "violet",
      subtitle: "Generate a caring SMS reply",
      prompt:
        "Write a friendly SMS text-back after a missed call. Apologize briefly, mention the business, and ask how we can help or book an appointment.",
      ...overrides
    };
  }

  if (nodeKind === "condition") {
    return {
      ...base,
      label: "Business Hours?",
      title: "Business Hours?",
      kind: "CONDITION",
      icon: "diamond",
      accent: "orange",
      subtitle: "Send now or queue for morning",
      condition: "8AM–6PM, Monday–Friday",
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

    return {
      ...base,
      label: "Auto Text in 5 Seconds",
      title: "Auto Text in 5 Seconds",
      kind: "ACTION",
      icon: "message",
      accent: "green",
      subtitle: "Personalized SMS goes out immediately",
      connector: "SMS",
      connectorAction: "send_sms",
      smsTo: "{{caller_number}}",
      smsBody:
        "Hi {{caller_name}}, this is {{business.name}}. Sorry we missed your call. We can help by text right now. Would you like to book an appointment or ask a quick question?",
      ...overrides
    };
  }

  return {
    ...base,
    label: "Lead Captured",
    title: "Lead Captured",
    kind: "OUTPUT",
    icon: "capture",
    accent: "blue",
    subtitle: "Book appointment, answer FAQ, or route to team",
    outputKey: "missedCallTextBackResult",
    ...overrides
  };
}
