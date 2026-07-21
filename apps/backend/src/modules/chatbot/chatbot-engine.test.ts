import { describe, it, expect } from "vitest";
import {
  getLevenshteinDistance,
  fuzzyMatchWord,
  normalizeText,
  expandTokens,
  extractExecutionCount,
  extractAgentEntity,
  extractConnectorEntity,
  extractIndustryEntity,
  classifyIntent,
  calculateCost,
  processMessage,
  type AgentListingSummary,
  type ChatbotContext
} from "./chatbot-engine";

const mockListings: AgentListingSummary[] = [
  {
    id: "agent-1",
    name: "AI Receptionist",
    shortDescription: "Automatically texts back customers when calls are missed.",
    priceCents: 9900,
    pricingModel: "SUBSCRIPTION",
    requiredConnectors: ["TWILIO", "GOOGLE_CALENDAR"],
    includedFeatures: ["Missed call detection", "SMS auto text-back", "Google calendar booking"],
    category: "Customer Support",
    industryTags: ["dental", "medical", "home services"],
    tags: ["phone", "sms", "booking"]
  },
  {
    id: "agent-2",
    name: "Lead Qualification Bot",
    shortDescription: "Qualifies prospects and syncs details to your CRM.",
    priceCents: 15000,
    pricingModel: "ONE_TIME",
    requiredConnectors: ["WHATSAPP", "HUBSPOT"],
    includedFeatures: ["Qualify budget & timeline", "WhatsApp updates", "CRM sync"],
    category: "Marketing",
    industryTags: ["startup", "real estate", "agencies"],
    tags: ["leads", "whatsapp", "crm"]
  }
];

