/**
 * Triven Help Center + Resources catalog.
 * Categories match /contact Help Center cards.
 * Architect-only docs: /resources/architect
 */

export type ResourceAudience = "business" | "architect" | "both";

export type ResourceCategory = {
  id: string;
  title: string;
  order: number;
  description: string;
  /** Help Center card icon key */
  icon: "rocket" | "settings" | "card" | "tool" | "shield" | "code";
  iconClass: string;
  /** business help vs architect-only hub */
  hub: "business" | "architect";
};

export type ResourceSection = {
  title: string;
  /** Longer explanatory prose (not a one-liner). */
  body: string;
  /** Optional numbered how-to steps under this section */
  steps?: string[];
  /** Optional simple example rows (label → value), shown as a compact list */
  examples?: { label: string; value: string }[];
};

export type ResourceItem = {
  id: string;
  slug: string;
  /** Question / subtitle shown in sidebar and article heading */
  title: string;
  description: string;
  category: string;
  keywords: string[];
  intro: string;
  sections: ResourceSection[];
  related?: string[];
  audience?: ResourceAudience[];
  image?: string;
  imageAlt?: string;
  /** Short pro tips shown in article details when present */
  proTips?: string[];
};

export const resourceCategories: ResourceCategory[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    order: 1,
    description: "Set up your account, install your first agent, and connect your phone.",
    icon: "rocket",
    iconClass: "bg-amber-50 text-amber-600 group-hover:bg-amber-100",
    hub: "business",
  },
  {
    id: "managing-agents",
    title: "Managing Your Agents",
    order: 2,
    description: "Pause, configure, update messages, change hours, and monitor performance.",
    icon: "settings",
    iconClass: "bg-violet-50 text-violet-600 group-hover:bg-violet-100",
    hub: "business",
  },
  {
    id: "billing-payments",
    title: "Billing & Payments",
    order: 3,
    description: "Understand your charges, download invoices, update payment method, cancel.",
    icon: "card",
    iconClass: "bg-green-50 text-green-600 group-hover:bg-green-100",
    hub: "business",
  },
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    order: 4,
    description: "Agent not responding? Messages not sending? Fix common issues here.",
    icon: "tool",
    iconClass: "bg-orange-50 text-orange-600 group-hover:bg-orange-100",
    hub: "business",
  },
  {
    id: "account-security",
    title: "Account & Security",
    order: 5,
    description: "Change password, update email, manage team access, data privacy.",
    icon: "shield",
    iconClass: "bg-blue-50 text-blue-600 group-hover:bg-blue-100",
    hub: "business",
  },
  {
    id: "for-architects",
    title: "For Architects",
    order: 6,
    description: "Building agents, publishing, payouts, and marketplace tips.",
    icon: "code",
    iconClass: "bg-teal-50 text-teal-600 group-hover:bg-teal-100",
    hub: "architect",
  },
];

/** Help Center card metadata + live article counts + routes */
export function getHelpCenterCategories() {
  return resourceCategories.map((category) => {
    const count = resources.filter((r) => r.category === category.id).length;
    const href =
      category.hub === "architect"
        ? "/resources/architect"
        : `/resources?category=${category.id}`;
    return {
      ...category,
      name: category.title,
      count: `${count} article${count === 1 ? "" : "s"}`,
      href,
    };
  });
}

