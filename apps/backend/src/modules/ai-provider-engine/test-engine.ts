// Mock the API keys in environment so all adapters pass validation and activate
process.env["OPENAI_API_KEY"] = "mock-key";
process.env["ANTHROPIC_API_KEY"] = "mock-key";
process.env["GOOGLE_AI_API_KEY"] = "mock-key";

import {
  initProviderEngine,
  getProviderEngine,
  AIExecuteRequest,
} from "./ai-provider-engine";

async function runTests() {
  console.log("=== Initialising Provider Engine ===");
  await initProviderEngine();

  const engine = getProviderEngine();
  console.log("\nRegistered Providers:", engine.listProviders());
  console.log("Active (Validated) Providers:", engine.listActiveProviders());

  const testCases: Array<{ name: string; request: AIExecuteRequest }> = [
    {
      name: "Simple Chat",
      request: {
        messages: [{ role: "user", content: "Hi! How are you doing today?" }],
      },
    },
    {
      name: "Coding Task",
      request: {
        messages: [{ role: "user", content: "Write a python function to fetch data from api" }],
      },
    },
    {
      name: "Reasoning Task",
      request: {
        messages: [{ role: "user", content: "Explain step by step why the database query is slow" }],
      },
    },
    {
      name: "Image Generation",
      request: {
        messages: [{ role: "user", content: "Generate an image of a blue bird sitting on a branch" }],
      },
    },
  ];

  console.log("\n=== Testing Selection & Execution ===");
  for (const tc of testCases) {
    console.log(`\n--- Test Case: ${tc.name} ---`);
    console.log(`Prompt: "${tc.request.messages[0].content}"`);

    // 1. Explain the selector's decision matrix
    const explanation = engine.explainSelection(tc.request);
    console.log(`Intent Classified: "${explanation.intent}"`);
    console.log("Scores Table:", explanation.scores);
    console.log(`Selection decision: ${explanation.reason}`);

    // 2. Execute the request
    const response = await engine.executeAI(tc.request);
    console.log("Response Result:", {
      status: response.status,
      providerUsed: response.providerId,
      text: response.text,
      estimatedUsage: response.usage,
      estimatedCost: response.cost,
    });
  }
}

runTests().catch((err) => {
  console.error("Test failed:", err);
});
