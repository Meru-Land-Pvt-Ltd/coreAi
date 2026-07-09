"use client";

import { useEffect, useState } from "react";
import { getLLMProviders, type LLMProviderResponse } from "../../features/api";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData } from "./types";
import { Section, Label, TextInput, TextArea, SelectBox } from "./node-inspector";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};

type ProviderFromApi = {
  id: string;
  displayName: string;
  models: string[];
};

export function LlmNodeInspector({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const [providers, setProviders] = useState<ProviderFromApi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    async function fetchProviders() {
      try {
        setLoading(true);
        const res = await getLLMProviders();
        if (res.success && res.data?.providers) {
          setProviders(res.data.providers);
        } else {
          setError(res.error ?? "Failed to load providers from backend");
        }
      } catch (err) {
        setError("An unexpected error occurred while fetching providers");
      } finally {
        setLoading(false);
      }
    }
    fetchProviders();
  }, []);

  const str = (key: string, fallback = ""): string => {
    const value = selectedNode.data[key];
    return typeof value === "string" ? value : fallback;
  };

  const set = (key: string) => (value: string) => {
    onUpdateNodeData(key as keyof BuilderNodeData, value);
  };

  // Get currently selected provider and model
  const activeProviderId = str("llmProvider", "openai");
  const activeModel = str("llmModel", "gpt-4o");

  // Find active provider and fallback models if API is loading/fails
  const activeProvider = providers.find((p) => p.id === activeProviderId);
  const availableModels = activeProvider?.models ?? [];

  // When provider changes, select its first model automatically
  const handleProviderChange = (providerId: string) => {
    set("llmProvider")(providerId);
    const found = providers.find((p) => p.id === providerId);
    if (found && found.models.length > 0) {
      set("llmModel")(found.models[0]);
    }
  };

  if (loading) {
    return (
      <div className="flex h-48 items-center justify-center text-slate-500">
        <div className="flex flex-col items-center gap-2">
          <svg className="h-6 w-6 animate-spin text-violet-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-xs font-semibold">Fetching AI models...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-5 text-center text-red-600">
        <BuilderIcon name="info" className="mx-auto h-8 w-8 text-red-500" />
        <p className="mt-2 text-xs font-semibold">{error}</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setLoading(true);
            getLLMProviders().then((res) => {
              if (res.success && res.data?.providers) {
                setProviders(res.data.providers);
              } else {
                setError(res.error ?? "Failed to load providers from backend");
              }
              setLoading(false);
            });
          }}
          className="mt-3 rounded-lg bg-red-100 px-3 py-1.5 text-xs font-bold text-red-700 hover:bg-red-200"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput value={selectedNode.data.title} onChange={set("title")} />
      </Section>

      <Section title="LLM Provider">
        <div className="grid grid-cols-3 gap-2">
          {providers.map((p) => {
            const isSelected = p.id === activeProviderId;
            let themeClass = "";
            let logoColor = "";
            let logoSvg = null;

            if (p.id === "openai") {
              themeClass = isSelected
                ? "border-emerald-500 bg-emerald-50 text-emerald-950 ring-2 ring-emerald-500/20"
                : "border-slate-200 hover:border-emerald-200 hover:bg-emerald-50/30";
              logoColor = isSelected ? "text-emerald-600" : "text-slate-500";
              logoSvg = (
                <svg viewBox="0 0 24 24" className={`h-5 w-5 ${logoColor}`} fill="currentColor">
                  <path d="M21.7 10.3c.4-.4.6-.9.6-1.5 0-1.1-.9-2.1-2.1-2.1-.3 0-.6.1-.9.2C18.6 5.4 17 4.2 15.2 4.2c-.7 0-1.4.3-2 .7-.6-1.2-1.8-1.9-3.2-1.9C8 3 6.3 4.4 6 6.3c-.3-.1-.6-.2-.9-.2-1.1 0-2.1.9-2.1 2.1 0 .6.3 1.1.7 1.5C3.3 10.9 2.5 12.3 2.5 14c0 1.9 1.5 3.5 3.5 3.5.3 0 .6-.1.9-.2.7 1.5 2.3 2.5 4.1 2.5.7 0 1.4-.2 2-.7.6 1.2 1.8 1.9 3.2 1.9 2 0 3.7-1.4 4-3.3.3.1.6.2.9.2 1.1 0 2.1-.9 2.1-2.1 0-.6-.3-1.1-.7-1.5.4-.5 1.2-2 1.2-3.7-.1-1.8-.9-3.2-2-3.8zm-6.2 7.8c-.2.1-.5.1-.7-.1l-2.8-1.6-2.8 1.6c-.2.1-.5.1-.7-.1-.2-.2-.2-.5-.1-.7l1.6-2.8-1.6-2.8c-.1-.2-.1-.5.1-.7.2-.2.5-.2.7-.1l2.8 1.6 2.8-1.6c.2-.1.5-.1.7.1.2.2.2.5.1.7L13.7 13.5l1.6 2.8c.2.2.2.5.2.8z" />
                </svg>
              );
            } else if (p.id === "claude") {
              themeClass = isSelected
                ? "border-orange-500 bg-orange-50 text-orange-950 ring-2 ring-orange-500/20"
                : "border-slate-200 hover:border-orange-200 hover:bg-orange-50/30";
              logoColor = isSelected ? "text-orange-600" : "text-slate-500";
              logoSvg = (
                <svg viewBox="0 0 24 24" className={`h-5 w-5 ${logoColor}`} fill="currentColor">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.5h-2v-2h2v2zm0-4h-2v-4h2v4z" />
                </svg>
              );
            } else {
              themeClass = isSelected
                ? "border-violet-500 bg-violet-50 text-violet-950 ring-2 ring-violet-500/20"
                : "border-slate-200 hover:border-violet-200 hover:bg-violet-50/30";
              logoColor = isSelected ? "text-violet-600" : "text-slate-500";
              logoSvg = (
                <svg viewBox="0 0 24 24" className={`h-5 w-5 ${logoColor}`} fill="currentColor">
                  <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zm6 13l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8L18 16z" />
                </svg>
              );
            }

            return (
              <button
                type="button"
                key={p.id}
                onClick={() => handleProviderChange(p.id)}
                className={`flex flex-col items-center justify-center gap-2 rounded-xl border p-3.5 text-center font-semibold transition ${themeClass}`}
              >
                {logoSvg}
                <span className="text-xs truncate max-w-full leading-tight">{p.displayName}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-4">
          <Label>Model</Label>
          <SelectBox
            value={activeModel}
            onChange={set("llmModel")}
            options={availableModels}
          />
        </div>
      </Section>

      <Section title="Prompts">
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>System Prompt</Label>
              <span className="text-[10px] text-slate-400 font-medium">Persona & Rules</span>
            </div>
            <TextArea
              value={str("llmSystemPrompt")}
              onChange={set("llmSystemPrompt")}
              height="h-32"
              placeholder="e.g. You are a professional assistant. Be polite, concise, and helpful..."
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <Label>User Prompt Template</Label>
              <span className="text-[10px] text-slate-400 font-medium">Main Request</span>
            </div>
            <TextArea
              value={str("llmPrompt")}
              onChange={set("llmPrompt")}
              height="h-28"
              placeholder="e.g. Please reply to this customer message: {{trigger.message}}"
            />
            <p className="mt-1.5 text-[10px] text-slate-400 leading-normal">
              💡 Use double curly braces like <code className="font-mono text-violet-600 bg-violet-50 px-1 py-0.5 rounded">{"{{trigger.body}}"}</code> to reference variables from previous steps.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Context / Knowledge">
        <Label>Additional Context Block (Optional)</Label>
        <TextArea
          value={str("llmContext")}
          onChange={set("llmContext")}
          height="h-24"
          placeholder="e.g. Business FAQ:\n- Hours: 9 AM - 5 PM\n- Price: $50\n..."
        />
        <p className="mt-1 text-[10px] text-slate-400">
          This content is injected into the LLM system context to give it domain knowledge.
        </p>
      </Section>

      <Section title="Output configuration">
        <div className="space-y-4">
          <div>
            <Label>Output variable key</Label>
            <TextInput
              value={str("llmOutputKey", "ai.output")}
              onChange={set("llmOutputKey")}
              placeholder="ai.output"
            />
            <p className="mt-1 text-[10px] text-slate-400">
              The workflow variable name where the LLM response text or parsed JSON will be saved.
            </p>
          </div>

          <div>
            <Label>Output Format</Label>
            <SelectBox
              value={str("llmOutputFormat", "text")}
              onChange={set("llmOutputFormat")}
              options={["text", "json"]}
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Select <strong>json</strong> if you expect a structured JSON response from the LLM and want it parsed automatically.
            </p>
          </div>
        </div>
      </Section>

      <Section title="Advanced options" last>
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex w-full items-center justify-between rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2.5 text-left transition hover:border-gray-200"
        >
          <span className="text-xs font-bold text-slate-600">Advanced settings</span>
          <BuilderIcon
            name="chevron"
            className={`h-3.5 w-3.5 text-slate-400 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
          />
        </button>

        {advancedOpen && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label>Temperature</Label>
                <span className="font-mono text-xs text-slate-600">{str("llmTemperature", "0.7")}</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.1"
                value={str("llmTemperature", "0.7")}
                onChange={(e) => set("llmTemperature")(e.target.value)}
                className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-violet-600 focus:outline-none"
              />
              <div className="flex justify-between text-[9px] text-slate-400 mt-1">
                <span>Deterministic (0.0)</span>
                <span>Creative (1.0)</span>
              </div>
            </div>

            <div>
              <Label>Max Completion Tokens</Label>
              <input
                type="number"
                min="1"
                max="8192"
                value={str("llmMaxTokens", "1024")}
                onChange={(e) => set("llmMaxTokens")(e.target.value)}
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-violet-300 focus:ring-2 focus:ring-violet-400/50"
              />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
