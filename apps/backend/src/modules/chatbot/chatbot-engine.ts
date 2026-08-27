// Deterministic Rule-Based Chatbot Engine
// Completely client-decoupled logic for query normalization, synonyms mapping, fuzzy string matching, intent scoring, entity extraction, and formula-based pricing calculations.

export interface ChatbotContext {
  lastIntent?: string;
  lastMentionedAgentId?: string;
  awaitingInput?: "calculator_usage" | "calculator_agent" | "fallback_email" | "fallback_phone" | "fallback_feedback" | "general_feedback" | null;
  fallbackQuery?: string;
  fallbackEmail?: string;
  fallbackPhone?: string;
  queryCount?: number;
}

export interface AgentListingSummary {
  id: string;
  name: string;
  shortDescription: string;
  tagline?: string | null;
  priceCents: number;
  pricingModel: string; // SUBSCRIPTION, ONE_TIME, FREE
  requiredConnectors: string[];
  includedFeatures: string[];
  category?: string | null;
  industryTags: string[];
  tags: string[];
}

export interface ChatbotResponse {
  reply: string;
  context: ChatbotContext;
  suggestions: string[];
  saveFeedback?: {
    email: string;
    phone: string;
    query: string;
    feedback: string;
  } | null;
}

// ----------------------------------------------------
// 1. Fuzzy String Matching (Levenshtein Distance)
// ----------------------------------------------------
export function getLevenshteinDistance(a: string, b: string): number {
  const tmp = [];
  let i, j;
  const alen = a.length;
  const blen = b.length;

  if (alen === 0) return blen;
  if (blen === 0) return alen;

  for (i = 0; i <= alen; i++) tmp[i] = [i];
  for (j = 0; j <= blen; j++) tmp[0][j] = j;

  for (i = 1; i <= alen; i++) {
    for (j = 1; j <= blen; j++) {
      tmp[i][j] = Math.min(
        tmp[i - 1][j] + 1, // deletion
        tmp[i][j - 1] + 1, // insertion
        tmp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1) // substitution
      );
    }
  }
  return tmp[alen][blen];
}

const PROTECTED_WORDS = new Set([
  "what", "when", "where", "with", "number", "contact",
  "that", "help", "tell", "could", "will", "would", "should",
  "your", "mine", "ours", "this", "them", "they", "their", "there", "here"
]);

// Returns true if token is fuzzy-equal to target word (threshold adjusted by length)
export function fuzzyMatchWord(token: string, target: string): boolean {
  const t = token.toLowerCase();
  const tg = target.toLowerCase();
  if (t === tg) return true;
  if (PROTECTED_WORDS.has(t)) return false; // Guard common conversational stop-words from fuzzy matching
  if (tg.length <= 3) return false; // Short words require exact matches to avoid collisions (e.g. yo/you, hi/his)
  if (tg.includes(t) && t.length >= 4) return true;

  const distance = getLevenshteinDistance(t, tg);
  if (tg.length <= 4) return distance <= 1;
  if (tg.length <= 8) return distance <= 2;
  return distance <= 3;
}