export const resources: ResourceItem[] = [
  // ── Getting Started ──────────────────────────────────────────────
  {
    id: "how-to-setup",
    slug: "how-to-setup",
    title: "How to set up your first agent?",
    description: "From signup to go-live: install, verify your phone, and turn the agent on.",
    category: "getting-started",
    audience: ["business"],
    image: "/resources/banners/setup.svg",
    imageAlt: "Agent setup banner",
    keywords: ["setup", "install", "first agent", "go-live", "onboarding", "wizard"],
    intro:
      "Setup is a short wizard after you trial or purchase an agent. You confirm the phone that should ring live, teach the agent about your business, optionally connect calendar, then go live. Think of it as teaching a new front-desk hire: name, hours, services, and who to call when a human should answer.",
    sections: [
      {
        title: "What you are setting up",
        body: "Triven provisions a phone line for the agent. Callers dial that number first. Your forwarding phone is where live staff try to pick up. If nobody answers, the agent follows up by SMS (and optionally AI voice) using the business details you enter — not a generic dentist-only script.",
      },
      {
        title: "Install from the marketplace",
        body: "Create a business account, open Marketplace, and pick an agent such as AI Receptionist / Missed Call Text-Back. Start a trial or purchase, then open the agent from My Agents to launch setup.",
        steps: [
          "Sign up as Business and finish the short company profile.",
          "Open Marketplace and choose your agent.",
          "Start a trial or complete purchase.",
          "From My Agents, open the agent and launch Setup.",
        ],
      },
      {
        title: "Complete the wizard",
        body: "The wizard walks you through the pieces that make replies sound like your business. Finish hours and FAQs before you go live so the first texts feel like your front desk.",
        steps: [
          "Enter and verify your forwarding phone with the one-time code.",
          "Add business name, hours, services, and FAQs.",
          "Optionally connect Google Calendar for real bookings.",
          "Send a test SMS to yourself, then tap Go live.",
        ],
      },
    ],
    proTips: [
      "Finish hours and FAQs before go-live so the first texts sound like your front desk.",
      "Keep the forwarding phone nearby during the first day of testing.",
      "You can pause anytime without uninstalling if you need a break.",
    ],
    related: ["connect-phone", "free-tier", "how-missed-call-works"],
  },
  {
    id: "connect-phone",
    slug: "connect-your-phone",
    title: "How do I connect my phone number?",
    description: "Verify the forwarding phone Triven should ring when a human should answer.",
    category: "getting-started",
    audience: ["business"],
    image: "/resources/banners/phone.svg",
    imageAlt: "Connect phone banner",
    keywords: ["phone", "connect", "forwarding", "OTP", "number", "setup"],
    intro:
      "You do not paste Twilio API keys for the default product. Triven assigns a line for the agent; you confirm which of your phones should ring for live pickup. That split is intentional: callers reach a Triven number, your team still answers on the phone they already use.",
    sections: [
      {
        title: "What “connect phone” means",
        body: "There are two numbers in play. The agent’s Triven number is what you publish or forward from your old line. Your forwarding phone is the staff phone Triven dials first. Only the forwarding phone needs OTP verification from you.",
      },
      {
        title: "During setup",
        body: "Enter the front-desk or mobile number that should receive live calls, then confirm with the OTP. Callers who reach a person talk to your team; unanswered calls trigger the agent text-back flow.",
        steps: [
          "Open agent Setup (or phone settings).",
          "Enter the number that should ring for live pickup.",
          "Confirm the OTP sent to that phone.",
          "Place a test call to the agent number and answer once to verify.",
        ],
      },
      {
        title: "After you are live",
        body: "You can update forwarding from agent setup or phone settings later. If calls never reach your team, re-check the number, confirm the agent is not paused, and try another test call during open hours.",
      },
    ],
    proTips: [
      "Use a number that is answered during open hours for the best live-pickup rate.",
      "If you change mobiles, update forwarding before you go on vacation.",
    ],
    related: ["how-to-setup", "agent-not-responding", "change-phone-number"],
  },
  {
    id: "how-missed-call-works",
    slug: "how-missed-call-text-back-works",
    title: "How does Missed Call Text-Back work?",
    description: "What customers experience when nobody answers your Triven number.",
    category: "getting-started",
    audience: ["both"],
    image: "/resources/banners/missed-call.svg",
    imageAlt: "Missed call text-back banner",
    keywords: ["missed call", "text-back", "SMS", "receptionist", "how it works"],
    intro:
      "The flagship journey is simple for customers: call → try your team → if no answer, get a helpful SMS and optionally an AI callback. Every reply is grounded in your hours, services, and FAQs so the same agent can serve a dental office, salon, or trades shop.",
    sections: [
      {
        title: "What the customer experiences",
        body: "A caller dials your Triven number. The system tries your forwarding phone first — just like a normal ring. If a person answers, the conversation stays human. If nobody picks up, the caller gets a text that sounds like your business, not a robotic spam blast.",
      },
      {
        title: "Answered vs missed",
        body: "Triven dials your forwarding phone first. If someone answers, the agent stays out of the way. If the call rings out, is busy, fails, or is canceled, Triven captures the lead and sends a context-aware text using your hours and FAQs.",
        examples: [
          { label: "Answered", value: "Live staff talk — agent does not text" },
          { label: "No-answer / busy", value: "Lead saved + SMS text-back" },
          { label: "After-hours", value: "Honest hours + booking or callback offer" },
        ],
      },
      {
        title: "What happens next",
        body: "Customers can reply in the same thread. Depending on the agent, they may get a booking link, calendar booking, or an AI voice callback. You review leads and conversations on the dashboard so nothing important stays buried in a voicemail box.",
      },
    ],
    proTips: [
      "Pair the SMS with your public booking link for after-hours callers.",
      "Keep FAQs short and specific — “Do you take new patients?” beats a long brochure.",
    ],
    related: ["how-to-setup", "change-agent-message", "pause-agent"],
  },
  {
    id: "create-business-account",
    slug: "create-business-account",
    title: "How do I create a business account?",
    description: "Sign up, finish onboarding, and reach Marketplace and Agents.",
    category: "getting-started",
    audience: ["business"],
    image: "/resources/banners/setup.svg",
    imageAlt: "Create account banner",
    keywords: ["signup", "account", "business", "register", "onboarding"],
    intro:
      "Business accounts are for owners and teams who install agents. Architects who only build and sell should use the architect signup instead.",
    sections: [
      {
        title: "Sign up",
        body: "Choose Business signup from the site login area, verify your email, and complete the short onboarding profile about your company.",
      },
      {
        title: "What you see next",
        body: "You land in a dashboard with Marketplace to browse agents and later My Agents for setup, pause/resume, and stats.",
      },
    ],
    related: ["how-to-setup", "who-is-triven-for-business"],
  },
  {
    id: "who-is-triven-for-business",
    slug: "is-triven-right-for-my-business",
    title: "Is Triven right for my business?",
    description: "Best fit for service businesses that miss calls and want AI follow-up.",
    category: "getting-started",
    audience: ["business"],
    image: "/resources/banners/setup.svg",
    imageAlt: "Who Triven is for banner",
    keywords: ["fit", "dental", "salon", "service", "who", "overview"],
    intro:
      "Triven works well for clinics, salons, trades, law offices, gyms, and similar shops where missed calls equal lost bookings.",
    sections: [
      {
        title: "When it shines",
        body: "If customers often call after hours or while your team is busy, a Missed Call Text-Back agent recovers those conversations with SMS and optional booking.",
      },
      {
        title: "What you provide",
        body: "You supply hours, services, FAQs, and a forwarding phone. Replies stay grounded in your business — not a one-size dentist-only script.",
      },
    ],
    related: ["how-to-setup", "how-missed-call-works"],
  },
  {
    id: "try-before-buy",
    slug: "try-an-agent-before-buying",
    title: "Can I try an agent before buying?",
    description: "Use trials and demos to validate the experience first.",
    category: "getting-started",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Try before you buy banner",
    keywords: ["trial", "demo", "try", "purchase", "marketplace"],
    intro:
      "Most buyers start with a trial or demo so setup and messaging can be checked before the paid period.",
    sections: [
      {
        title: "Trial vs demo",
        body: "A marketplace demo (when offered) lets you sample the experience. A trial installs the agent so you can finish setup and test SMS on your number.",
      },
      {
        title: "After the trial",
        body: "If you keep the agent, billing continues per the listing’s price model (free, one-time, or subscription). Cancel during trial if it is not a fit.",
      },
    ],
    related: ["free-tier", "one-time-pricing", "monthly-pricing"],
  },

  // ── Managing Your Agents ─────────────────────────────────────────
  {
    id: "pause-agent",
    slug: "how-to-pause-an-agent",
    title: "How to pause an agent?",
    description: "Temporarily stop missed-call responses without uninstalling.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/message.svg",
    imageAlt: "Pause agent banner",
    keywords: ["pause", "stop", "resume", "temporarily", "deactivate"],
    intro:
      "Pause is the right tool for holidays, vacations, or short closures. Your configuration stays saved — hours, FAQs, and phone settings come back when you resume.",
    sections: [
      {
        title: "When to pause vs cancel",
        body: "Pause stops the agent from answering missed calls and sending texts, but keeps the install. Cancel ends billing. If you are closed for a long weekend, pause. If you are leaving Triven entirely, cancel.",
      },
      {
        title: "Pause and resume",
        body: "From the Dashboard or My Agents, open the agent menu and choose Pause. The agent stops responding until you Resume. Execution fees typically do not apply while paused.",
        steps: [
          "Open Dashboard or My Agents.",
          "Find the agent and open its menu.",
          "Choose Pause and confirm.",
          "When you return, choose Resume and place a quick test call.",
        ],
      },
    ],
    proTips: [
      "Prefer Pause over Cancel if you plan to return within a few weeks.",
      "Update your public booking page if callers still use an old number while paused.",
    ],
    related: ["change-agent-message", "business-hours", "cancel-subscription"],
  },
  {
    id: "change-agent-message",
    slug: "change-agent-text-message",
    title: "How do I change my agent's text message?",
    description: "Update SMS wording from Configure so future missed calls use your copy.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/message.svg",
    imageAlt: "Change SMS message banner",
    keywords: ["message", "SMS", "text", "configure", "edit", "wording"],
    intro:
      "Message edits apply to future conversations. Keep the tone friendly and name your business clearly. A good first SMS answers “who is this?” and “what should I do next?” in one short note.",
    sections: [
      {
        title: "What to put in the first SMS",
        body: "Lead with your business name, acknowledge the missed call, and offer a next step — reply here, book a link, or leave a preferred callback time. Avoid walls of text; callers are often on the move.",
      },
      {
        title: "Edit in Configure",
        body: "Open the agent gear → Configure → edit the SMS / reply fields → Save. Changes take effect on the next missed call or inbound text.",
        steps: [
          "Open the agent from My Agents.",
          "Click the gear / Configure.",
          "Edit SMS and reply wording.",
          "Save, then trigger a test missed call to yourself.",
        ],
      },
    ],
    proTips: [
      "Mention hours or a booking link in the first SMS for after-hours callers.",
      "Re-read the message out loud — if it sounds corporate, shorten it.",
    ],
    related: ["pause-agent", "knowledge-faqs", "how-missed-call-works"],
  },
  {
    id: "business-hours",
    slug: "set-business-hours",
    title: "How do I set business hours?",
    description: "Tell the agent when you are open so after-hours replies stay accurate.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/hours.svg",
    imageAlt: "Business hours banner",
    keywords: ["hours", "schedule", "after-hours", "open", "closed", "timezone"],
    intro:
      "Hours drive honest replies and better booking offers. When the agent knows you are closed, it can say so clearly and still help the caller book — instead of promising “someone will call you right back” at midnight.",
    sections: [
      {
        title: "Why hours matter",
        body: "Business hours are a decision point for many agents. Open hours often emphasize live pickup. After hours emphasize booking links, next-open windows, and optional AI callbacks. Wrong hours create distrust fast.",
      },
      {
        title: "Weekly and special hours",
        body: "In setup or business settings, set weekday open/close times and confirm your timezone. Add special hours for holidays or one-off closures so the agent does not claim you are open when you are not.",
        steps: [
          "Open agent setup or business settings.",
          "Set open/close times for each weekday.",
          "Confirm timezone (for example America/New_York).",
          "Add holiday / special hours when you close early.",
          "Save and send a test text after hours if you can.",
        ],
        examples: [
          { label: "Weekdays", value: "Mon–Fri 8:00–18:00" },
          { label: "Weekend", value: "Closed (or Sat morning only)" },
          { label: "Holiday", value: "Special hours → Closed all day" },
        ],
      },
    ],
    proTips: [
      "Update special hours the day before a holiday, not the morning of.",
      "If architects branch on hours in the workflow, your settings are what those branches evaluate.",
    ],
    related: ["how-to-setup", "change-agent-message", "connect-calendar"],
  },
  {
    id: "knowledge-faqs",
    slug: "add-faqs-and-knowledge",
    title: "How do I add FAQs and knowledge?",
    description: "Upload files and write FAQs so replies match your services.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/knowledge.svg",
    imageAlt: "FAQs and knowledge banner",
    keywords: ["FAQ", "knowledge", "upload", "services", "tone"],
    intro:
      "Good knowledge is the difference between a generic bot and your front desk. Write questions the way customers ask them — short Q&A pairs beat long marketing copy.",
    sections: [
      {
        title: "What belongs in knowledge",
        body: "Put the questions callers actually ask: new-customer policy, parking, insurance, cancellation rules, service list, and how to book. Skip brochure fluff so SMS stays accurate for your niche.",
      },
      {
        title: "FAQs and files",
        body: "In setup, list services and common questions, set tone and escalation, and upload PDFs if helpful. Re-sync when prices or policies change.",
        steps: [
          "Open the agent → Configure → Knowledge / FAQs.",
          "Add the top 5–10 caller questions with short answers.",
          "Upload optional docs if your agent supports them.",
          "Save and send a test inbound SMS with one of those questions.",
        ],
      },
    ],
    proTips: [
      "Short FAQs beat long marketing copy for accurate SMS replies.",
      "When prices change, update FAQs the same day.",
    ],
    related: ["change-agent-message", "how-to-setup", "wrong-replies"],
  },
  {
    id: "multiple-phones",
    slug: "multiple-phone-numbers",
    title: "Can I use multiple phone numbers?",
    description: "Connect more than one business number and assign agents per line.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/phone.svg",
    imageAlt: "Multiple phone numbers banner",
    keywords: ["multiple", "phone", "numbers", "assign", "second"],
    intro:
      "Yes — each installed agent can map to its own voice identity so different locations or lines stay separate. A single shared number for every business is not how Triven works.",
    sections: [
      {
        title: "Add and assign",
        body: "Go to Settings → Phone Numbers → Add Number, then assign the right agent. Each number can use different messages and hours.",
        steps: [
          "Open Settings → Phone Numbers.",
          "Add or provision a number for the location/line.",
          "Assign the matching installed agent.",
          "Test a call on that line before you publish it.",
        ],
      },
    ],
    related: ["connect-phone", "change-phone-number"],
  },
  {
    id: "view-stats",
    slug: "view-agent-stats",
    title: "How do I see calls, leads, and bookings?",
    description: "Use the dashboard and agent stats to measure recovered conversations.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/stats.svg",
    imageAlt: "Agent stats banner",
    keywords: ["stats", "dashboard", "leads", "appointments", "metrics", "revenue"],
    intro:
      "Your dashboard summarizes calls handled, SMS activity, leads, and appointments so you can prove the agent is working — not just “busy.”",
    sections: [
      {
        title: "Where to look",
        body: "Open the business dashboard for totals, then open an agent for conversation history and View Stats for deeper metrics including estimated recovered revenue where shown.",
        steps: [
          "Open the business dashboard for high-level totals.",
          "Open an agent to read recent conversations and leads.",
          "Use View Stats for deeper call / SMS / booking metrics.",
        ],
      },
    ],
    related: ["how-missed-call-works", "billing-invoices"],
  },
  {
    id: "connect-calendar",
    slug: "connect-google-calendar",
    title: "How do I connect Google Calendar?",
    description: "Let the agent create appointments on the calendar your team uses.",
    category: "managing-agents",
    audience: ["business"],
    image: "/resources/banners/calendar.svg",
    imageAlt: "Google Calendar banner",
    keywords: ["calendar", "google", "booking", "appointment", "connect"],
    intro:
      "Connecting Calendar turns good SMS threads into real appointments with confirmation texts. Keep the connected calendar aligned with the hours you publish.",
    sections: [
      {
        title: "Connect",
        body: "In setup or connectors, choose Connect Google Calendar and approve access. Disconnect anytime if you switch accounts.",
        steps: [
          "Open agent setup or Connectors.",
          "Choose Connect Google Calendar.",
          "Approve access for the calendar your team uses.",
          "Book a test appointment from a trial SMS thread.",
        ],
      },
    ],
    related: ["business-hours", "how-to-setup"],
  },

  // ── Billing & Payments ───────────────────────────────────────────
  {
    id: "free-tier",
    slug: "free-tier-pricing",
    title: "What is the free tier?",
    description: "When an agent is free to install and what still may incur usage.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Free tier pricing banner",
    keywords: ["free", "tier", "pricing", "cost", "price", "zero"],
    intro:
      "Some marketplace listings use a Free price model — you can install without a one-time agent fee. Always read the listing card for what is included.",
    sections: [
      {
        title: "Free listing vs usage",
        body: "A free agent means no purchase fee to install. Depending on the plan, call/SMS usage or platform fees may still apply after you go live. Billing & usage shows those charges clearly.",
      },
      {
        title: "Who publishes free agents",
        body: "Architects choose Free, one-time, or subscription when they publish. Free is often used for lead-gen or starter agents.",
      },
    ],
    proTips: [
      "Even on free listings, finish setup and test SMS before sharing your number publicly.",
    ],
    related: ["monthly-pricing", "one-time-pricing", "try-before-buy"],
  },
  {
    id: "monthly-pricing",
    slug: "monthly-subscription-pricing",
    title: "How does monthly pricing work?",
    description: "Subscription-style agents bill on a recurring cycle after install.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Monthly pricing banner",
    keywords: ["monthly", "subscription", "recurring", "pricing", "price", "plan"],
    intro:
      "Subscription listings renew on a schedule while the agent stays installed. You can update the card or cancel from billing settings.",
    sections: [
      {
        title: "What you pay",
        body: "After checkout (and any trial), the subscription renews monthly per the listing. Invoices appear under Billing & usage. Keep a backup payment method to avoid failed renewals.",
      },
      {
        title: "Canceling",
        body: "Cancel from Settings → Billing or the agent’s billing actions. Access continues through the paid period unless the product says otherwise.",
      },
    ],
    related: ["one-time-pricing", "free-tier", "cancel-subscription"],
  },
  {
    id: "one-time-pricing",
    slug: "one-time-agent-fee",
    title: "What is one-time pricing?",
    description: "Pay once for the agent listing, then manage any usage separately.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "One-time pricing banner",
    keywords: ["one-time", "purchase", "fee", "pricing", "buy", "price"],
    intro:
      "One-time listings charge a single agent fee at purchase (often after a trial). Usage may still appear as separate invoices.",
    sections: [
      {
        title: "Trial then fee",
        body: "Many agents start with a short trial. If you stay installed past the trial, the one-time fee is charged. Cancel during trial to avoid that charge when the listing allows it.",
      },
    ],
    related: ["free-tier", "monthly-pricing", "when-charged-after-trial"],
  },
  {
    id: "who-gets-paid",
    slug: "who-receives-my-payment",
    title: "Who receives my payment when I buy an agent?",
    description: "You pay Triven at checkout. Architects earn their share through Triven — not a separate invoice.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/split.svg",
    imageAlt: "Who receives payment banner",
    keywords: [
      "payment",
      "who gets paid",
      "checkout",
      "architect",
      "split",
      "invoice",
      "marketplace",
      "charge",
    ],
    intro:
      "When you buy or subscribe to a marketplace agent, you pay Triven — one checkout, one set of invoices. You do not send money directly to the architect. Triven runs the marketplace and pays architects their share behind the scenes.",
    sections: [
      {
        title: "The easy version",
        body: "You pick an agent, complete checkout (or start a trial), and Triven charges your card for the listing price and any usage shown on Billing & usage. The architect who built the agent is paid by Triven from that sale. You only manage payment methods and invoices inside Triven.",
        examples: [
          { label: "You (business)", value: "Pay Triven at checkout / renewals" },
          { label: "Triven", value: "Processes payment + invoices" },
          { label: "Architect", value: "Paid by Triven (their creator share)" },
        ],
      },
      {
        title: "What you might see on the bill",
        body: "Listings can be Free, one-time, or monthly. Separately, Billing & usage may show call/SMS or platform usage after you go live. Read the listing card so you know which charges apply before you install.",
        examples: [
          { label: "Agent fee", value: "One-time or monthly listing price" },
          { label: "Usage", value: "Calls / SMS / platform usage (if billed)" },
          { label: "Invoices", value: "Always under Billing & usage" },
        ],
      },
      {
        title: "Refunds and cancellations",
        body: "Cancel or request refunds through Triven (Billing & usage or support), not by contacting the architect’s personal bank. Pause an agent if you only need a short break without ending billing.",
        steps: [
          "Open Billing & usage for invoices and payment methods.",
          "Cancel from billing settings or the agent’s billing actions when needed.",
          "Contact Triven support for refund questions within the stated window.",
        ],
      },
    ],
    proTips: [
      "Save invoices from Billing & usage for your accountant — that is the official record.",
      "If a charge looks unfamiliar, match it to the agent name and date on the invoice.",
    ],
    related: ["one-time-pricing", "monthly-pricing", "billing-invoices", "cancel-subscription"],
  },
  {
    id: "when-charged-after-trial",
    slug: "when-am-i-charged-after-trial",
    title: "When will I be charged after my free trial?",
    description: "Trial timing and when the agent fee or subscription starts.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Trial billing banner",
    keywords: ["trial", "charged", "day 8", "billing", "when", "fee"],
    intro:
      "Trials usually start when you complete setup. Check the listing for exact length — commonly about seven days before the paid fee.",
    sections: [
      {
        title: "What to expect",
        body: "If you remain installed after the trial window, you are charged the listing’s one-time or subscription price. You can cancel during the trial with no agent fee when the offer allows it.",
      },
    ],
    related: ["one-time-pricing", "cancel-subscription", "try-before-buy"],
  },
  {
    id: "billing-invoices",
    slug: "download-invoices",
    title: "How do I download invoices & receipts?",
    description: "Find payment history and download PDFs for accounting.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Invoices banner",
    keywords: ["invoice", "receipt", "download", "pdf", "billing", "history"],
    intro:
      "Billing & usage is your finance home: status, usage, invoices, and payment methods.",
    sections: [
      {
        title: "Download",
        body: "Open Billing & usage, find the invoice, and download HTML/PDF as offered. Update primary or backup cards from the same area.",
      },
    ],
    related: ["monthly-pricing", "update-payment-method"],
  },
  {
    id: "update-payment-method",
    slug: "update-payment-method",
    title: "How do I update my payment method?",
    description: "Add or switch cards for renewals and usage invoices.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Payment method banner",
    keywords: ["payment", "card", "method", "update", "stripe", "backup"],
    intro:
      "Keep a valid primary card (and optionally a backup) so renewals and usage invoices succeed.",
    sections: [
      {
        title: "Change cards",
        body: "In Billing & usage, add a new method and set it as primary. Remove old cards only after the new one is confirmed.",
      },
    ],
    related: ["billing-invoices", "monthly-pricing"],
  },
  {
    id: "cancel-subscription",
    slug: "cancel-subscription-or-agent",
    title: "How do I cancel and get a refund?",
    description: "End a plan or agent install and check refund eligibility.",
    category: "billing-payments",
    audience: ["business"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Cancel subscription banner",
    keywords: ["cancel", "refund", "subscription", "stop", "unsubscribe"],
    intro:
      "Cancel from billing settings when you no longer need the agent. Refund rules depend on trial status and purchase timing.",
    sections: [
      {
        title: "Cancel",
        body: "Go to Settings → Billing → Cancel, or use the cancel action on the agent. During an active trial you typically are not charged the agent fee.",
      },
      {
        title: "Refunds",
        body: "If you are within the stated refund window after purchase (for example 30 days on some offers), contact support with the invoice date. Pause instead of cancel if you only need a short break.",
      },
    ],
    related: ["pause-agent", "when-charged-after-trial"],
  },

  // ── Troubleshooting ──────────────────────────────────────────────
  {
    id: "agent-not-responding",
    slug: "agent-not-responding",
    title: "Agent not responding — what do I check?",
    description: "Quick checks when missed calls or SMS seem offline.",
    category: "troubleshooting",
    audience: ["business"],
    image: "/resources/banners/troubleshoot.svg",
    imageAlt: "Agent not responding banner",
    keywords: ["not responding", "offline", "broken", "fix", "unresponsive"],
    intro:
      "Most “silent agent” issues are pause state, phone forwarding, or incomplete go-live — not a mystery outage.",
    sections: [
      {
        title: "Checklist",
        body: "Work through these in order. Most “silent agent” cases are fixed by pause state, phone forwarding, or finishing go-live.",
        steps: [
          "Confirm the agent is Active (not paused).",
          "Confirm the forwarding phone is still connected and verified.",
          "Confirm you completed Go live for this agent.",
          "Run Test SMS / test call from the agent page.",
          "If tests work but live missed calls do not, contact support with the time of a recent missed call.",
        ],
      },
    ],
    proTips: [
      "Note the caller’s number and approximate time — it speeds up support.",
    ],
    related: ["sms-not-sending", "pause-agent", "connect-phone"],
  },
  {
    id: "sms-not-sending",
    slug: "messages-not-sending",
    title: "My agent isn't sending text messages. What do I do?",
    description: "Fix SMS that never arrives after a missed call.",
    category: "troubleshooting",
    audience: ["business"],
    image: "/resources/banners/troubleshoot.svg",
    imageAlt: "SMS not sending banner",
    keywords: ["SMS", "not sending", "messages", "text", "test"],
    intro:
      "Start with active state and Test SMS. Carrier filtering is rare but support can check delivery if tests pass and live fails.",
    sections: [
      {
        title: "Steps",
        body: "Use this checklist when SMS never arrives after a missed call. Carrier filtering is rare — support can check delivery if every step below already passes.",
        steps: [
          "Agent is Active (not paused).",
          "Phone is connected and verified.",
          "Test button succeeds (Test SMS / test call).",
          "Customer has not opted out with STOP.",
          "Contact support if live missed calls still produce no SMS.",
        ],
      },
    ],
    related: ["agent-not-responding", "change-agent-message", "sms-opt-out"],
  },
  {
    id: "test-fails",
    slug: "test-sms-or-call-fails",
    title: "Test SMS or test call failed — why?",
    description: "Common reasons tests fail during setup.",
    category: "troubleshooting",
    audience: ["business"],
    image: "/resources/banners/troubleshoot.svg",
    imageAlt: "Test failed banner",
    keywords: ["test", "failed", "OTP", "setup", "error"],
    intro:
      "Failed tests usually mean the destination number is wrong, OTP expired, or the agent is not fully configured.",
    sections: [
      {
        title: "Retry cleanly",
        body: "Re-enter the phone in E.164 style if prompted, request a fresh OTP, save configure, then run Test again. Avoid testing against a landline that cannot receive SMS when the test expects a text.",
      },
    ],
    related: ["how-to-setup", "connect-phone"],
  },
  {
    id: "wrong-replies",
    slug: "agent-gives-wrong-answers",
    title: "The agent gives wrong answers — how do I fix it?",
    description: "Update knowledge, hours, and tone so replies stay accurate.",
    category: "troubleshooting",
    audience: ["business"],
    image: "/resources/banners/knowledge.svg",
    imageAlt: "Wrong replies banner",
    keywords: ["wrong", "incorrect", "FAQ", "knowledge", "hallucination"],
    intro:
      "Wrong answers almost always mean outdated FAQs or missing services — update knowledge and re-test.",
    sections: [
      {
        title: "Fix the source of truth",
        body: "Edit FAQs, hours, and uploaded files. Save, send yourself a test SMS with the tricky question, and adjust until the reply matches. Escalate rules should send tough cases to your team phone.",
      },
    ],
    related: ["knowledge-faqs", "business-hours", "change-agent-message"],
  },
  {
    id: "sms-opt-out",
    slug: "customer-replied-stop",
    title: "A customer replied STOP — what happens?",
    description: "Opt-out behavior and how to stay compliant.",
    category: "troubleshooting",
    audience: ["business"],
    image: "/resources/banners/message.svg",
    imageAlt: "SMS opt-out banner",
    keywords: ["STOP", "opt-out", "consent", "SMS", "HELP"],
    intro:
      "Customers can opt out of SMS with standard keywords. Respecting that keeps messaging compliant.",
    sections: [
      {
        title: "After STOP",
        body: "Triven should stop promotional/agent SMS to that number per consent rules. HELP can point to support info. Do not try to bypass opt-out manually.",
      },
    ],
    related: ["sms-not-sending", "privacy-data"],
  },

  // ── Account & Security ───────────────────────────────────────────
  {
    id: "change-email",
    slug: "change-account-email",
    title: "How do I update my email?",
    description: "Change login email with verification from Settings.",
    category: "account-security",
    audience: ["both"],
    image: "/resources/banners/security.svg",
    imageAlt: "Change email banner",
    keywords: ["email", "update", "change", "login", "verify"],
    intro:
      "Email changes require verification so only you can move the login identity.",
    sections: [
      {
        title: "Steps",
        body: "Open Settings → request email change → verify the code on the new address → confirm. Keep access to the old inbox until the switch completes.",
      },
    ],
    related: ["sessions-login", "delete-account"],
  },
  {
    id: "change-phone-number",
    slug: "change-my-phone-number",
    title: "How do I change my phone number?",
    description: "Replace the forwarding or connected business number.",
    category: "account-security",
    audience: ["business"],
    image: "/resources/banners/phone.svg",
    imageAlt: "Change phone number banner",
    keywords: ["change", "phone", "number", "replace", "update"],
    intro:
      "Update forwarding when your front desk number changes so live calls and OTP still work.",
    sections: [
      {
        title: "Update",
        body: "From agent setup or Settings → Phone, replace the number and complete OTP again. Place a test call after saving.",
      },
    ],
    related: ["connect-phone", "agent-not-responding"],
  },
  {
    id: "sessions-login",
    slug: "manage-sessions-and-login",
    title: "How do I review login sessions?",
    description: "See active sessions and sign out unfamiliar devices.",
    category: "account-security",
    audience: ["both"],
    image: "/resources/banners/security.svg",
    imageAlt: "Sessions and login banner",
    keywords: ["sessions", "login", "security", "devices", "password"],
    intro:
      "Session history helps you spot unexpected access. Sign out anything you do not recognize.",
    sections: [
      {
        title: "In Settings",
        body: "Open Settings → Sessions / login history. End sessions you do not trust and change your password if anything looks wrong.",
      },
    ],
    related: ["change-email", "privacy-data"],
  },
  {
    id: "privacy-data",
    slug: "is-my-data-safe",
    title: "Is my customer data safe?",
    description: "Encryption, access controls, and where to find Privacy / DPA.",
    category: "account-security",
    audience: ["both"],
    image: "/resources/banners/security.svg",
    imageAlt: "Privacy and data banner",
    keywords: ["privacy", "HIPAA", "secure", "data", "encryption", "DPA"],
    intro:
      "Triven is designed with encryption and access controls. Healthcare buyers should review Privacy and whether a BAA/DPA is required for their workflow.",
    sections: [
      {
        title: "Documents",
        body: "Read Privacy and Terms from the site footer. Request a DPA when your organization needs one. Limit team logins and review sessions regularly.",
      },
    ],
    related: ["sessions-login", "delete-account"],
  },
  {
    id: "export-data",
    slug: "export-my-data",
    title: "How do I export my data?",
    description: "Download an export before major account changes.",
    category: "account-security",
    audience: ["both"],
    image: "/resources/banners/security.svg",
    imageAlt: "Export data banner",
    keywords: ["export", "download", "data", "backup"],
    intro:
      "Export from Settings when you need a local copy of account or business data.",
    sections: [
      {
        title: "Before you leave",
        body: "Run export before deleting an account or canceling critical agents so you keep conversation and billing records you need.",
      },
    ],
    related: ["delete-account", "billing-invoices"],
  },
  {
    id: "delete-account",
    slug: "delete-my-account",
    title: "How do I delete my account?",
    description: "Close the account from the danger zone after pausing agents.",
    category: "account-security",
    audience: ["both"],
    image: "/resources/banners/security.svg",
    imageAlt: "Delete account banner",
    keywords: ["delete", "close account", "danger zone", "remove"],
    intro:
      "Account deletion is permanent. Pause agents and export data first if you only need a break.",
    sections: [
      {
        title: "Danger zone",
        body: "Settings → danger zone → Delete account. Architects should settle payout obligations before deletion. Prefer Pause on agents for temporary stops.",
      },
    ],
    related: ["pause-agent", "export-data", "cancel-subscription"],
  },

  // ── For Architects ───────────────────────────────────────────────
  {
    id: "arch-quickstart",
    slug: "architect-quickstart",
    title: "How do I build and publish my first agent?",
    description: "Template or blank canvas → test → publish to the marketplace.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/architect.svg",
    imageAlt: "Architect quickstart banner",
    keywords: ["architect", "publish", "build", "first", "quickstart", "template"],
    intro:
      "Architects design workflows and sell them as listings. Start from a template when you can — it is the fastest path to a trustworthy demo. Buyers care about the outcome (“never miss after-hours calls”), not how many nodes you used.",
    sections: [
      {
        title: "What you are building",
        body: "A Triven agent is a workflow businesses install. For Missed Call Text-Back style agents, the core path is: inbound call → try the business phone → on miss, SMS (and optionally AI voice / booking). Your job is to make that path reliable and easy for buyers to configure.",
      },
      {
        title: "Build",
        body: "Sign up as an Architect, open Templates (try Missed Call Text-Back), or start blank. Wire triggers and actions, deploy, and run a test conversation before you write the listing.",
        steps: [
          "Create an Architect account and open the Builder.",
          "Start from a template or a blank canvas.",
          "Wire trigger → actions (SMS, voice, calendar, leads).",
          "Deploy and run a full test conversation.",
        ],
      },
      {
        title: "Publish",
        body: "Fill listing name, price model (free / one-time / monthly), summary, and media. Submit for review and track status under Agents. Buyers discover you in the marketplace once the listing is visible.",
        steps: [
          "Write a buyer-facing name and short outcome summary.",
          "Choose Free, One-time, or Monthly pricing.",
          "Add screenshots or a short demo clip.",
          "Submit for review and watch status under Agents.",
        ],
      },
    ],
    proTips: [
      "Sell the outcome on the listing (“never miss after-hours calls”), not the node list.",
      "Preview voice before publish so demos match the listing story.",
    ],
    related: ["arch-templates", "arch-logic-conditions", "arch-pricing-listing"],
  },
  {
    id: "arch-templates",
    slug: "use-architect-templates",
    title: "How do I use workflow templates?",
    description: "Clone starters like Missed Call Text-Back and customize for a niche.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/architect.svg",
    imageAlt: "Workflow templates banner",
    keywords: ["templates", "missed call", "starter", "clone", "niche"],
    intro:
      "Templates copy a working graph into your workspace so you edit copy and branches instead of inventing every node. Niche the language (dental, salon, trades) — do not hardcode one vertical forever.",
    sections: [
      {
        title: "Why start from a template",
        body: "A starter already wires the hard parts: missed-call detection, SMS follow-up, and optional booking. You spend time on niche messaging and logic branches, not reinventing telephony.",
      },
      {
        title: "Use a template",
        body: "Open Templates, preview a starter, click Use, then adapt SMS, voice, and niche language. Request a new template if your idea is missing.",
        steps: [
          "Open Templates and preview Missed Call Text-Back (or another starter).",
          "Click Use to copy it into your workspace.",
          "Rewrite SMS and voice for your niche without locking to one industry forever.",
          "Test both open-hours and after-hours paths before publish.",
        ],
      },
    ],
    related: ["arch-quickstart", "arch-nodes", "arch-logic-conditions"],
  },
  {
    id: "arch-logic-conditions",
    slug: "logic-and-conditions",
    title: "How do logic and conditions work?",
    description: "Route the workflow based on time, data, or custom rules — one branch per run.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/logic.svg",
    imageAlt: "Logic and conditions banner",
    keywords: [
      "logic",
      "conditions",
      "branch",
      "business hours",
      "if",
      "route",
      "decision",
      "yes",
      "no",
      "fork",
    ],
    intro:
      "Conditions are decision points in your workflow. When a run reaches a condition, it checks a rule you defined — like current time or message contents — and continues down exactly one path. Think of it as a fork in the road: every run takes one branch so callers get the right experience without a separate agent for every situation.",
    sections: [
      {
        title: "What are conditions?",
        body: "A condition sits between nodes and evaluates a rule. The matching Yes or No (or labeled) path continues; the other is skipped. Classic Missed Call Text-Back use: “Within business hours?” → Yes routes toward live-friendly messaging; No sends after-hours copy, booking links, or voicemail-style offers.",
      },
      {
        title: "Available condition types",
        body: "Pick the condition that matches the decision you need. Keep rules simple — chain two clear conditions instead of one opaque custom expression when you can.",
        examples: [
          { label: "Business Hours", value: "Mon–Fri 8am–6pm (buyer timezone)" },
          { label: "Data Contains", value: "Message contains “urgent”" },
          { label: "Numeric Compare", value: "Wait time > 5 minutes" },
          { label: "Day of Week", value: "Weekend vs weekday" },
          { label: "Custom Expression", value: "caller.visits > 3" },
        ],
      },
      {
        title: "Adding a condition to your workflow",
        body: "Conditions live in the Logic & Flow section of the node panel. Drop one on the canvas, connect the incoming edge, configure the rule, then wire Yes and No to different next steps.",
        steps: [
          "Open the Builder and find Logic & Flow in the left panel.",
          "Drag a Condition node onto the canvas.",
          "Connect it from the preceding node (the handle snaps).",
          "Click the node to open properties on the right.",
          "Select a condition type (for example Business Hours).",
          "Configure parameters — schedule, timezone, or comparison value.",
          "Connect the Yes output to one path and the No output to another.",
        ],
      },
      {
        title: "Business Hours example",
        body: "A weekday 8am–6pm Eastern Business Hours condition routes open-hours calls down Yes and after-hours down No. Buyers still set their own hours in setup — your node should respect the installed business profile when the product supports it, not a hardcoded dental schedule.",
        examples: [
          { label: "Timezone", value: "America/New_York (or buyer profile)" },
          { label: "Weekdays", value: "start 08:00 / end 18:00" },
          { label: "Weekend", value: "null / closed → No path" },
        ],
      },
    ],
    proTips: [
      "Chain multiple conditions for complex routing — e.g. Business Hours, then “returning customer.”",
      "Use Custom Expression sparingly; prefer readable named conditions.",
      "Test both Yes and No paths in the sandbox before publishing.",
    ],
    related: ["arch-nodes", "arch-templates", "arch-quickstart"],
  },
  {
    id: "arch-pricing-listing",
    slug: "set-listing-price-free-monthly-one-time",
    title: "How do I price my listing (free, monthly, one-time)?",
    description: "Choose a price model buyers will understand on the marketplace card.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/billing.svg",
    imageAlt: "Listing pricing banner",
    keywords: ["price", "free", "monthly", "one-time", "listing", "subscription"],
    intro:
      "Your listing price model is what businesses see at checkout. Pick the model that matches how you want to get paid, and use the same words in the listing subtitle and demo script. Whatever the buyer pays for your listing, Triven splits it 70% to you and 30% to the platform — see the payment-split guide for examples.",
    sections: [
      {
        title: "Choose a model buyers understand",
        body: "Confusion at checkout creates refunds. Say Free, One-time, or Monthly clearly. If usage fees can apply later, say so on the listing — do not hide them in fine print only. Remember: your take-home is about 70% of the listing price, not 100%.",
        examples: [
          { label: "Free", value: "Maximize installs / seed a niche" },
          { label: "One-time", value: "Single agent fee after trial" },
          { label: "Monthly", value: "Ongoing value + renewals" },
        ],
      },
      {
        title: "Price with your 70% in mind",
        body: "Before you publish, decide what you want to earn, then set the buyer price so 70% covers that. Example: if you want about $70 from a one-time sale, list near $100. For monthly, multiply the monthly price by 0.7 for each successful renewal.",
        examples: [
          { label: "Want ~$70 once", value: "List ~$100 one-time" },
          { label: "Want ~$35 / mo", value: "List ~$50 / month" },
        ],
      },
      {
        title: "Free",
        body: "Use Free to maximize installs or seed a niche. You may still earn later via upgrades or related paid agents. There is no 70/30 split until a paid purchase happens.",
      },
      {
        title: "One-time",
        body: "Charge a single agent fee after trial/purchase. Clear “what’s included” copy reduces refunds. Your 70% is credited after checkout settles.",
      },
      {
        title: "Monthly",
        body: "Subscription pricing fits agents with ongoing value. Explain renewals on the listing so buyers are not surprised. Each successful renewal credits another 70% share.",
      },
    ],
    proTips: [
      "Mirror the same pricing language in your demo script and listing subtitle.",
      "Estimate take-home as price × 0.7 before you publish.",
    ],
    related: ["arch-revenue-split", "arch-quickstart", "arch-payouts", "free-tier"],
  },
  {
    id: "arch-publish-status",
    slug: "publishing-status-and-review",
    title: "What do listing statuses mean?",
    description: "Draft, pending review, and live for buyers — what to expect.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/architect.svg",
    imageAlt: "Publish status banner",
    keywords: ["status", "review", "pending", "draft", "approved", "publish"],
    intro:
      "After you submit, the listing moves through review before businesses can install it widely. Status under Architect → Agents is the source of truth.",
    sections: [
      {
        title: "Statuses at a glance",
        body: "Draft means you are still editing. Pending review means you submitted. Approved / live means buyers can discover and install. Rejected or suspended listings need fixes before they return.",
        examples: [
          { label: "Draft", value: "Not submitted yet" },
          { label: "Pending review", value: "Submitted — waiting" },
          { label: "Approved / live", value: "Visible to buyers" },
          { label: "Rejected / suspended", value: "Fix and resubmit" },
        ],
      },
      {
        title: "Track it",
        body: "Watch publishing status under Architect → Agents. Improve screenshots and niche keywords while you wait, then use analytics after you are live.",
      },
    ],
    related: ["arch-quickstart", "arch-storefront", "arch-pro-tips"],
  },
  {
    id: "arch-nodes",
    slug: "workflow-building-blocks",
    title: "What building blocks can I use on the canvas?",
    description: "Triggers, SMS, voice, calendar, leads, and branches in plain language.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/architect.svg",
    imageAlt: "Workflow building blocks banner",
    keywords: ["nodes", "triggers", "SMS", "voice", "canvas", "builder", "actions"],
    intro:
      "Keep graphs readable. A short missed-call → SMS → optional voice/booking path beats a crowded canvas. Every block should earn its place by changing what the caller or business experiences.",
    sections: [
      {
        title: "Common blocks",
        body: "Triggers start on missed call or inbound SMS. Actions send SMS, start AI voice callbacks, create calendar events, save leads, or hand off to a human. Logic nodes branch for open vs after-hours and other rules.",
        examples: [
          { label: "Triggers", value: "Missed call, inbound SMS, webhook" },
          { label: "Communication", value: "SMS send/reply, AI voice callback" },
          { label: "Integrations", value: "Calendar event, CRM/lead save" },
          { label: "Logic", value: "Business hours / custom branch" },
        ],
      },
      {
        title: "Design for the buyer",
        body: "Buyers configure hours, FAQs, and forwarding phones — they should not need your Twilio keys. Prefer nodes that read business profile context so the same graph works for dentists, salons, and trades.",
      },
    ],
    related: ["arch-logic-conditions", "arch-templates", "arch-voice"],
  },
  {
    id: "arch-voice",
    slug: "choose-and-preview-voice",
    title: "How do I choose and preview a voice?",
    description: "Pick a persona and hear it in the browser before buyers do.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/voice.svg",
    imageAlt: "Voice preview banner",
    keywords: ["voice", "preview", "persona", "vapi", "sound"],
    intro:
      "Voice is part of your product brand. Preview before publish so the listing matches what customers hear on an AI callback.",
    sections: [
      {
        title: "Preview",
        body: "Open voice settings, try presets, run a browser preview, and save. Re-check after you change scripts so the persona still fits the niche.",
        steps: [
          "Open voice settings on the workflow.",
          "Try a few presets that match the niche tone.",
          "Run a browser preview of a sample script.",
          "Save and re-preview after script edits.",
        ],
      },
    ],
    related: ["arch-quickstart", "arch-nodes"],
  },
  {
    id: "arch-revenue-split",
    slug: "how-triven-splits-payments",
    title: "How does Triven split payments (70/30)?",
    description: "Simple breakdown: buyer pays Triven, you earn 70%, platform keeps 30%.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/split.svg",
    imageAlt: "70/30 payment split banner",
    keywords: [
      "split",
      "70",
      "30",
      "70/30",
      "revenue",
      "commission",
      "platform fee",
      "payment",
      "earnings",
      "share",
      "money",
    ],
    intro:
      "When a business buys or subscribes to your agent, they pay Triven — not you directly. Triven then splits that purchase: you keep 70%, and Triven keeps 30% as the marketplace fee. You withdraw your share from Architect → Payouts after Stripe Connect is set up.",
    sections: [
      {
        title: "The simple picture",
        body: "Think of Triven like an app store for agents. The buyer checks out once on Triven. Triven handles the payment, then credits your ledger with your share. You do not invoice the business yourself for marketplace purchases.",
        examples: [
          { label: "Buyer pays", value: "Triven (checkout / subscription)" },
          { label: "Your share", value: "70% of the purchase amount" },
          { label: "Triven share", value: "30% marketplace commission" },
          { label: "You withdraw", value: "From Architect → Payouts" },
        ],
      },
      {
        title: "Easy money examples",
        body: "The split is always the same percentage. Round numbers make it easy to predict earnings before you publish a price.",
        examples: [
          { label: "$100 one-time", value: "You $70 · Triven $30" },
          { label: "$49 / month", value: "You $34.30 · Triven $14.70 each month" },
          { label: "$10 / month", value: "You $7 · Triven $3 each month" },
          { label: "Free listing", value: "No purchase split (until a paid upgrade)" },
        ],
      },
      {
        title: "What counts toward the split?",
        body: "The 70/30 split applies to the agent purchase amount on the marketplace — for example a one-time agent fee or a monthly subscription charge for your listing. Free listings have no purchase to split. Usage or platform fees charged to the business for running calls/SMS (when shown on Billing & usage) are separate from your listing price and are not the same as your 70% creator share.",
      },
      {
        title: "Held vs available (why money is not instant)",
        body: "After a sale, your share usually shows on Payouts first as held (or pending), then becomes available to withdraw. That pause protects against failed payments and refunds. Once available, you can request a payout to the bank account linked through Stripe Connect.",
        steps: [
          "Business buys or renews your agent on Triven.",
          "Triven records the sale and calculates 70% for you / 30% for the platform.",
          "Your 70% appears on Payouts (often held first).",
          "When it becomes available, request a payout to your bank.",
        ],
      },
      {
        title: "What about refunds?",
        body: "If Triven refunds a buyer, your earnings for that sale are adjusted by the same 70% share of the refunded amount (you do not keep money that was returned to the buyer). Always check the ledger after a refund before you plan a large withdrawal.",
      },
      {
        title: "What you need before you get paid",
        body: "Finish Stripe Connect onboarding once. Without it, sales can still happen, but you cannot move money to your bank. Keep your legal name and bank details accurate so payouts do not fail.",
        steps: [
          "Open Architect → Payouts.",
          "Complete Stripe Connect (identity + bank).",
          "Confirm your first sale shows the 70% share.",
          "Withdraw when the balance is Available.",
        ],
      },
    ],
    proTips: [
      "Price for the buyer first, then multiply by 0.7 to estimate your take-home.",
      "Example: if you want ~$70 in your pocket from a one-time sale, list around $100.",
      "Monthly agents: your 70% repeats each successful renewal.",
      "Check Payouts after refunds — available balance can drop.",
    ],
    related: ["arch-payouts", "arch-pricing-listing", "arch-quickstart"],
  },
  {
    id: "arch-payouts",
    slug: "architect-payouts",
    title: "How do architect payouts work?",
    description: "Connect onboarding, 70% earnings, held vs available, and withdrawing.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/split.svg",
    imageAlt: "Architect payouts banner",
    keywords: ["payouts", "earnings", "stripe", "connect", "withdraw", "money", "bank", "70"],
    intro:
      "Buyers pay Triven. Your share is 70% of each marketplace purchase for your agent. That money shows on Architect → Payouts. After Stripe Connect, you move Available balance to your bank. For the full 70/30 explanation, see “How does Triven split payments?”",
    sections: [
      {
        title: "Who pays whom?",
        body: "The business never wires you money for a marketplace install. They pay Triven at checkout. Triven keeps 30% and credits you 70%. Payouts is where you see that credit and send it to your bank.",
        examples: [
          { label: "Business", value: "Pays Triven at checkout" },
          { label: "Triven", value: "Keeps 30% + runs the marketplace" },
          { label: "You (architect)", value: "Earn 70% → withdraw on Payouts" },
        ],
      },
      {
        title: "Held vs Available",
        body: "Held means the sale is recorded but not ready to withdraw yet (common right after purchase or while a payment settles). Available means you can request a payout. Paid means the transfer to your bank already went out. If a payout fails, fix bank details and try again.",
      },
      {
        title: "Get paid step by step",
        body: "Do Connect once, then treat the Payouts page as your source of truth for every sale and refund.",
        steps: [
          "Open Architect → Payouts.",
          "Complete Stripe Connect onboarding (identity + bank).",
          "Wait for earnings to move from Held to Available.",
          "Request or schedule a payout for the Available amount.",
          "Confirm the payout status becomes Paid.",
        ],
      },
      {
        title: "Reading your ledger",
        body: "Each row is usually a sale, renewal, refund adjustment, or payout. Match large withdrawals to recent Available totals. If a number looks wrong, check whether a refund reduced your share before contacting support.",
      },
    ],
    proTips: [
      "Check the ledger after refunds before you plan a withdrawal.",
      "Keep Connect details up to date when you change banks.",
      "Estimate take-home as listing price × 0.7 before you publish.",
    ],
    related: ["arch-revenue-split", "arch-pricing-listing", "arch-storefront"],
  },
  {
    id: "arch-storefront",
    slug: "architect-storefront-profile",
    title: "How do I set up my architect storefront?",
    description: "Photo, bio, and branding buyers see beside your listings.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/architect.svg",
    imageAlt: "Architect storefront banner",
    keywords: ["storefront", "profile", "branding", "bio", "photo"],
    intro:
      "A clear storefront builds trust on every agent page you publish. Buyers glance at who built the agent before they install.",
    sections: [
      {
        title: "Profile",
        body: "Update display name, bio, and photo in Architect settings. Link Privacy/Terms when you share public pages.",
        steps: [
          "Open Architect settings / storefront.",
          "Add a clear display name and short bio.",
          "Upload a professional photo or logo.",
          "Save and open one of your listings to preview.",
        ],
      },
    ],
    related: ["arch-quickstart", "arch-revenue-split"],
  },
  {
    id: "arch-pro-tips",
    slug: "architect-pro-tips",
    title: "Pro tips for selling more agents",
    description: "Practical habits that improve listing conversion and fewer support tickets.",
    category: "for-architects",
    audience: ["architect"],
    image: "/resources/banners/stats.svg",
    imageAlt: "Architect pro tips banner",
    keywords: ["pro tips", "conversion", "marketplace", "sell", "tips"],
    intro:
      "Great graphs matter — but listings, demos, and support clarity sell installs. Treat the marketplace card like a product page, not a changelog of nodes.",
    sections: [
      {
        title: "Habits that help",
        body: "Niche your listing (“dental after-hours”), show 2–3 screenshots, test the full SMS path weekly, and answer buyer questions with a short loom or demo call link. Keep price models simple and mirrored in the description.",
      },
    ],
    proTips: [
      "One niche listing usually beats one vague “works for everyone” listing.",
      "Ship a template-based agent first; customize heavily only after you have installs.",
      "Document setup steps for buyers in the listing — it cuts refunds.",
      "Always test both condition branches (open hours and after hours) before publish.",
    ],
    related: ["arch-quickstart", "arch-revenue-split", "arch-publish-status"],
  },
];

export function searchResources(
  query: string,
  items: ResourceItem[] = resources
): ResourceItem[] {
  const q = String(query || "")
    .trim()
    .toLowerCase();
  if (!q) return items;

  const tokens = q.split(/\s+/).filter(Boolean);

  return items.filter((item) => {
    const haystack = [
      item.title,
      item.description,
      item.intro,
      item.slug,
      item.category,
      ...(item.keywords || []),
      ...(item.audience || []),
      ...(item.proTips || []),
      ...item.sections.flatMap((s) => [
        s.title,
        s.body,
        ...(s.steps || []),
        ...(s.examples || []).flatMap((e) => [e.label, e.value]),
      ]),
    ]
      .join(" ")
      .toLowerCase();

    return tokens.every((token) => haystack.includes(token));
  });
}

export function getResourcesByCategory(categoryId: string): ResourceItem[] {
  return resources.filter((r) => r.category === categoryId);
}

export function getArchitectResources(): ResourceItem[] {
  return resources.filter((r) => r.category === "for-architects");
}

export function getBusinessHelpResources(): ResourceItem[] {
  return resources.filter((r) => {
    const cat = resourceCategories.find((c) => c.id === r.category);
    return cat?.hub === "business";
  });
}

export default resources;
