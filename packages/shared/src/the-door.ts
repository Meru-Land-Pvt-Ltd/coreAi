/**
 * THE DOOR — which way in does this agent have, and what should an architect
 * meet when they press Preview?
 *
 * The founder's ruling (2026-08-27): the old preview was born believing every
 * agent has a web page — its whole brain was "voice node? media node?
 * otherwise: chat costume." A Telegram agent got dressed as a website. And
 * beside it sat a Run button — two doors to one destination, neither honest.
 *
 * So: ONE door, and what stands behind it is a JUDGEMENT based on the
 * agent's trigger — never a costume, never a default. A page agent shows the
 * page. A Telegram agent shows "connect a test bot." An email agent offers a
 * test email. A clock agent offers one run. This function IS that judgement,
 * pure and deterministic, so the Examination Hall can grade it without a
 * model in the room.
 */

export type WayIn =
  | { kind: "page"; why: string }
  | { kind: "telegram"; why: string }
  | { kind: "email"; why: string }
  | { kind: "whatsapp"; why: string }
  | { kind: "clock"; why: string }
  | { kind: "webhook"; why: string }
  | { kind: "calendly"; why: string }
  | { kind: "empty"; why: string };

type LooseGraph = {
  nodes?: Array<{ data?: { type?: unknown } }>;
};

/** The triggers that mean "nobody visits a page — the world comes to it." */
const TRIGGER_DOORS: Array<{ type: string; kind: WayIn["kind"]; why: string }> = [
  {
    type: "trigger.telegram_message",
    kind: "telegram",
    why: "This agent answers on Telegram — its customers live in a chat app, not on a web page."
  },
  {
    type: "trigger.email_received",
    kind: "email",
    why: "This agent answers email — its customer is an inbox."
  },
  {
    type: "trigger.whatsapp_message_received",
    kind: "whatsapp",
    why: "This agent answers on WhatsApp — its customers live in a chat app."
  },
  {
    type: "trigger.schedule",
    kind: "clock",
    why: "This agent wakes on a clock — nobody is at any page when it runs."
  },
  {
    type: "trigger.webhook",
    kind: "webhook",
    why: "This agent is woken by another app delivering to its private link."
  },
  {
    type: "trigger.calendly",
    kind: "calendly",
    why: "This agent is woken by a Calendly booking event."
  }
];

/**
 * The judgement. Deterministic on purpose: the door must be the same door
 * every time the same canvas is looked at.
 */
export function wayInFor(workflowJson: unknown): WayIn {
  const nodes = ((workflowJson as LooseGraph)?.nodes ?? [])
    .map((node) => String(node?.data?.type ?? ""))
    .filter(Boolean);

  if (nodes.length === 0) {
    return { kind: "empty", why: "There is nothing on the canvas yet." };
  }

  for (const door of TRIGGER_DOORS) {
    if (nodes.includes(door.type)) return { kind: door.kind, why: door.why };
  }

  /* Everything else — a Start-here trigger, Face pieces, or a draft still
     finding its shape — is met as a page, because a person will meet it as
     a page. */
  return { kind: "page", why: "Customers meet this agent on its page." };
}
