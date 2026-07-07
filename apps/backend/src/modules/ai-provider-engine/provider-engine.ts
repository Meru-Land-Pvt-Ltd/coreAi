import { ProviderRegistry } from "./provider-registry";
import { ProviderExecutionError } from "./errors";
import { ProviderSelector } from "./provider-selector";
import type {
  AIProviderAdapter,
  AIExecuteRequest,
  AIContinueRequest,
  AIExecuteResponse,
  CostEstimate,
  ValidationResult,
  SelectionExplanation,
} from "./types";

export class AIProviderEngine {
  private readonly validProviderIds = new Set<string>();

  constructor(private readonly registry: ProviderRegistry) {}

  // Cache valid/active providers based on successful credentials validation at boot
  async populateValidationCache(): Promise<void> {
    this.validProviderIds.clear();
    const adapters = this.registry.all();
    await Promise.all(
      adapters.map(async (adapter) => {
        try {
          const res = await adapter.validate();
          if (res.valid) {
            this.validProviderIds.add(adapter.providerId);
          }
        } catch {
          // Keep it out of valid cache if validate() throws
        }
      })
    );
  }

  // The primary auto-routing interface. Auto-selects the best provider
  async executeAI(request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const adapter = ProviderSelector.select(request, this.registry.all(), this.validProviderIds);
    return this.callAdapter(adapter, (a) => a.execute(request));
  }

  // Backdoor/explicit override interface for admin/testing
  async executeWithProvider(providerId: string, request: AIExecuteRequest): Promise<AIExecuteResponse> {
    const adapter = this.registry.resolve(providerId);
    return this.callAdapter(adapter, (a) => a.execute(request));
  }

  async continueConversation(providerId: string, request: AIContinueRequest): Promise<AIExecuteResponse> {
    const adapter = this.registry.resolve(providerId);
    return this.callAdapter(adapter, (a) => a.continueConversation(request));
  }

  async estimateCost(providerId: string, request: AIExecuteRequest): Promise<CostEstimate> {
    const adapter = this.registry.resolve(providerId);
    try {
      return await adapter.estimateCost(request);
    } catch {
      return { inputCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0, model: "unknown" };
    }
  }

  async validateProvider(providerId: string): Promise<ValidationResult> {
    const adapter = this.registry.resolve(providerId);
    try {
      const res = await adapter.validate();
      if (res.valid) {
        this.validProviderIds.add(providerId);
      } else {
        this.validProviderIds.delete(providerId);
      }
      return res;
    } catch (err) {
      this.validProviderIds.delete(providerId);
      return { valid: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async validateAll(): Promise<Map<string, ValidationResult>> {
    const results = new Map<string, ValidationResult>();
    await Promise.all(
      this.registry.all().map(async (adapter) => {
        const res = await this.validateProvider(adapter.providerId);
        results.set(adapter.providerId, res);
      })
    );
    return results;
  }

  explainSelection(request: AIExecuteRequest): SelectionExplanation {
    return ProviderSelector.explain(request, this.registry.all(), this.validProviderIds);
  }

  listProviders(): string[] {
    return this.registry.list();
  }

  listActiveProviders(): string[] {
    return Array.from(this.validProviderIds);
  }

  hasProvider(providerId: string): boolean {
    return this.registry.has(providerId);
  }

  private async callAdapter(
    adapter: AIProviderAdapter,
    fn: (adapter: AIProviderAdapter) => Promise<AIExecuteResponse>
  ): Promise<AIExecuteResponse> {
    const startMs = Date.now();
    try {
      const response = await fn(adapter);
      return {
        ...response,
        durationMs: response.durationMs > 0 ? response.durationMs : Date.now() - startMs,
      };
    } catch (err) {
      throw new ProviderExecutionError(
        adapter.providerId,
        err instanceof Error ? err.message : String(err),
        err
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/*  Singleton                                                                   */
/* -------------------------------------------------------------------------- */

let _registry: ProviderRegistry | null = null;
let _engine: AIProviderEngine | null = null;

export async function initProviderEngine(): Promise<void> {
  if (_engine) {
    console.warn("[AIProviderEngine] initProviderEngine() called more than once. Ignoring.");
    return;
  }
  _registry = await ProviderRegistry.create();
  _engine = new AIProviderEngine(_registry);
  await _engine.populateValidationCache();
  console.info(`[AIProviderEngine] Ready. Registered: [${_registry.list().join(", ")}], Active: [${_engine.listActiveProviders().join(", ")}]`);
}

export function getProviderEngine(): AIProviderEngine {
  if (!_engine) throw new Error("[AIProviderEngine] Not initialised. Call initProviderEngine() at startup first.");
  return _engine;
}

export function getProviderRegistry(): ProviderRegistry {
  if (!_registry) throw new Error("[AIProviderEngine] Not initialised. Call initProviderEngine() at startup first.");
  return _registry;
}
