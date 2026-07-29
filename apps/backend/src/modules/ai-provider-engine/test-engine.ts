import "../../config/env"; // ensure .env is loaded via dotenv/config
import {
  initProviderEngine,
  getProviderEngine,
  AIProviderEngine,
} from "./ai-provider-engine";
import type { AIExecuteRequest, AIContinueRequest } from "./ai-provider-engine";

const DIVIDER = "─".repeat(60);

function log(label: string, value: unknown) {
  console.log(`  ${label}:`, JSON.stringify(value, null, 2));
}

async function testExplicitProvider(
  engine: AIProviderEngine,
  providerId: string,
  model: string,
  testNum: number,
  displayName: string,
  systemPrompt?: string
) {
  console.log("\n" + DIVIDER);
  console.log(` Test ${testNum}: Explicit Provider — ${displayName}`);
  console.log(DIVIDER);

  const req: AIExecuteRequest = {
    messages: [{ role: "user", content: "What is 2 + 2? Reply with just the number." }],
    model,
    systemPrompt,
  };
  const resp = await engine.executeWithProvider(providerId, req);
  log("Status", resp.status);
  log("Model", resp.modelName);
  log("Text", resp.text);
  log("Tokens", resp.usage);
  log("Cost (USD)", resp.cost);
  if (resp.status === "error") {
    log("Error", resp.error);
  }
}

