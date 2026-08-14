import { apiGet, apiPost } from "@/lib/api";

export type AiPricingProvider = {
  id: string;
  displayName: string;
  envKey: string;
  configured: boolean;
};

export type AiPricingModel = {
  modelId: string;
  displayName: string;
  providerId: string;
  inputPricePer1MToken: number | null;
  outputPricePer1MToken: number | null;
  source: "api";
};

export type AiPricingProviderResponse = {
  providers: AiPricingProvider[];
};

export type AiPricingModelResponse = {
  provider: AiPricingProvider;
  models: AiPricingModel[];
};

export function getAiPricingProviders() {
  return apiGet<AiPricingProviderResponse>("/payments/ai-pricing");
}

export function getAiPricingModels(providerId: string) {
  return apiGet<AiPricingModelResponse>(`/payments/ai-pricing/${providerId}`);
}

export function previewAdminAiProviderModels(providerId: string, apiKey?: string) {
  return apiPost<AiPricingModelResponse>(`/admin/api-settings/ai-pricing/${providerId}`, {
    ...(apiKey ? { apiKey } : {})
  });
}

export function formatAiTokenPrice(value: number | null): string {
  if (value === null) return "Not published";
  return `$${value >= 1 ? value.toFixed(2) : value.toFixed(3)}`;
}
