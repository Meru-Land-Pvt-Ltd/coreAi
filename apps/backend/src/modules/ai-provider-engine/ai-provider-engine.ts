export {
  initProviderEngine,
  getProviderEngine,
  getProviderRegistry,
  AIProviderEngine,
} from "./provider-engine";

export { ProviderRegistry } from "./provider-registry";
export { ProviderSelector } from "./provider-selector";

export type {
  AIProviderAdapter,
  AIExecuteRequest,
  AIContinueRequest,
  AIExecuteResponse,
  AIMessage,
  AIAttachment,
  AITokenUsage,
  CostEstimate,
  ValidationResult,
  AIIntent,
  ProviderCapability,
  ModelInfo,
  SelectionExplanation,
} from "./types";

export {
  ProviderNotFoundError,
  ProviderExecutionError,
  ProviderValidationError,
  ProviderDiscoveryError,
  NoAvailableProviderError,
  CapabilityNotSupportedError,
} from "./errors";