describe("Chatbot Engine Unit Tests", () => {
  describe("Levenshtein Distance", () => {
    it("should compute accurate edit distance", () => {
      expect(getLevenshteinDistance("pricing", "pricing")).toBe(0);
      expect(getLevenshteinDistance("billing", "billingg")).toBe(1);
      expect(getLevenshteinDistance("receptionist", "recepsionist")).toBe(1);
      expect(getLevenshteinDistance("twilio", "twilo")).toBe(1);
    });

    it("should fuzzy match words with typos", () => {
      expect(fuzzyMatchWord("billingg", "billing")).toBe(true);
      expect(fuzzyMatchWord("recepsionist", "receptionist")).toBe(true);
      expect(fuzzyMatchWord("twilo", "twilio")).toBe(true);
      expect(fuzzyMatchWord("agent", "agent")).toBe(true);
    });
  });

  describe("Text Preprocessing & Synonym Map", () => {
    it("should normalize queries", () => {
      const result = normalizeText("Hi! What is Triven AI (and how does it work)?");
      expect(result).toContain("hi");
      expect(result).toContain("what");
      expect(result).toContain("triven");
      expect(result).toContain("work");
    });

    it("should expand synonyms", () => {
      const tokens = ["cost", "bot"];
      const expanded = expandTokens(tokens);
      expect(expanded).toContain("pricing");
      expect(expanded).toContain("agent");
    });
  });

  describe("Entity Extraction", () => {
    it("should extract requests counts", () => {
      expect(extractExecutionCount("50,000 requests")).toBe(50000);
      expect(extractExecutionCount("10k runs")).toBe(10000);
      expect(extractExecutionCount("5.5k calls")).toBe(5500);
      expect(extractExecutionCount("I want 500 executions")).toBe(500);
    });

    it("should match agents in query text", () => {
      const match1 = extractAgentEntity("I want to buy the AI Receptionist", mockListings);
      expect(match1?.id).toBe("agent-1");

      const match2 = extractAgentEntity("Tell me about the lead qual bot", mockListings);
      expect(match2?.id).toBe("agent-2");
    });

    it("should extract connector keys", () => {
      expect(extractConnectorEntity("Does it support whatsapp?")).toBe("WHATSAPP");
      expect(extractConnectorEntity("Google calendar scheduler")).toBe("GOOGLE_CALENDAR");
      expect(extractConnectorEntity("twilio SMS bot")).toBe("TWILIO");
    });

    it("should extract industries", () => {
      expect(extractIndustryEntity("Recommendation for dental clinic")).toBe("dental");
      expect(extractIndustryEntity("best bot for a plumber")).toBe("hvac");
      expect(extractIndustryEntity("options for a startup")).toBe("startup");
    });
  });

  describe("Intent Classification", () => {
    it("should classify standard query intents", () => {
      expect(classifyIntent("What is Triven?")).toBe("company_info");
      expect(classifyIntent("how does setup work")).toBe("how_it_works");
      expect(classifyIntent("how much does an execution cost?")).toBe("pricing_general");
      expect(classifyIntent("do you support google calendar?")).toBe("calendar_connector");
      expect(classifyIntent("who builds the agents")).toBe("architect_info");
    });
  });

  describe("Pricing Calculator Engine", () => {
    it("should compute cost breakdown correctly", () => {
      const agent = mockListings[0]; // Subscription at $99.00
      
      // Standard runs (e.g. 200 runs) -> No discount
      const cost1 = calculateCost(agent, 200);
      expect(cost1.baseFee).toBe(99);
      expect(cost1.rawUsageCost).toBe(40); // 200 * $0.20
      expect(cost1.discountAmount).toBe(0);
      expect(cost1.totalCost).toBe(139);

      // Scale runs (e.g. 2,000 runs) -> 20% discount on usage
      const cost2 = calculateCost(agent, 2000);
      expect(cost2.baseFee).toBe(99);
      expect(cost2.rawUsageCost).toBe(400); // 2000 * $0.20
      expect(cost2.discountRate).toBe(0.20);
      expect(cost2.discountAmount).toBe(80); // 400 * 20%
      expect(cost2.totalCost).toBe(419); // 99 + (400 - 80)
    });
  });

  describe("Conversational Flow & Message Processing", () => {
    it("should process standard static questions", () => {
      const response = processMessage("what is Triven AI?", {}, mockListings);
      expect(response.reply).toContain("Triven is an **AI Agent Marketplace**");
      expect(response.context.lastIntent).toBe("company_info");
    });

    it("should initiate cost calculator state", () => {
      const response = processMessage("estimate my monthly cost", {}, mockListings);
      expect(response.reply).toContain("which agent are you interested in");
      expect(response.context.awaitingInput).toBe("calculator_agent");
    });

    it("should walk through the calculator flow", () => {
      let ctx: ChatbotContext = { awaitingInput: "calculator_agent" };
      
      // Step 1: User provides agent name
      let res = processMessage("AI Receptionist", ctx, mockListings);
      expect(res.reply).toContain("Let's calculate the cost for the **AI Receptionist**");
      expect(res.context.awaitingInput).toBe("calculator_usage");
      expect(res.context.lastMentionedAgentId).toBe("agent-1");
      ctx = res.context;

      // Step 2: User provides executions count
      res = processMessage("500 calls", ctx, mockListings);
      expect(res.reply).toContain("estimated monthly cost projection");
      expect(res.reply).toContain("AI Receptionist");
      expect(res.reply).toContain("500 executions");
      expect(res.context.awaitingInput).toBeNull();
    });

    it("should evaluate cost calculation in single query", () => {
      const response = processMessage("How much is AI Receptionist with 10k requests?", {}, mockListings);
      expect(response.reply).toContain("estimated monthly cost projection");
      expect(response.reply).toContain("AI Receptionist");
      expect(response.reply).toContain("10,000 executions");
      expect(response.reply).toContain("30% off"); // Volume discount for 10k runs (>= 5000 runs is 30% off)
    });

    it("should walk through fallback collection flow", () => {
      let ctx: ChatbotContext = {};

      // 1. Initial unknown query
      let res = processMessage("wash my car", ctx, mockListings);
      expect(res.reply).toContain("provide your **email address**");
      expect(res.context.awaitingInput).toBe("fallback_email");
      expect(res.context.fallbackQuery).toBe("wash my car");
      ctx = res.context;

      // 2. Invalid email check
      res = processMessage("bad-email", ctx, mockListings);
      expect(res.reply).toContain("valid email address");
      expect(res.context.awaitingInput).toBe("fallback_email");
      ctx = res.context;

      // 3. Valid email check
      res = processMessage("test@triven.ai", ctx, mockListings);
      expect(res.reply).toContain("phone number");
      expect(res.context.awaitingInput).toBe("fallback_phone");
      expect(res.context.fallbackEmail).toBe("test@triven.ai");
      ctx = res.context;

      // 4. Invalid phone check
      res = processMessage("123", ctx, mockListings);
      expect(res.reply).toContain("valid phone number");
      expect(res.context.awaitingInput).toBe("fallback_phone");
      ctx = res.context;

      // 5. Valid phone check
      res = processMessage("+15551234567", ctx, mockListings);
      expect(res.reply).toContain("how can we improve");
      expect(res.context.awaitingInput).toBe("fallback_feedback");
      expect(res.context.fallbackPhone).toBe("+15551234567");
      ctx = res.context;

      // 6. Provide feedback (ends loop and sets saveFeedback)
      res = processMessage("Make a car wash agent", ctx, mockListings);
      expect(res.reply).toContain("successfully saved your contact details");
      expect(res.context.awaitingInput).toBeNull();
      expect(res.saveFeedback).toEqual({
        email: "test@triven.ai",
        phone: "+15551234567",
        query: "wash my car",
        feedback: "Make a car wash agent"
      });
    });

    it("should trigger proactive feedback loop on the 4th query and save it", () => {
      let ctx: ChatbotContext = {};

      // Query 1
      let res = processMessage("hello", ctx, mockListings);
      expect(res.reply).toContain("Welcome to Triven");
      expect(res.context.queryCount).toBe(1);
      expect(res.context.awaitingInput).toBeUndefined();
      ctx = res.context;

      // Query 2
      res = processMessage("what is triven", ctx, mockListings);
      expect(res.reply).toContain("AI Agent Marketplace");
      expect(res.context.queryCount).toBe(2);
      expect(res.context.awaitingInput).toBeUndefined();
      ctx = res.context;

      // Query 3
      res = processMessage("how does pricing work", ctx, mockListings);
      expect(res.reply).toContain("transparent and pay-for-results");
      expect(res.context.queryCount).toBe(3);
      expect(res.context.awaitingInput).toBeUndefined();
      ctx = res.context;

      // Query 4 (should trigger proactive feedback prompt)
      res = processMessage("do you offer a free trial", ctx, mockListings);
      expect(res.reply).toContain("50 executions");
      expect(res.reply).toContain("Quick Question"); // Should contain the feedback prompt
      expect(res.context.queryCount).toBe(4);
      expect(res.context.awaitingInput).toBe("general_feedback");
      ctx = res.context;

      // Query 5 (User submits feedback response)
      res = processMessage("I love the marketplace options!", ctx, mockListings);
      expect(res.reply).toContain("Thank you so much for your feedback");
      expect(res.context.awaitingInput).toBeNull();
      expect(res.saveFeedback).toEqual({
        email: "feedback@triven.ai",
        phone: "N/A",
        query: "Proactive Feedback Request",
        feedback: "I love the marketplace options!"
      });
    });
  });
});