async function runTests() {
  console.log("\n" + DIVIDER);
  console.log(" AI Provider Engine — Integration Tests");
  console.log(DIVIDER);

  await initProviderEngine();

  const engine = getProviderEngine();
  const registered = engine.listProviders();
  const active = engine.listActiveProviders();

  console.log("\n[Registry]");
  log("Registered", registered);
  log("Active (validated)", active);

  if (active.length === 0) {
    console.error("\n⚠ No active providers. Set at least one API key in .env and re-run.");
    process.exit(1);
  }

  /* ------------------------------------------------------------------ */
  /* 1. Auto-routing — simple chat                                        */
  /* ------------------------------------------------------------------ */
  console.log("\n" + DIVIDER);
  console.log(" Test 1: Auto-routing — Simple Chat");
  console.log(DIVIDER);

  const chatRequest: AIExecuteRequest = {
    messages: [{ role: "user", content: "Hello! Briefly introduce yourself in one sentence." }],
  };

  const explanation = engine.explainSelection(chatRequest);
  log("Intent classified", explanation.intent);
  log("Scores", explanation.scores);
  log("Selection reason", explanation.reason);

  const chatResponse = await engine.executeAI(chatRequest);
  log("Status", chatResponse.status);
  log("Provider used", chatResponse.providerId);
  log("Model", chatResponse.modelName);
  log("Text", chatResponse.text);
  log("Usage", chatResponse.usage);
  log("Cost (USD)", chatResponse.cost);
  log("Duration (ms)", chatResponse.durationMs);
  if (chatResponse.status === "error") {
    log("Error", chatResponse.error);
  }
  console.assert(chatResponse.status === "success", "Expected status=success");
  console.assert(typeof chatResponse.text === "string", "Expected text to be a string");
  console.assert(!chatResponse.text?.includes("mock"), "Response must NOT be a mock");

  /* ------------------------------------------------------------------ */
  /* 2. Auto-routing — coding task                                        */
  /* ------------------------------------------------------------------ */
  console.log("\n" + DIVIDER);
  console.log(" Test 2: Auto-routing — Code Task");
  console.log(DIVIDER);

  const codeRequest: AIExecuteRequest = {
    messages: [{ role: "user", content: "Write a TypeScript function that debounces an async function." }],
  };

  const codeExplanation = engine.explainSelection(codeRequest);
  log("Intent classified", codeExplanation.intent);
  log("Selected provider", codeExplanation.selectedProviderId);

  const codeResponse = await engine.executeAI(codeRequest);
  log("Status", codeResponse.status);
  log("Provider used", codeResponse.providerId);
  log("Text (truncated)", (codeResponse.text ?? "").slice(0, 200) + "...");
  log("Tokens", codeResponse.usage);
  if (codeResponse.status === "error") {
    log("Error", codeResponse.error);
  }

  /* ------------------------------------------------------------------ */
  /* 3. JSON output format — text → JSON conversion                       */
  /* ------------------------------------------------------------------ */
  console.log("\n" + DIVIDER);
  console.log(" Test 3: JSON Output (text→JSON conversion)");
  console.log(DIVIDER);

  const jsonRequest: AIExecuteRequest = {
    messages: [
      {
        role: "user",
        content: 'Return a JSON object with two fields: "language" (string) and "year" (number). Example: {"language": "TypeScript", "year": 2012}',
      },
    ],
    outputFormat: "json",
  };

  const jsonResponse = await engine.executeAI(jsonRequest);
  log("Status", jsonResponse.status);
  log("Raw text", jsonResponse.text);
  log("Parsed structuredOutput", jsonResponse.structuredOutput);
  if (jsonResponse.status === "error") {
    log("Error", jsonResponse.error);
  }
  console.assert(jsonResponse.status === "success", "Expected success");

  /* ------------------------------------------------------------------ */
  /* 4. Explicit provider — OpenAI                                        */
  /* ------------------------------------------------------------------ */
  if (active.includes("openai")) {
    await testExplicitProvider(engine, "openai", "gpt-4o-mini", 4, "OpenAI");
  }

  /* ------------------------------------------------------------------ */
  /* 5. Explicit provider — Claude                                        */
  /* ------------------------------------------------------------------ */
  if (active.includes("claude")) {
    await testExplicitProvider(
      engine,
      "claude",
      "claude-haiku-3-5",
      5,
      "Claude",
      "You are a concise math assistant."
    );
  }

  /* ------------------------------------------------------------------ */
  /* 6. Explicit provider — Gemini                                        */
  /* ------------------------------------------------------------------ */
  if (active.includes("gemini")) {
    await testExplicitProvider(engine, "gemini", "gemini-3.0-flash", 6, "Gemini");
  }

  /* ------------------------------------------------------------------ */
  /* 7. Multi-turn conversation continuation                              */
  /* ------------------------------------------------------------------ */
  if (active.length > 0) {
    const providerId = active[0]!;
    console.log("\n" + DIVIDER);
    console.log(` Test 7: Conversation Continuation (${providerId})`);
    console.log(DIVIDER);

    // Turn 1
    const turn1: AIExecuteRequest = {
      messages: [{ role: "user", content: "My name is Alice. Remember this." }],
    };
    const turn1Resp = await engine.executeWithProvider(providerId, turn1);
    log("Turn 1 status", turn1Resp.status);
    log("Turn 1 text", turn1Resp.text);
    if (turn1Resp.status === "error") {
      log("Turn 1 error", turn1Resp.error);
    }
 
    // Turn 2 — pass history so the model remembers
    const turn2: AIContinueRequest = {
      conversationId: "test-session-001",
      conversationHistory: [
        { role: "user", content: "My name is Alice. Remember this." },
        { role: "assistant", content: turn1Resp.text ?? "" },
      ],
      messages: [{ role: "user", content: "What is my name?" }],
    };
    const turn2Resp = await engine.executeWithProvider(providerId, turn2);
    log("Turn 2 status", turn2Resp.status);
    log("Turn 2 text", turn2Resp.text);
    if (turn2Resp.status === "error") {
      log("Turn 2 error", turn2Resp.error);
    }
    const nameRecalled = turn2Resp.text?.toLowerCase().includes("alice") ?? false;
    console.assert(nameRecalled, "Model should recall the name 'Alice' from history");
    log("Name recalled correctly", nameRecalled);
  }

  /* ------------------------------------------------------------------ */
  /* 8. Error handling — invalid API key                                  */
  /* ------------------------------------------------------------------ */
  if (active.includes("openai")) {
    console.log("\n" + DIVIDER);
    console.log(" Test 8: Error Handling — Invalid Key");
    console.log(DIVIDER);

    // Temporarily override env to simulate an invalid key
    const original = process.env["OPENAI_API_KEY"];
    process.env["OPENAI_API_KEY"] = "sk-invalid-key-for-testing";
    try {
      const badReq: AIExecuteRequest = {
        messages: [{ role: "user", content: "test" }],
      };
      const badResp = await engine.executeWithProvider("openai", badReq);
      log("Status", badResp.status);
      log("Error", badResp.error);
      console.assert(badResp.status === "error", "Expected error status for invalid key");
    } finally {
      process.env["OPENAI_API_KEY"] = original;
    }
  }

  /* ------------------------------------------------------------------ */
  /* 9. Cost estimation                                                   */
  /* ------------------------------------------------------------------ */
  if (active.length > 0) {
    console.log("\n" + DIVIDER);
    console.log(" Test 9: Cost Estimation");
    console.log(DIVIDER);

    const costReq: AIExecuteRequest = {
      messages: [{ role: "user", content: "Explain quantum entanglement in detail." }],
      maxTokens: 500,
    };
    for (const pid of active) {
      const cost = await engine.estimateCost(pid, costReq);
      log(`Cost estimate [${pid}]`, cost);
    }
  }

  /* ------------------------------------------------------------------ */
  /* 10. Provider validation                                              */
  /* ------------------------------------------------------------------ */
  console.log("\n" + DIVIDER);
  console.log(" Test 10: Provider Validation");
  console.log(DIVIDER);

  const validationResults = await engine.validateAll();
  for (const [pid, result] of validationResults) {
    log(`Validate [${pid}]`, result);
  }

  /* ------------------------------------------------------------------ */
  /* 11. Workflow Context & Previous Node Memory                          */
  /* ------------------------------------------------------------------ */
  if (active.length > 0) {
    console.log("\n" + DIVIDER);
    console.log(" Test 11: Workflow Context & Previous Node Memory");
    console.log(DIVIDER);

    const contextReq: AIExecuteRequest = {
      messages: [{ role: "user", content: "Respond by listing the current user ID and database state from your context." }],
      workflowContext: {
        userId: "usr_987654",
        flowId: "flow_abc123",
      },
      previousNodeMemory: {
        dbStatus: "synced",
        lastCheckedMs: 1718000000000,
      },
    };

    const explanation = engine.explainSelection(contextReq);
    const pid = explanation.selectedProviderId;

    const contextResponse = await engine.executeAI(contextReq);
    log("Status", contextResponse.status);
    log("Provider used", contextResponse.providerId);
    log("Text", contextResponse.text);
    if (contextResponse.status === "error") {
      log("Error", contextResponse.error);
    }
    console.assert(contextResponse.status === "success", "Expected status=success");
  }

  /* ------------------------------------------------------------------ */
  /* 12. Attached Files (Multimodal Input)                                */
  /* ------------------------------------------------------------------ */
  if (active.length > 0) {
    console.log("\n" + DIVIDER);
    console.log(" Test 12: Attached Files (Multimodal Input)");
    console.log(DIVIDER);

    // 1x1 transparent pixel PNG base64 representation
    const mockImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
    const multimodalReq: AIExecuteRequest = {
      messages: [{ role: "user", content: "What is this image? Describe its color or state (it is a tiny transparent pixel)." }],
      attachments: [{
        mimeType: "image/png",
        data: mockImageBase64,
      }],
      maxTokens: 50,
    };

    for (const pid of active) {
      console.log(`Testing multimodal attachments with provider: ${pid}`);
      try {
        const response = await engine.executeWithProvider(pid, multimodalReq);
        log(`Response from [${pid}]`, response.status);
        log(`Text [${pid}]`, response.text);
        if (response.status === "error") {
          log(`Error [${pid}]`, response.error);
        }
      } catch (err) {
        console.error(`Multimodal test failed for provider ${pid}:`, err);
      }
    }
  }

  console.log("\n" + DIVIDER);
  console.log(" All tests completed.");
  console.log(DIVIDER + "\n");
}

runTests().catch((err) => {
  console.error("\nTest run failed:", err);
  process.exit(1);
});
