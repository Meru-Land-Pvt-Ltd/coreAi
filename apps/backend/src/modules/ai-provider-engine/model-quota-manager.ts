import { env } from "../../config/env";

export type ModelStatus = {
  model: string;
  provider: "gemini" | "stability" | "dalle";
  hasKey: boolean;
  isQuotaExceeded: boolean;
  cooldownRemainingMs: number;
  available: boolean;
  disabledReason?: string;
};

const THREE_HOURS_MS = 3 * 60 * 60 * 1000;

// Model to provider mapping
const MODEL_PROVIDER_MAP: Record<string, "gemini" | "stability" | "dalle"> = {
  "gemini-3.1-flash-image": "gemini",
  "gemini-3.1-flash-lite-image": "gemini",
  "gemini-3-pro-image": "gemini",
  "gemini-2.5-flash-image": "gemini",
  "imagen-3.0-generate-002": "gemini",
  "sd3.5-large": "stability",
  "sd3.5-large-turbo": "stability",
  "sd3.5-medium": "stability",
  "sd3.5-flash": "stability",
  "stable-diffusion-xl-1024-v1-0": "stability",
  "stable-diffusion-v1-6": "stability",
  "dall-e-3": "dalle",
  "dall-e-2": "dalle"
};

// In-memory quota cooldown store (maps provider or model -> expiration timestamp ms)
const quotaCooldownStore = new Map<string, number>();

export function recordQuotaExceeded(modelOrProvider: string, durationMs: number = THREE_HOURS_MS): void {
  const targetKey = modelOrProvider.toLowerCase().trim();
  const until = Date.now() + durationMs;

  quotaCooldownStore.set(targetKey, until);

  // If a provider name or model is given, disable all associated models for that provider
  const provider = MODEL_PROVIDER_MAP[targetKey] || (targetKey.includes("gemini") ? "gemini" : targetKey.includes("sd") || targetKey.includes("stability") ? "stability" : targetKey.includes("dall") || targetKey.includes("openai") ? "dalle" : null);

  if (provider) {
    quotaCooldownStore.set(provider, until);
    for (const [m, p] of Object.entries(MODEL_PROVIDER_MAP)) {
      if (p === provider) {
        quotaCooldownStore.set(m, until);
      }
    }
  }
}

export function checkHasApiKey(provider: "gemini" | "stability" | "dalle"): boolean {
  if (provider === "gemini") {
    return Boolean(env.GEMINI_API_KEY?.trim() || process.env.GEMINI_API_KEY?.trim());
  }
  if (provider === "stability") {
    return Boolean(env.STABILITY_API_KEY?.trim() || process.env.STABILITY_API_KEY?.trim());
  }
  if (provider === "dalle") {
    return Boolean(env.OPENAI_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim());
  }
  return false;
}

export function getModelStatus(modelName: string): ModelStatus {
  const model = modelName.toLowerCase().trim();
  const provider = MODEL_PROVIDER_MAP[model] || (model.includes("gemini") ? "gemini" : model.includes("sd") || model.includes("stability") ? "stability" : "dalle");
  const hasKey = checkHasApiKey(provider);

  const untilMs = Math.max(
    quotaCooldownStore.get(model) ?? 0,
    quotaCooldownStore.get(provider) ?? 0
  );

  const now = Date.now();
  const isQuotaExceeded = untilMs > now;
  const cooldownRemainingMs = isQuotaExceeded ? untilMs - now : 0;

  const available = hasKey && !isQuotaExceeded;

  let disabledReason: string | undefined = undefined;
  if (!hasKey) {
    disabledReason = `API Key missing for ${provider.toUpperCase()}`;
  } else if (isQuotaExceeded) {
    const remainingHours = (cooldownRemainingMs / (1000 * 60 * 60)).toFixed(1);
    disabledReason = `Quota Exceeded (Disabled for ${remainingHours}h cooldown)`;
  }

  return {
    model,
    provider,
    hasKey,
    isQuotaExceeded,
    cooldownRemainingMs,
    available,
    disabledReason
  };
}

export function getAllModelStatuses(): Record<string, ModelStatus> {
  const result: Record<string, ModelStatus> = {};
  for (const model of Object.keys(MODEL_PROVIDER_MAP)) {
    result[model] = getModelStatus(model);
  }
  return result;
}
