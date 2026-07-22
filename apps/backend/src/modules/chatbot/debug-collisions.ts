import { fuzzyMatchWord } from "./chatbot-engine";

const COMMON_WORDS = [
  "your", "you", "have", "has", "how", "what", "who", "why", "when", "where", "with",
  "this", "that", "them", "they", "their", "there", "here", "help", "line", "number",
  "get", "give", "show", "tell", "want", "like", "need", "does", "do", "can",
  "could", "would", "will", "should", "shall", "an", "the", "a", "is", "are",
  "was", "were", "be", "been", "being", "to", "from", "for", "of", "in", "on",
  "at", "by", "about", "your", "mine", "my", "me", "us", "we", "our", "ours"
];

const KEYWORDS_TO_TEST = [
  // greet
  "hi", "hello", "hey", "greetings", "sup", "yo", "start",
  // company_info
  "triven", "company", "mission", "purpose",
  // how_it_works
  "work", "flow", "onboard", "setup", "install", "use",
  // services
  "service", "services", "provide", "feature", "features", "offer", "capabilities",
  // agent_list
  "count", "catalog", "catalogue", "agents", "available",
  // cheapest_option
  "cheapest", "lowest", "least", "free", "cheap",
  // whatsapp
  "whatsapp", "chat",
  // twilio
  "twilio", "phone", "call", "calls", "voice", "receptionist", "telephony",
  // calendar
  "calendar", "schedule", "scheduling", "book", "booking",
  // pricing_calculator
  "calculator", "estimate", "bill", "usage", "calculate",
  // pricing_general
  "pricing", "cost", "charge", "fees", "pay", "plan", "plans", "payment", "subscription",
  // refund
  "refund", "guarantee", "cancelation", "cancel",
  // setup_time
  "minutes", "time", "days", "weeks",
  // human_handoff
  "human", "escalate", "transfer", "team", "person", "staff",
  // architect
  "build", "builds", "architect", "earning", "earn", "developer", "revenue", "commission",
  // recommend
  "recommend", "best", "fit", "clinic", "dentist", "hvac", "startup", "salon", "plumber", "realtor", "business",
  // contact
  "contact", "email", "support", "address", "reach", "contac"
];

console.log("Analyzing fuzzy match collisions between common words and intent keywords...");
let collisionsCount = 0;

for (const word of COMMON_WORDS) {
  for (const keyword of KEYWORDS_TO_TEST) {
    if (word === keyword) continue; // Exact equal is expected if a common word is a keyword
    if (fuzzyMatchWord(word, keyword)) {
      console.log(`COLLISION DETECTED: Common word "${word}" fuzzy-matches keyword "${keyword}"`);
      collisionsCount++;
    }
  }
}

console.log(`Analysis complete. Found ${collisionsCount} collisions.`);
