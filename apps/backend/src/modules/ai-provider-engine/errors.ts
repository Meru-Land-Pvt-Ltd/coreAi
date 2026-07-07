export class ProviderNotFoundError extends Error {
  public readonly requestedId: string;
  public readonly registeredIds: string[];

  constructor(requestedId: string, registeredIds: string[] = []) {
    const hint = registeredIds.length > 0
      ? ` Registered providers: [${registeredIds.join(", ")}].`
      : " No providers are currently registered.";

    super(`AI provider '${requestedId}' is not registered.${hint}`);
    this.name = "ProviderNotFoundError";
    this.requestedId = requestedId;
    this.registeredIds = registeredIds;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProviderExecutionError extends Error {
  public readonly providerId: string;
  public readonly cause: unknown;

  constructor(providerId: string, message: string, cause?: unknown) {
    super(`Provider '${providerId}' execution failed: ${message}`);
    this.name = "ProviderExecutionError";
    this.providerId = providerId;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProviderValidationError extends Error {
  public readonly providerId: string;
  public readonly validationMessage: string;

  constructor(providerId: string, validationMessage: string) {
    super(`Provider '${providerId}' failed validation: ${validationMessage}`);
    this.name = "ProviderValidationError";
    this.providerId = providerId;
    this.validationMessage = validationMessage;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ProviderDiscoveryError extends Error {
  public readonly filePath: string;
  public readonly cause: unknown;

  constructor(filePath: string, cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Failed to load provider adapter from '${filePath}': ${detail}`);
    this.name = "ProviderDiscoveryError";
    this.filePath = filePath;
    this.cause = cause;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class NoAvailableProviderError extends Error {
  constructor(reason: string) {
    super(`No available AI provider could be selected. Reason: ${reason}`);
    this.name = "NoAvailableProviderError";
    Error.captureStackTrace(this, this.constructor);
  }
}