// ----------------------------------------------------
// 2. Query Preprocessing & Normalization
// ----------------------------------------------------
export function normalizeText(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

// Synonym Map
const SYNONYMS: Record<string, string[]> = {
  pricing: ["cost", "price", "charge", "bill", "fee", "rate", "billing", "payment", "subscription", "expensive", "cheapest"],
  agent: ["agents", "bot", "bots", "solution", "solutions", "assistant", "assistants", "employee", "employees"],
  dental: ["dentist", "dentists", "teeth", "tooth", "clinic", "dental practice", "dental clinic"],
  hvac: ["plumber", "plumbing", "electrician", "roofer", "contractor", "hvac", "home services", "ac", "salon", "barbershop", "spa"],
  lead: ["leads", "qualification", "qualify", "prospect", "prospects", "nurture", "crm"],
  booking: ["schedule", "scheduling", "calendar", "book", "appointment", "appointments", "slots"],
  whatsapp: ["whats app", "whatapp", "watsapp", "chat", "message", "messaging"],
  twilio: ["phone", "call", "calls", "calling", "missed call", "voice", "receptionist"],
  payout: ["earnings", "earn", "payouts", "builder payout", "money", "salary", "stripe", "commission"]
};

// Expand a token list using synonyms
export function expandTokens(tokens: string[]): string[] {
  const expanded: string[] = [...tokens];
  for (const token of tokens) {
    for (const [canonical, synList] of Object.entries(SYNONYMS)) {
      if (canonical === token || synList.some(syn => fuzzyMatchWord(token, syn))) {
        if (!expanded.includes(canonical)) {
          expanded.push(canonical);
        }
      }
    }
  }
  return expanded;
}

// ----------------------------------------------------
// 3. Entity Extraction
// ----------------------------------------------------

// Extracts any numbers from query. E.g., "50,000" -> 50000, "50k" -> 50000, "100" -> 100
export function extractExecutionCount(text: string): number | null {
  const cleanText = text.toLowerCase();
  
  // Strip monetary values and percentages (e.g. $100, 100$, 100 dollars, 70%) to avoid treating prices/percentages as execution counts
  const textWithoutPrices = cleanText.replace(/(\$\s*\d+(?:\.\d+)?)|(\d+(?:\.\d+)?\s*(?:\$|dollars|usd|cents|percent|%))/g, "");
  
  // Try matching "Xk" format (e.g. 50k, 10k)
  const kMatch = textWithoutPrices.match(/\b(\d+(?:\.\d+)?)\s*k\b/);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }

  // Try matching "Xm" or "million" format
  const mMatch = textWithoutPrices.match(/\b(\d+(?:\.\d+)?)\s*m\b/);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1]) * 1000000);
  }

  // General numeric parser, stripping commas
  const cleanNumbers = textWithoutPrices.replace(/,/g, "");
  const numberMatches = cleanNumbers.match(/\b\d+\b/);
  if (numberMatches) {
    const val = parseInt(numberMatches[0], 10);
    // Sanity check to avoid matching years (like 2026) if we asked for requests
    if (val > 0) {
      return val;
    }
  }

  return null;
}

// Extracts monetary amount (e.g. $100, 100$) from query
export function extractPriceAmount(text: string): number | null {
  const match = text.replace(/,/g, "").match(/(?:\$\s*(\d+(?:\.\d+)?))|(\d+(?:\.\d+)?)\s*(?:\$|dollars|usd)/i);
  if (match) {
    const val = parseFloat(match[1] || match[2]);
    if (val > 0) return val;
  }
  return null;
}

// Extract agent name matching from database listings
export function extractAgentEntity(text: string, listings: AgentListingSummary[]): AgentListingSummary | null {
  const lowerText = text.toLowerCase();
  
  // Try exact substring match first
  for (const listing of listings) {
    if (lowerText.includes(listing.name.toLowerCase())) {
      return listing;
    }
  }

  // Check fuzzy matching of words in agent name
  const tokens = normalizeText(text);
  let bestMatch: AgentListingSummary | null = null;
  let highestScore = 0;

  for (const listing of listings) {
    const agentWords = normalizeText(listing.name);
    let matchCount = 0;

    for (const token of tokens) {
      if (agentWords.some(w => fuzzyMatchWord(token, w))) {
        matchCount++;
      }
    }

    const score = matchCount / agentWords.length;
    if (score > highestScore && score >= 0.4) {
      highestScore = score;
      bestMatch = listing;
    }
  }

  return bestMatch;
}

// Extract connector details
export function extractConnectorEntity(text: string): string | null {
  const lowerText = text.toLowerCase();
  if (lowerText.includes("whatsapp")) return "WHATSAPP";
  if (lowerText.includes("twilio") || lowerText.includes("phone") || lowerText.includes("call")) return "TWILIO";
  if (lowerText.includes("calendar") || lowerText.includes("google calendar")) return "GOOGLE_CALENDAR";
  if (lowerText.includes("gmail") || lowerText.includes("email")) return "GMAIL";
  if (lowerText.includes("stripe")) return "STRIPE";
  if (lowerText.includes("hubspot") || lowerText.includes("crm")) return "HUBSPOT";
  if (lowerText.includes("shopify")) return "SHOPIFY";
  return null;
}

// Extract industry details
export function extractIndustryEntity(text: string): string | null {
  const lowerText = text.toLowerCase();
  if (lowerText.includes("dent") || lowerText.includes("teeth") || lowerText.includes("tooth")) return "dental";
  if (lowerText.includes("hvac") || lowerText.includes("plumb") || lowerText.includes("ac ") || lowerText.includes("condition")) return "hvac";
  if (lowerText.includes("salon") || lowerText.includes("barber") || lowerText.includes("spa") || lowerText.includes("hair")) return "salon";
  if (lowerText.includes("estate") || lowerText.includes("agent") || lowerText.includes("realtor") || lowerText.includes("house")) return "real estate";
  if (lowerText.includes("law") || lowerText.includes("legal") || lowerText.includes("attorney") || lowerText.includes("firm")) return "legal";
  if (lowerText.includes("startup") || lowerText.includes("small business") || lowerText.includes("new company")) return "startup";
  return null;
}

