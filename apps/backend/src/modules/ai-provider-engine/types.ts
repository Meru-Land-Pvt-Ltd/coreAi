export type AIMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AIAttachment = {
  mimeType: string;
  data: string; // base64 or URL
  name?: string;
};

export type CostEstimate = {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  model: string;
};

export type ValidationResult = {
  valid: boolean;
  message: string;
};

export type AITokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type AIIntent = "chat" | "reasoning" | "code" | "image";

export type ProviderCapability = "llm" | "tts" | "stt" | "image-gen" | "embeddings";

export type ModelInfo = {
  modelId: string;
  displayName: string;
  providerId: string;
  contextWindow?: number;
  inputPricePerMToken?: number;
  outputPricePerMToken?: number;
  isDeprecated: boolean;
  source: "api" | "static";
};

export type AIExecuteRequest = {
  // defaults to "llm" when omitted
  capability?: ProviderCapability;
  model?: string;
  metadata?: Record<string, unknown>;

  // LLM
  messages?: AIMessage[];
  systemPrompt?: string;
  conversationHistory?: AIMessage[];
  workflowContext?: Record<string, unknown>;
  previousNodeMemory?: Record<string, unknown>;
  attachments?: AIAttachment[];
  temperature?: number;
  maxTokens?: number;
  outputFormat?: "text" | "json";
  task?: string;

  // TTS
  inputText?: string;
  voice?: string;

  // STT
  audioData?: Buffer | string;
  language?: string;

  // Image generation
  imagePrompt?: string;
  imageSize?: string;
};

export type AIContinueRequest = AIExecuteRequest & {
  conversationId: string;
};

export interface AIProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly capabilities: ProviderCapability[];
  readonly scores: Partial<Record<AIIntent, number>>;
  readonly models: string[];
  validate(): Promise<ValidationResult>;
  execute(request: AIExecuteRequest): Promise<AIExecuteResponse>;
  continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse>;
  estimateCost(request: AIExecuteRequest): Promise<CostEstimate>;
  listModels?(): Promise<ModelInfo[]>;
  updateModelsAndPricing?(models: string[], pricing: Record<string, { input: number; output: number }>): void;
}

export type AIExecuteResponse = {
  status: "success" | "error" | "partial";
  capability: ProviderCapability;

  // LLM
  text: string | null;
  structuredOutput: unknown | null;

  // TTS
  audioData?: Buffer;
  audioMimeType?: string;

  // Image generation
  imageUrl?: string;

  // Embeddings
  embeddings?: number[];

  attachments: AIAttachment[];
  usage: AITokenUsage;
  cost: CostEstimate | null;
  conversationId: string | null;
  providerMetadata: Record<string, unknown>;
  providerId: string;
  modelName: string;
  durationMs: number;
  error: string | null;
};

export type SelectionExplanation = {
  selectedProviderId: string;
  scores: Record<string, number>;
  intent: AIIntent;
  reason: string;
};
