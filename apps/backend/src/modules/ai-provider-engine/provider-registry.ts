import fs from "fs";
import path from "path";
import { pathToFileURL } from "url";

import type { AIProviderAdapter, ProviderCapability } from "./types";
import {
  ProviderDiscoveryError,
  ProviderNotFoundError,
} from "./errors";

const PROVIDERS_DIR = path.join(__dirname, "providers");

const REQUIRED_METHODS = [
  "execute",
  "validate",
  "continueConversation",
  "estimateCost",
] as const;

type AdapterModule = Record<string, unknown>;

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
    } catch (error) {
      console.warn(
        "[AIProviderEngine] providers/ directory not found. No adapters auto-registered.",
        {
          directory: PROVIDERS_DIR,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      return;
    }

    const adapterFiles = files
      .filter(
        (file) =>
          !file.startsWith(".") &&
          !file.startsWith("._") &&
          (file.endsWith(".adapter.ts") ||
            file.endsWith(".adapter.js")),
      )
      .sort();

    if (adapterFiles.length === 0) {
      console.warn(
        "[AIProviderEngine] No *.adapter files found in providers/.",
        {
          directory: PROVIDERS_DIR,
        },
      );
      return;
    }

    for (const file of adapterFiles) {
      await this.loadAdapter(file);
    }
  }

  private async loadAdapter(file: string): Promise<void> {
    const filePath = path.join(PROVIDERS_DIR, file);

    try {
      /*
       * pathToFileURL safely handles spaces and special characters.
       *
       * Depending on TypeScript/CommonJS/ESM interoperability, dynamic import
       * may return one of these shapes:
       *
       *   { default: adapter }
       *   { adapter }
       *   { default: { default: adapter } }
       *   { default: { adapter } }
       *
       * resolveAdapterModule unwraps these shapes without weakening adapter
       * validation.
       */
      const importedModule = (await import(
        pathToFileURL(filePath).href
      )) as AdapterModule;

      const adapter = resolveAdapterModule(importedModule);

      if (!adapter) {
        console.warn(
          `[AIProviderEngine] '${file}' does not export a valid AIProviderAdapter. Skipping.`,
          {
            exportedKeys: safeObjectKeys(importedModule),
            defaultExportKeys: safeObjectKeys(
              importedModule.default,
            ),
          },
        );
        return;
      }

      this.register(adapter);

      console.info(
        `[AIProviderEngine] Registered '${adapter.providerId}' (${adapter.displayName}) from ${file}.`,
      );
    } catch (error) {
      console.error(
        `[AIProviderEngine] ${
          new ProviderDiscoveryError(filePath, error).message
        }`,
      );
    }
  }

  register(adapter: AIProviderAdapter): void {
    const providerId = adapter.providerId.trim();

    if (!providerId) {
      throw new Error(
        "Cannot register an AI provider with an empty providerId.",
      );
    }

    if (this.adapters.has(providerId)) {
      console.warn(
        `[AIProviderEngine] Provider '${providerId}' is already registered. Overwriting.`,
      );
    }

    this.adapters.set(providerId, adapter);
  }

  resolve(providerId: string): AIProviderAdapter {
    const normalizedProviderId = providerId.trim();
    const adapter = this.adapters.get(normalizedProviderId);

    if (!adapter) {
      throw new ProviderNotFoundError(
        normalizedProviderId,
        this.list(),
      );
    }

    return adapter;
  }

  has(providerId: string): boolean {
    return this.adapters.has(providerId.trim());
  }

  list(): string[] {
    return Array.from(this.adapters.keys()).sort();
  }

  all(): AIProviderAdapter[] {
    return this.list()
      .map((providerId) => this.adapters.get(providerId))
      .filter(
        (adapter): adapter is AIProviderAdapter =>
          adapter !== undefined,
      );
  }

  allWithCapability(
    capability: ProviderCapability,
  ): AIProviderAdapter[] {
    return this.all().filter((adapter) =>
      adapter.capabilities.includes(capability),
    );
  }
}

/**
 * Resolves adapter instances from CommonJS/ESM interoperability wrappers.
 *
 * Examples supported:
 *
 * - adapter
 * - { default: adapter }
 * - { adapter }
 * - { default: { default: adapter } }
 * - named exports containing an adapter
 */
export function resolveAdapterModule(
  value: unknown,
): AIProviderAdapter | null {
  const queue: unknown[] = [value];
  const visited = new Set<object>();

  while (queue.length > 0) {
    const candidate = queue.shift();

    if (isValidAdapter(candidate)) {
      return candidate;
    }

    if (!candidate || typeof candidate !== "object") {
      continue;
    }

    if (visited.has(candidate)) {
      continue;
    }

    visited.add(candidate);

    const record = candidate as Record<string, unknown>;

    /*
     * Check standard module interop keys first.
     */
    if ("default" in record) {
      queue.unshift(record.default);
    }

    if ("adapter" in record) {
      queue.unshift(record.adapter);
    }

    /*
     * Then inspect named exports. Validation remains strict, so unrelated
     * exported values cannot be registered.
     */
    for (const [key, exportedValue] of Object.entries(record)) {
      if (key === "default" || key === "adapter") {
        continue;
      }

      queue.push(exportedValue);
    }
  }

  return null;
}

export function isValidAdapter(
  value: unknown,
): value is AIProviderAdapter {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  const providerId = candidate.providerId;
  const displayName = candidate.displayName;
  const capabilities = candidate.capabilities;

  return (
    typeof providerId === "string" &&
    providerId.trim().length > 0 &&
    typeof displayName === "string" &&
    displayName.trim().length > 0 &&
    Array.isArray(capabilities) &&
    capabilities.every(
      (capability) => typeof capability === "string",
    ) &&
    REQUIRED_METHODS.every(
      (method) => typeof candidate[method] === "function",
    )
  );
}

function safeObjectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  try {
    return Object.keys(value);
  } catch {
    return [];
  }
}