// ----------------------------------------------------
// 4. Intent Classifier (Scoring Engine)
// ----------------------------------------------------
type IntentType =
  | "greet"
  | "company_info"
  | "how_it_works"
  | "services"
  | "agent_list"
  | "cheapest_option"
  | "whatsapp_connector"
  | "twilio_connector"
  | "calendar_connector"
  | "pricing_calculator"
  | "pricing_general"
  | "refund_policy"
  | "setup_time"
  | "human_handoff"
  | "architect_info"
  | "recommend_usecase"
  | "contact_info"
  | "free_trial"
  | "unknown";

interface IntentDefinition {
  intent: IntentType;
  keywords: string[];
}

const INTENT_RULES: IntentDefinition[] = [
  {
    intent: "greet",
    keywords: ["hi", "hello", "hey", "greetings", "sup", "yo", "start"]
  },
  {
    intent: "company_info",
    keywords: ["what is triven", "who is triven", "who runs triven", "triven company", "about triven", "about us", "mission", "purpose", "what is this platform", "who are you", "what do you do", "what you do", "explain triven", "what is this website", "who you are"]
  },
  {
    intent: "how_it_works",
    keywords: ["work", "flow", "onboard", "setup", "get started", "install", "use", "start"]
  },
  {
    intent: "services",
    keywords: ["service", "services", "provide", "feature", "features", "offer", "capabilities"]
  },
  {
    intent: "agent_list",
    keywords: ["how many", "count", "number of", "list of", "catalog", "catalogue", "all agents", "available agents", "active agents", "what agents", "show agents", "total agents"]
  },
  {
    intent: "cheapest_option",
    keywords: ["cheapest", "lowest", "least", "free", "cheap", "free-to-install"]
  },
  {
    intent: "whatsapp_connector",
    keywords: ["whatsapp", "whats app", "chat"]
  },
  {
    intent: "twilio_connector",
    keywords: ["twilio", "phone", "call", "calls", "voice", "receptionist", "telephony"]
  },
  {
    intent: "calendar_connector",
    keywords: ["calendar", "google calendar", "schedule", "scheduling", "book", "booking"]
  },
  {
    intent: "pricing_calculator",
    keywords: ["calculator", "estimate", "bill", "usage", "cost calculation", "calculate", "monthly cost"]
  },
  {
    intent: "pricing_general",
    keywords: ["pricing", "cost", "charge", "fees", "pay", "plan", "plans", "payment", "subscription", "call cost", "phone call cost", "sms cost", "whatsapp cost", "execution cost", "execution fee", "call fee", "sms fee"]
  },
  {
    intent: "refund_policy",
    keywords: ["refund", "guarantee", "money back", "cancelation", "cancel"]
  },
  {
    intent: "setup_time",
    keywords: ["minutes", "time", "setup", "onboarding time", "days", "weeks", "how long"]
  },
  {
    intent: "human_handoff",
    keywords: ["human", "escalate", "transfer", "team", "person", "staff", "receptionist transfer"]
  },
  {
    intent: "architect_info",
    keywords: ["build", "builds", "architect", "earning", "earn", "developer", "revenue", " Stripe Connect", "commission"]
  },
  {
    intent: "recommend_usecase",
    keywords: ["recommend", "best", "fit", "clinic", "dentist", "hvac", "startup", "salon", "plumber", "realtor", "business"]
  },
  {
    intent: "contact_info",
    keywords: ["contact", "email", "phone", "number", "support", "address", "reach", "call you", "contac"]
  },
  {
    intent: "free_trial",
    keywords: ["free trial", "try for free", "try before buy", "trial", "credit card", "need credit card", "require credit card", "free runs", "free test"]
  }
];

export function matchesKeywordDirect(query: string, tokens: string[], keyword: string): boolean {
  const kwLower = keyword.toLowerCase();
  const kwTokens = normalizeText(kwLower);

  if (kwTokens.length === 1) {
    const singleKw = kwTokens[0];
    return tokens.includes(singleKw) || tokens.some(t => fuzzyMatchWord(t, singleKw));
  } else {
    const escaped = kwLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'i');
    return regex.test(query);
  }
}

export function matchesKeywordExpanded(expanded: string[], keyword: string): boolean {
  const kwLower = keyword.toLowerCase();
  const kwTokens = normalizeText(kwLower);

  if (kwTokens.length === 1) {
    return expanded.includes(kwTokens[0]);
  }
  return false;
}

