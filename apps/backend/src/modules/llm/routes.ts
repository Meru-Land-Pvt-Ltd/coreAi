import { Hono } from "hono";

export const llmRoutes = new Hono()
  .get("/providers", (c) =>
    c.json({
      providers: ["openai", "anthropic", "gemini", "openrouter", "groq", "mistral", "deepseek"],
    }),
  )
  .post("/chat", (c) => c.json({ message: "llm gateway chat placeholder" }));
