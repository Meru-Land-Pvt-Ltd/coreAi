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

export type AIExecuteRequest = {
  messages: AIMessage[];
  /** Prior conversation turns — passed by Memory Broker in future integration */
  conversationHistory?: AIMessage[];
  systemPrompt?: string;
  workflowContext?: Record<string, unknown>;
  previousNodeMemory?: Record<string, unknown>;
  attachments?: AIAttachment[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  outputFormat?: "text" | "json";
  task?: string;
  metadata?: Record<string, unknown>;
};

export type AIContinueRequest = AIExecuteRequest & {
  conversationId: string;
};

export interface AIProviderAdapter {
  readonly providerId: string;
  readonly displayName: string;
  readonly scores: Partial<Record<AIIntent, number>>;
  readonly models: string[];
  validate(): Promise<ValidationResult>;
  execute(request: AIExecuteRequest): Promise<AIExecuteResponse>;
  continueConversation(request: AIContinueRequest): Promise<AIExecuteResponse>;
  estimateCost(request: AIExecuteRequest): Promise<CostEstimate>;
}

export type AIExecuteResponse = {
  status: "success" | "error" | "partial";
  text: string | null;
  structuredOutput: unknown | null;
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