export function classifyIntent(query: string): IntentType {
  const lower = query.toLowerCase();

  // Heuristic: If we can extract an execution count (number of runs) AND there are pricing-related terms, it's definitely a pricing calculator query!
  const hasCount = extractExecutionCount(query) !== null;
  const hasPriceTerm = ["pricing", "price", "cost", "bill", "charge", "fee", "how much", "estimate", "calculate"].some(term => lower.includes(term));
  if (hasCount && hasPriceTerm) {
    return "pricing_calculator";
  }

  const tokens = normalizeText(query);
  const expanded = expandTokens(tokens);

  let bestIntent: IntentType = "unknown";
  let maxScore = 0;

  const isArchitectQuery = ["build", "built", "architect", "earn", "earning", "commission", "stripe connect", "revenue", "payout", "stripe"].some(term => lower.includes(term));

  for (const rule of INTENT_RULES) {
    let score = 0;
    for (const keyword of rule.keywords) {
      if (matchesKeywordDirect(query, tokens, keyword)) {
        score += 2.0;
      } else if (matchesKeywordExpanded(expanded, keyword)) {
        score += 1.0;
      }
    }

    // Boost pricing intents if there is any pricing synonym in the query to prioritize cost-related queries over connectors
    const isPricingIntent = ["pricing_general", "pricing_calculator", "cheapest_option"].includes(rule.intent);
    if (isPricingIntent && hasPriceTerm) {
      score += 5.0;
    }

    // Boost architect info if there are architect keywords in the query to prioritize builder/revenue queries
    if (rule.intent === "architect_info" && isArchitectQuery) {
      score += 5.0;
    }

    if (score > maxScore) {
      maxScore = score;
      bestIntent = rule.intent;
    }
  }

  // If score is too low, treat as unknown
  if (maxScore < 1.0) {
    return "unknown";
  }

  return bestIntent;
}

