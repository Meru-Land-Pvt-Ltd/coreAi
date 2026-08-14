"use client";

import { useCallback, useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { LLM_PROVIDERS } from "@coreai/shared";
import {
  formatAiTokenPrice,
  getAiPricingModels,
  getAiPricingProviders,
  type AiPricingModel,
  type AiPricingProvider
} from "./ai-pricing-api";

type ProviderModelState = {
  loading: boolean;
  error: string;
  models: AiPricingModel[];
};

function fallbackProviders(): AiPricingProvider[] {
  return LLM_PROVIDERS.map((provider) => ({
    id: provider.id,
    displayName: provider.displayName,
    envKey: provider.envKey,
    configured: false
  }));
}

function formatMaybePrice(value: number | null): string {
  return value === null ? "N/A" : formatAiTokenPrice(value);
}

export function AiPricingSection() {
  const [providers, setProviders] = useState<AiPricingProvider[]>(fallbackProviders);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [summaryError, setSummaryError] = useState("");
  const [expandedProviders, setExpandedProviders] = useState<Record<string, boolean>>({});
  const [providerModels, setProviderModels] = useState<Record<string, ProviderModelState>>({});

  const loadProviders = useCallback(async () => {
    setLoadingProviders(true);
    const response = await getAiPricingProviders();
    if (!response.success) {
      setSummaryError(response.error ?? "Could not load AI pricing providers.");
      setLoadingProviders(false);
      return;
    }
    const data = response.data;
    if (!data) {
      setSummaryError("Could not load AI pricing providers.");
      setLoadingProviders(false);
      return;
    }

    setProviders(data.providers);
    setSummaryError("");
    setLoadingProviders(false);
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  async function toggleProvider(provider: AiPricingProvider) {
    if (!provider.configured) return;

    setExpandedProviders((current) => {
      const next = !current[provider.id];
      return { ...current, [provider.id]: next };
    });

    const isExpanded = !expandedProviders[provider.id];
    const cached = providerModels[provider.id];
    if (!isExpanded || cached?.models.length || cached?.loading) return;

    setProviderModels((current) => ({
      ...current,
      [provider.id]: {
        loading: true,
        error: "",
        models: current[provider.id]?.models ?? []
      }
    }));

    const response = await getAiPricingModels(provider.id);
    if (!response.success) {
      setProviderModels((current) => ({
        ...current,
        [provider.id]: {
          loading: false,
          error: response.error ?? "Could not load models.",
          models: []
        }
      }));
      return;
    }
    const data = response.data;
    if (!data) {
      setProviderModels((current) => ({
        ...current,
        [provider.id]: {
          loading: false,
          error: "Could not load models.",
          models: []
        }
      }));
      return;
    }

    setProviderModels((current) => ({
      ...current,
      [provider.id]: {
        loading: false,
        error: "",
        models: data.models
      }
    }));
  }

  return (
    <section className="bg-white px-6 py-20 sm:py-24" id="ai-pricing">
      <div className="mx-auto max-w-6xl">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            AI Pricing
          </h2>
          <p className="mt-3 text-lg text-slate-600">
            Live provider model lists and token pricing pulled from your configured API keys.
          </p>
        </div>

        {summaryError ? (
          <div className="mx-auto mt-8 max-w-2xl rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {summaryError}
          </div>
        ) : null}

        {loadingProviders ? (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <div key={index} className="h-44 animate-pulse rounded-xl border border-gray-100 bg-gray-50" />
            ))}
          </div>
        ) : (
          <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {providers.map((provider) => {
              const isExpanded = Boolean(expandedProviders[provider.id]);
              const modelState = providerModels[provider.id];
              return (
                <article
                  key={provider.id}
                  className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
                >
                  <div className="border-b border-gray-100 p-6">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900">{provider.displayName}</h3>
                        <p className="mt-1 text-xs text-slate-500">{provider.envKey}</p>
                      </div>
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                          provider.configured
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {provider.configured ? "Configured" : "No key"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-3 p-6">
                    {isExpanded ? (
                      modelState?.loading ? (
                        <div className="flex items-center gap-2 text-sm text-slate-500">
                          <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin text-amber-500" />
                          Loading models...
                        </div>
                      ) : modelState?.error ? (
                        <p className="text-sm text-red-600">{modelState.error}</p>
                      ) : modelState?.models.length ? (
                        <div className="space-y-3">
                          {modelState.models.map((model) => {
                            const inputPrice = formatMaybePrice(model.inputPricePer1MToken);
                            const outputPrice = formatMaybePrice(model.outputPricePer1MToken);
                            const pricingUnknown = inputPrice === "N/A" && outputPrice === "N/A";

                            return (
                              <div
                                key={model.modelId}
                                className="rounded-xl border border-gray-100 bg-slate-50/60 p-4"
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-900">
                                      {model.displayName}
                                    </p>
                                    <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                                      {model.modelId}
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                                    {pricingUnknown ? "Pricing not published" : "Per 1M tokens"}
                                  </span>
                                </div>

                                <div className="mt-3 grid gap-1 text-sm text-slate-600">
                                  <span>Input: {inputPrice}</span>
                                  <span>Output: {outputPrice}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500">No models were returned for this provider.</p>
                      )
                    ) : (
                      <p className="text-sm text-slate-500">
                        Click Show to load the provider&apos;s live model list.
                      </p>
                    )}
                  </div>

                  <div className="flex items-center justify-between border-t border-gray-100 px-6 py-4">
                    <p className="text-xs text-slate-500">
                      {provider.configured
                        ? "Token pricing is pulled from the current catalog."
                        : "Add a key in Manage API to enable live model lookup."}
                    </p>
                    <button
                      type="button"
                      disabled={!provider.configured}
                      onClick={() => void toggleProvider(provider)}
                      className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isExpanded ? "Hide" : "Show"}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
