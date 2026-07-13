import fs from "fs";
import path from "path";
import type { AIProviderAdapter, ProviderCapability } from "./types";
import { ProviderNotFoundError, ProviderDiscoveryError } from "./errors";

const PROVIDERS_DIR = path.join(__dirname, "providers");

const REQUIRED_METHODS = ["execute", "validate", "continueConversation", "estimateCost"] as const;

type AdapterModule = { default?: unknown; adapter?: unknown };

export class ProviderRegistry {
  private readonly adapters = new Map<string, AIProviderAdapter>();

  private constructor() {}

  static async create(): Promise<ProviderRegistry> {
    const registry = new ProviderRegistry();
    await registry.discover();
    return registry;
  }

  private async discover(): Promise<void> {
    let files: string[];
    try {
      files = fs.readdirSync(PROVIDERS_DIR);
    } catch {
      console.warn("[AIProviderEngine] providers/ directory not found. No adapters auto-registered.");
      return;
    }

    const adapterFiles = files.filter(
      (f) =>
        !f.startsWith("._") &&
        !f.startsWith(".") &&
        (f.endsWith(".adapter.ts") || f.endsWith(".adapter.js"))
    );

    if (adapterFiles.length === 0) {
      console.warn("[AIProviderEngine] No *.adapter files found in providers/.");
      return;
    }

    for (const file of adapterFiles) {
      const filePath = path.join(PROVIDERS_DIR, file);
      try {
        const mod = await import(new URL(`file://${filePath}`).href) as AdapterModule;
        const adapter = mod.default ?? mod.adapter;

        if (!isValidAdapter(adapter)) {
          console.warn(`[AIProviderEngine] '${file}' does not export a valid AIProviderAdapter. Skipping.`);
          continue;
        }

        this.register(adapter);
        console.info(`[AIProviderEngine] Registered '${adapter.providerId}' (${adapter.displayName}) from ${file}.`);
      } catch (err) {
        console.error(`[AIProviderEngine] ${new ProviderDiscoveryError(filePath, err).message}`);
      }
    }
  }

  register(adapter: AIProviderAdapter): void {
    if (this.adapters.has(adapter.providerId)) {
      console.warn(`[AIProviderEngine] Provider '${adapter.providerId}' already registered. Overwriting.`);
    }
    this.adapters.set(adapter.providerId, adapter);
  }

  resolve(providerId: string): AIProviderAdapter {
    const adapter = this.adapters.get(providerId);
    if (!adapter) throw new ProviderNotFoundError(providerId, this.list());
    return adapter;
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId);
  }

  list(): string[] {
    return Array.from(this.adapters.keys());
  }

  all(): AIProviderAdapter[] {
    return Array.from(this.adapters.values());
  }

  allWithCapability(capability: ProviderCapability): AIProviderAdapter[] {
    return this.all().filter((a) => a.capabilities.includes(capability));
  }
}

function isValidAdapter(value: unknown): value is AIProviderAdapter {
  if (!value || typeof value !== "object") return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c["providerId"] === "string" &&
    c["providerId"].length > 0 &&
    typeof c["displayName"] === "string" &&
    Array.isArray(c["capabilities"]) &&
    REQUIRED_METHODS.every((method) => typeof c[method] === "function")
  );
}