// ----------------------------------------------------
// 5. Pricing Calculator Logic
// ----------------------------------------------------
// ----------------------------------------------------
// 6. Main Process Message Core
// ----------------------------------------------------
export function processMessageInner(
  message: string,
  context: ChatbotContext,
  listings: AgentListingSummary[]
): ChatbotResponse {
  const query = message.trim();
  let nextContext: ChatbotContext = { ...context };

  /* THE VISITOR'S NEXT QUESTION IS NOT FEEDBACK.
     Every fourth message, the widget asked "how can we improve?" — and then
     the very next thing the visitor typed was answered with "Thank you so much
     for your feedback!" whatever it said. A real question, asked at the wrong
     moment, was thanked and thrown away. It is only taken as feedback when it
     is not a question we can answer; otherwise the question wins. */
  if (context.awaitingInput === "general_feedback") {
    nextContext.awaitingInput = null;

    const looksLikeAQuestion =
      query.trim().endsWith("?") || classifyIntent(query) !== "unknown";

    if (!looksLikeAQuestion) {
      return {
        reply: "Thank you so much for your feedback! I've shared it with our team to help improve Triven. What else would you like to know?",
        context: nextContext,
        suggestions: ["Show all agents", "How does pricing work?", "What can these agents do?"],
        saveFeedback: {
          email: "feedback@triven.ai",
          phone: "N/A",
          query: "Proactive Feedback Request",
          feedback: query
        }
      };
    }
    /* Falls through and is answered as the question it is. */
  }

  if (context.awaitingInput === "fallback_email") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (emailRegex.test(query)) {
      nextContext.fallbackEmail = query;
      nextContext.awaitingInput = "fallback_phone";
      return {
        reply: "Thank you! Next, what is a good **phone number** our team can reach you at?",
        context: nextContext,
        suggestions: []
      };
    } else {
      return {
        reply: "That doesn't look like a valid email address. Could you please check and type it again? (e.g. name@example.com)",
        context: nextContext,
        suggestions: []
      };
    }
  }

  if (context.awaitingInput === "fallback_phone") {
    const phoneDigits = query.replace(/\D/g, "");
    if (phoneDigits.length >= 7) {
      nextContext.fallbackPhone = query;
      nextContext.awaitingInput = "fallback_feedback";
      return {
        reply: "Got it! Lastly, what were you hoping to find today, or how can we improve? (Please share any feedback or questions)",
        context: nextContext,
        suggestions: []
      };
    } else {
      return {
        reply: "That doesn't look like a valid phone number. Please enter a valid phone number (at least 7 digits) so we can reach you.",
        context: nextContext,
        suggestions: []
      };
    }
  }

  if (context.awaitingInput === "fallback_feedback") {
    nextContext.awaitingInput = null;
    const saveEmail = context.fallbackEmail || "";
    const savePhone = context.fallbackPhone || "";
    const saveQuery = context.fallbackQuery || "";

    nextContext.fallbackEmail = undefined;
    nextContext.fallbackPhone = undefined;
    nextContext.fallbackQuery = undefined;

    return {
      reply: "Thank you so much! I have successfully saved your contact details and feedback. Our team will reach out to you shortly. Is there anything else I can help you with?",
      context: nextContext,
      suggestions: ["Show all agents", "How does pricing work?", "Estimate my monthly cost"],
      saveFeedback: {
        email: saveEmail,
        phone: savePhone,
        query: saveQuery,
        feedback: query
      }
    };
  }

  if (context.awaitingInput === "calculator_usage") {
    const executions = extractExecutionCount(query);
    const matchedAgent = context.lastMentionedAgentId 
      ? listings.find(l => l.id === context.lastMentionedAgentId) 
      : null;

    if (executions !== null && matchedAgent) {
      nextContext.awaitingInput = null;
      nextContext.lastIntent = "pricing_calculator";

      /* NUMBERS NOBODY SET. This quoted "$0.20/run", invented three volume
         discount tiers that do not exist anywhere in billing, and told the
         visitor their runs would "recover" twelve dollars each — then printed
         a percentage ROI from those two made-up figures. A business decides
         whether to buy on exactly this. The real rate board is set by an
         admin and shown at checkout; until this reads that board, it says so.
         Removed 2026-08-27. */
      return {
        reply: `I can't quote a running cost here — the per-run rate is set by Triven and I should not guess at it. What I can tell you is **${matchedAgent.name}**'s own price. The exact per-run charges are shown on the checkout screen, before you pay for anything.`,
        context: nextContext,
        suggestions: ["How do I get started?", "Compare other agents", "What are the execution fees?"]
      };
    } else if (executions !== null) {
      // We got the runs but need to map the agent
      nextContext.awaitingInput = "calculator_agent";
      return {
        reply: `Got it! You estimated **${executions.toLocaleString()} executions per month**. Which agent from our marketplace would you like to calculate the cost for? (e.g. "AI Receptionist")`,
        context: nextContext,
        suggestions: listings.slice(0, 3).map(l => l.name)
      };
    }
  }

  if (context.awaitingInput === "calculator_agent") {
    const matchedAgent = extractAgentEntity(query, listings);
    if (matchedAgent) {
      nextContext.lastMentionedAgentId = matchedAgent.id;
      nextContext.awaitingInput = "calculator_usage";
      return {
        reply: `Perfect. Let's calculate the cost for the **${matchedAgent.name}**. How many executions (calls/SMS runs) do you estimate your business will need per month? (e.g., "500", "1,000", or "5k")`,
        context: nextContext,
        suggestions: ["200 runs", "500 runs", "1,000 runs", "5,000 runs"]
      };
    }
  }

  // B. Standard Intent Matching
  const intent = classifyIntent(query);
  nextContext.lastIntent = intent;

  // Extract agent mentioned in query
  const queryAgent = extractAgentEntity(query, listings);
  if (queryAgent) {
    nextContext.lastMentionedAgentId = queryAgent.id;
  }

  const activeAgent = queryAgent || (nextContext.lastMentionedAgentId ? listings.find(l => l.id === nextContext.lastMentionedAgentId) : null);

  switch (intent) {
    case "greet":
      return {
        reply: "Hi! Welcome to Triven AI Assistant. I can tell you about our AI agent marketplace, explain how pricing works, compare different agents, or run our monthly cost estimator. What would you like to know?",
        context: nextContext,
        suggestions: ["What is Triven?", "Show all agents", "How does pricing work?", "Estimate my monthly cost"]
      };

    case "company_info":
      return {
        reply: "Triven is an **AI Agent Marketplace** that connects business owners with AI Architects. Businesses can install pre-built AI agents (virtual employees) in minutes to automate missed phone calls, appointment scheduling, and lead nurturing. No coding or complex setups required!",
        context: nextContext,
        suggestions: ["How does it work?", "Show all agents", "What are the fees?"]
      };

    case "how_it_works":
      return {
        reply: `Getting started with Triven is simple:
1. **Find an Agent:** Browse our [Marketplace](/marketplace) and select the agent that fits your need (e.g., Dental Receptionist or Google Review Booster).
2. **Onboard:** Log in and set up your business profile (hours, services, tone of voice, booking links).
3. **Connect Credentials:** Connect your Twilio numbers (for telephony/SMS) or Google Calendar (for booking).
4. **Activate:** Toggle the agent on! It runs 24/7 in the background.`,
        context: nextContext,
        suggestions: ["How many agents do you have?", "Do I need a credit card?", "What does setup cost?"]
      };

    case "services":
      return {
        reply: "Triven provides virtual AI employee capabilities across multiple channels: missed call detection & instant text-back, inbound receptionist telephony (via Twilio/Vapi AI), Google Calendar booking, automated SMS reminder & confirmation campaigns, Google review generation, and automated lead scoring linked to CRM updates.",
        context: nextContext,
        suggestions: ["Show all agents", "How does pricing work?", "Do you support WhatsApp?"]
      };

    case "agent_list": {
      const count = listings.length;
      const listText = listings.slice(0, 5).map(l => `• **${l.name}** (${l.priceCents === 0 ? 'Free' : `$${(l.priceCents/100).toFixed(0)}`}) - *${l.tagline || l.shortDescription}*`).join("\n");
      return {
        reply: `We currently have **${count} active agents** published in the marketplace. Here are some of our popular listings:
${listText}

You can browse all options on the [Marketplace](/marketplace).`,
        context: nextContext,
        suggestions: ["What is the cheapest option?", "Recommend for startup", "Estimate pricing"]
      };
    }

    case "cheapest_option": {
      if (listings.length === 0) {
        return {
          reply: "No agents are currently published. Please check back later!",
          context: nextContext,
          suggestions: ["What is Triven?"]
        };
      }
      const sorted = [...listings].sort((a, b) => a.priceCents - b.priceCents);
      const cheapest = sorted.slice(0, 3).map((l, i) => `${i+1}. **${l.name}** - ${l.priceCents === 0 ? 'Free-to-install' : `$${(l.priceCents/100).toFixed(0)}`} (*${l.shortDescription}*)`).join("\n");
      return {
        reply: `Our most affordable marketplace solutions are:
${cheapest}

*Note: In addition to the agent installation fee, standard execution usage charges apply.*`,
        context: nextContext,
        suggestions: ["What are the execution fees?", "Estimate monthly cost"]
      };
    }

    case "whatsapp_connector": {
      const whatsappAgents = listings.filter(l => l.requiredConnectors.some(c => c.toUpperCase() === "WHATSAPP"));
      if (whatsappAgents.length === 0) {
        return {
          reply: "While our core platform supports WhatsApp nodes, there are currently no pre-packaged WhatsApp agents published in the public marketplace. You can build your own visual WhatsApp agent as an Architect in just a few minutes!",
          context: nextContext,
          suggestions: ["How do I build an agent?", "Which agent supports Twilio?"]
        };
      }
      const list = whatsappAgents.map(l => `• **${l.name}** - *${l.shortDescription}*`).join("\n");
      return {
        reply: `The following marketplace agents support **WhatsApp** integrations out of the box:
${list}`,
        context: nextContext,
        suggestions: ["Show all agents", "How do I build an agent?"]
      };
    }

    case "twilio_connector": {
      const twilioAgents = listings.filter(l => l.requiredConnectors.some(c => c.toUpperCase() === "TWILIO"));
      const list = twilioAgents.length > 0 
        ? twilioAgents.map(l => `• **${l.name}** - *${l.shortDescription}*`).join("\n")
        : "• **AI Receptionist** - Missed Call Text Back (handles calls and text updates)";
      return {
        reply: `The following agents support **Twilio** telephone and SMS integration:
${list}

Each active Twilio agent gets mapped to a dedicated phone number provisioned by Triven.`,
        context: nextContext,
        suggestions: ["How does call forwarding work?", "What does a phone call cost?"]
      };
    }

    case "calendar_connector": {
      const calAgents = listings.filter(l => l.requiredConnectors.some(c => c.toUpperCase() === "GOOGLE_CALENDAR"));
      const list = calAgents.length > 0
        ? calAgents.map(l => `• **${l.name}** - *${l.shortDescription}*`).join("\n")
        : "• **Dental AI Receptionist**\n• **After-Hours Receptionist**";
      return {
        reply: `The following agents support **Google Calendar** integration to check real-time slots and book appointments:
${list}`,
        context: nextContext,
        suggestions: ["Recommend for dentists", "What does a booking cost?"]
      };
    }

    case "pricing_calculator": {
      // Check if execution count is already in query
      const executions = extractExecutionCount(query);
      if (executions !== null) {
        if (activeAgent) {
          /* Same invented rate table as above — removed 2026-08-27. */
          nextContext.awaitingInput = null;
          return {
            reply: `I can't quote a running cost here — the per-run rate is set by Triven and I should not guess at it. What I can tell you is **${activeAgent.name}**'s own price. The exact per-run charges are shown on the checkout screen, before you pay for anything.`,
            context: nextContext,
            suggestions: ["How do I get started?", "What are the execution fees?", "Show all agents"]
          };
        } else {
          nextContext.awaitingInput = "calculator_agent";
          return {
            reply: `Got it! You estimated **${executions.toLocaleString()} executions per month**. Which agent would you like to calculate the cost for?`,
            context: nextContext,
            suggestions: listings.slice(0, 3).map(l => l.name)
          };
        }
      }

      // No executions count provided, initiate step flow
      if (activeAgent) {
        nextContext.awaitingInput = "calculator_usage";
        return {
          reply: `Let's calculate the cost for the **${activeAgent.name}**. How many executions (calls/SMS runs) do you estimate your business will need per month? (e.g. "200", "500", "1k")`,
          context: nextContext,
          suggestions: ["100 runs", "500 runs", "1,000 runs"]
        };
      } else {
        nextContext.awaitingInput = "calculator_agent";
        return {
          reply: "I can help you estimate your expected monthly bill. First, which agent are you interested in calculating?",
          context: nextContext,
          suggestions: listings.slice(0, 3).map(l => l.name)
        };
      }
    }

    case "pricing_general":
      return {
        reply: "Triven pricing is fully transparent and pay-for-results. There are no expensive bundles. You pay: \n1. **Agent Fee:** Determined by the architect (can be Free, a one-time purchase, or a monthly subscription).\n2. **Execution Fees:** Billed per action, at rates Triven sets and shows you at checkout. You get 50 free executions to start.",
        context: nextContext,
        suggestions: ["Estimate my monthly cost", "What counts as an execution?", "Do you offer a free trial?"]
      };

    case "refund_policy":
      return {
        reply: "Triven offers a **30-day money-back guarantee** on all agent installations and purchases in the marketplace. If an agent doesn't fit your business requirements, you can uninstall it within 30 days for a full refund, no questions asked.",
        context: nextContext,
        suggestions: ["How do I get started?", "Show all agents"]
      };

    case "setup_time":
      return {
        reply: "Onboarding and setup takes **less than 2 minutes**. Because Triven is completely code-free, you simply buy an agent, fill out your basic business profile info (FAQs, hours, services), connect credentials like Google Calendar or Twilio, and launch it immediately.",
        context: nextContext,
        suggestions: ["How do I get started?", "What third-party tools do you support?"]
      };

    case "human_handoff":
      return {
        reply: "Yes. Our AI Receptionist and After-Hours templates support human escalation rules. If the caller requests a human manager, asks an urgent query out of scope, or reports an emergency, the agent will instantly forward the active call to your team phone.",
        context: nextContext,
        suggestions: ["Which agent is best for home services?", "Show all agents"]
      };

    case "architect_info": {
      const price = extractPriceAmount(query);
      if (price !== null) {
        const earnings = price * 0.7;
        return {
          reply: `Architects receive a **70% revenue share** on all installations and subscriptions of their agents. If your agent is priced at **$${price.toFixed(2)}** and a business purchases it, you will receive **$${earnings.toFixed(2)}** (70% of the price) paid directly to your connected Stripe account.`,
          context: nextContext,
          suggestions: ["How do I get paid?", "How do I build an agent?", "Show all agents"]
        };
      }
      return {
        reply: "AI Architects can build agents visually using our drag-and-drop builder, publish listings to the marketplace, and **earn 70% recurring revenue** on every business subscription. Payments are processed securely via **Stripe Connect** linkable under profile settings.",
        context: nextContext,
        suggestions: ["How do I build an agent?", "How do I get paid?"]
      };
    }

    case "recommend_usecase": {
      const industry = extractIndustryEntity(query);
      if (industry === "dental") {
        return {
          reply: "For **dental clinics**, we highly recommend the **Dental AI Receptionist** agent. It answers patient phone calls, qualifies emergency cases like toothaches, answers insurance queries, and books appointment slots directly into your Google Calendar. You can pair it with a booster agent to increase Google reviews.",
          context: nextContext,
          suggestions: ["Estimate dental agent cost", "Show dental receptionist features"]
        };
      } else if (industry === "hvac") {
        return {
          reply: "For **home services (HVAC, plumbing, roofing)**, we recommend the **AI Receptionist / Missed Call Recovery** agent. When you are on-site and miss a call, it automatically texts the customer back in under 30 seconds to answer questions and schedule a visit, preventing leads from going to competitors.",
          context: nextContext,
          suggestions: ["Show missed call text-back features", "What does a phone call cost?"]
        };
      } else if (industry === "salon") {
        return {
          reply: "For **salons, spas, and barbershops**, we recommend the **After-Hours Receptionist** and the **Appointment Reminder & Confirm** agents. They enable 24/7 appointment scheduling, send automatic text reminders 24 hours prior, and handle cancellations/rescheduling to reduce no-shows.",
          context: nextContext,
          suggestions: ["How does pricing work?", "Show all agents"]
        };
      } else if (industry === "startup" || industry === "real estate") {
        return {
          reply: "For **startups and real estate agents**, we recommend the **Lead Qualification Bot**. It qualifies incoming inquiries (asking budget, timeline, location) automatically via SMS, scores their interest level, and alerts you of hot leads while nurturing cold ones.",
          context: nextContext,
          suggestions: ["Estimate qualification agent cost", "Show lead qualification features"]
        };
      }
      
      return {
        reply: "To recommend the best agent, what industry is your business in? (e.g. dental, plumbing, salon, startup, real estate)",
        context: nextContext,
        suggestions: ["Dentist clinic", "HVAC / Home services", "Salon / Spa", "Startup"]
      };
    }

    case "contact_info":
      return {
        reply: "You can reach us anytime at **info@triven.ai** for support, partnerships, or billing queries. We do not offer direct phone support at the moment, but we respond to all email inquiries in under 12 hours!",
        context: nextContext,
        suggestions: ["How do I get started?", "Show all agents", "How does pricing work?"]
      };

    case "free_trial":
      return {
        reply: "Yes! Triven offers a free trial of your first **50 executions** (e.g. calls, texts) with zero setup costs and **no credit card required** to register or test.",
        context: nextContext,
        suggestions: ["How do I get started?", "Estimate my monthly cost", "Show all agents"]
      };

    case "unknown":
    default:
      // If we mention an agent in query, give a details fallback
      if (queryAgent) {
        return {
          reply: `I see you mentioned the **${queryAgent.name}**. It costs ${queryAgent.priceCents === 0 ? 'Free-to-install' : `$${(queryAgent.priceCents/100).toFixed(0)}`} (${queryAgent.pricingModel}) and features: *${queryAgent.shortDescription}*. Would you like to run a pricing calculation for it?`,
          context: nextContext,
          suggestions: [`Estimate bill for ${queryAgent.name}`, "What features does it have?", "Show all agents"]
        };
      }

      // Initiate contact and feedback collection loop
      nextContext.awaitingInput = "fallback_email";
      nextContext.fallbackQuery = query;
      return {
        reply: "I'm sorry, I couldn't find an answer to your question. I would love to have our team contact you to help you directly! To get started, could you please provide your **email address**?",
        context: nextContext,
        suggestions: []
      };
  }
}

export function processMessage(
  message: string,
  context: ChatbotContext,
  listings: AgentListingSummary[]
): ChatbotResponse {
  const response = processMessageInner(message, context, listings);
  let nextContext = { ...response.context };

  // Only trigger proactive feedback if the bot actually responded to a standard query and did not start a fallback/calculator input loop
  const justFinishedInput = context.awaitingInput !== null && context.awaitingInput !== undefined;
  const startingNewInput = response.context.awaitingInput !== null && response.context.awaitingInput !== undefined;

  if (!justFinishedInput && !startingNewInput && response.context.lastIntent !== "unknown") {
    const nextCount = (context.queryCount || 0) + 1;
    nextContext.queryCount = nextCount;
    // Ask feedback after every 3rd or 4th query (using 4th query)
    if (nextCount > 0 && nextCount % 4 === 0) {
      nextContext.awaitingInput = "general_feedback";
      return {
        ...response,
        reply: response.reply + "\n\n💬 **Quick Question:** You've asked a few questions today. What were you hoping to find, or how can we improve Triven?",
        context: nextContext,
        suggestions: [] // Clear suggestions to focus user on the feedback query
      };
    }
  }

  // Preserve query count increment for non-triggering turns
  if (!justFinishedInput && !startingNewInput) {
    nextContext.queryCount = (context.queryCount || 0) + 1;
  }
  
  return {
    ...response,
    context: nextContext
  };
}
