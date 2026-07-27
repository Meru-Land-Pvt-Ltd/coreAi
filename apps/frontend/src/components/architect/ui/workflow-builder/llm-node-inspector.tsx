"use client";

import { useState, useRef, useEffect } from "react";
import { BuilderIcon } from "./icons";
import type { BuilderNode, BuilderNodeData, AIAttachment } from "./types";
import { Section, Label, TextInput, TextArea } from "./node-inspector";
import {
  LLM_PROVIDERS,
  defaultLlmModelForProvider,
  findLlmModel,
  getLlmModelsForProvider,
  getLlmProvider,
  resolveLlmSelection,
} from "./llm-catalog";
import { isProviderDisabled, providerDisabledTitle, useLlmAvailability } from "./use-llm-availability";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};

export function LlmNodeInspector({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const [providerOpen, setProviderOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const providerRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);

  const availability = useLlmAvailability();

  const attachments = (selectedNode.data.attachments as AIAttachment[] | undefined) ?? [];

  const str = (key: string, fallback = ""): string => {
    const value = selectedNode.data[key];
    return typeof value === "string" ? value : fallback;
  };

  // Provider first, then its models. A saved model belonging to a different
  // provider is dropped by the resolver, so the two selects can never disagree.
  const selection = resolveLlmSelection(str("llmProvider"), str("llmModel"));
  const currentProvider = getLlmProvider(selection.providerId);
  const providerModels = getLlmModelsForProvider(selection.providerId);
  const activeModelId = selection.modelId ?? defaultLlmModelForProvider(selection.providerId) ?? "";
  // Null for a model id the catalog does not list (older workflows) — the raw
  // id is shown rather than silently swapping in a different model.
  const currentModel = findLlmModel(activeModelId);

  // Close dropdowns on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (providerRef.current && !providerRef.current.contains(target)) {
        setProviderOpen(false);
      }
      if (modelRef.current && !modelRef.current.contains(target)) {
        setModelOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Switching provider also switches to that provider's first model, so the
  // node never keeps a model the new provider cannot run.
  const handleProviderChange = (providerId: string) => {
    setProviderOpen(false);
    if (providerId === selection.providerId) return;
    if (isProviderDisabled(availability, providerId)) return;

    onUpdateNodeData("llmProvider", providerId);
    onUpdateNodeData("llmModel", defaultLlmModelForProvider(providerId) ?? "");
  };

  const handleModelChange = (modelId: string) => {
    const foundModel = findLlmModel(modelId);
    if (foundModel) {
      onUpdateNodeData("llmModel", foundModel.id);
      onUpdateNodeData("llmProvider", foundModel.providerId);
    }
    setModelOpen(false);
  };

  // Attachment handling
  const handleRemoveAttachment = (indexToRemove: number) => {
    const updated = attachments.filter((_, idx) => idx !== indexToRemove);
    onUpdateNodeData("attachments", updated);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      alert("File is too large. Maximum size is 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64Data = event.target?.result as string;
      const newAttachment: AIAttachment = {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        data: base64Data,
      };
      onUpdateNodeData("attachments", [...attachments, newAttachment]);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <>
      {/* --- Section 1: General Info --- */}
      <Section title="General">
        <Label>Node name</Label>
        <TextInput
          value={selectedNode.data.title}
          onChange={(val) => onUpdateNodeData("title", val)}
        />
      </Section>

      {/* --- Section 2: LLM then Model (Consistent with node-inspector styling) --- */}
      <Section title="AI Model">
        <Label>LLM provider</Label>

        <div className="relative" ref={providerRef}>
          {/* Custom Select Button */}
          <button
            type="button"
            onClick={() => setProviderOpen(!providerOpen)}
            data-testid="llm-provider-select"
            className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
          >
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <span className="font-medium truncate">
                {currentProvider?.displayName ?? selection.providerId}
              </span>
            </div>
            <span className="ml-2 text-slate-400 shrink-0">
              <BuilderIcon
                name="chevron"
                className={`h-4 w-4 transition-transform duration-200 ${
                  providerOpen ? "rotate-180" : ""
                }`}
              />
            </span>
          </button>

          {/* Custom Dropdown Menu Popover */}
          {providerOpen && (
            <div
              className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 scrollbar-thin"
              data-testid="llm-provider-options"
            >
              {LLM_PROVIDERS.map((p) => {
                const isSelected = p.id === selection.providerId;
                // Greyed out when the backend has no key for it (and something
                // else does work) — picking it would only fail at run time.
                const disabled = isProviderDisabled(availability, p.id);

                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => handleProviderChange(p.id)}
                    disabled={disabled}
                    title={providerDisabledTitle(availability, p.id)}
                    data-testid={`llm-provider-option-${p.id}`}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                      disabled
                        ? "cursor-not-allowed text-slate-400"
                        : isSelected
                          ? "bg-slate-100 text-slate-900 font-semibold"
                          : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="truncate">{p.displayName}</span>
                    <span className="ml-2 shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                      {getLlmModelsForProvider(p.id).length} models
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="mt-4">
          <Label>Model</Label>

          <div className="relative" ref={modelRef}>
            {/* Custom Select Button */}
            <button
              type="button"
              onClick={() => setModelOpen(!modelOpen)}
              data-testid="llm-model-select"
              className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-white px-3 py-2 text-left text-sm text-slate-800 outline-none transition hover:border-slate-300 focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className="font-medium truncate">
                  {currentModel?.displayName ?? (activeModelId || "Select a model")}
                </span>
                {currentModel && (
                  <span className="shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                    {currentModel.badge}
                  </span>
                )}
              </div>
              <span className="ml-2 text-slate-400 shrink-0">
                <BuilderIcon
                  name="chevron"
                  className={`h-4 w-4 transition-transform duration-200 ${
                    modelOpen ? "rotate-180" : ""
                  }`}
                />
              </span>
            </button>

            {/* Custom Dropdown Menu Popover — only this provider's models */}
            {modelOpen && (
              <div
                className="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg ring-1 ring-black/5 scrollbar-thin"
                data-testid="llm-model-options"
              >
                {providerModels.map((m) => {
                  const isSelected = m.id === activeModelId;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleModelChange(m.id)}
                      data-testid={`llm-model-option-${m.id}`}
                      className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                        isSelected
                          ? "bg-slate-100 text-slate-900 font-semibold"
                          : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{m.displayName}</span>
                      <span className="ml-2 shrink-0 rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                        {m.badge}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </Section>

      {/* --- Section 3: Prompts --- */}
      <Section title="Prompts">
        <div className="space-y-4">
          <div>
            <Label>What should this AI step do?</Label>
            <TextArea
              value={str("llmRequirements")}
              onChange={(val) => onUpdateNodeData("llmRequirements", val)}
              height="h-32"
              placeholder="e.g. Reply to the customer nicely and include the booking link if they want an appointment."
            />
          </div>
        </div>
      </Section>

      {/* --- Section 4: Attachments --- */}
      <Section title="Attachments">
        <div className="space-y-3">
          <Label>Files (Images / PDFs / Docs)</Label>

          {attachments.length > 0 && (
            <div className="space-y-2 mb-3">
              {attachments.map((att, idx) => {
                const isImage = att.mimeType.startsWith("image/");
                const isPdf = att.mimeType === "application/pdf";

                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/50 p-2.5 transition hover:border-violet-100 hover:bg-violet-50/10"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="flex h-8 w-8 shrink-0 place-items-center justify-center rounded-lg bg-white border border-slate-100 text-sm shadow-sm">
                        {isImage ? "🖼️" : isPdf ? "📄" : "📁"}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-slate-700 leading-tight">
                          {att.name || `attachment-${idx + 1}`}
                        </p>
                        <p className="text-[9px] text-slate-400 font-mono mt-0.5 truncate uppercase">
                          {att.mimeType}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveAttachment(idx)}
                      className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-red-500 transition-colors"
                      aria-label="Remove attachment"
                    >
                      <BuilderIcon name="x" className="h-4 w-4" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="relative">
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-slate-200 rounded-xl cursor-pointer bg-slate-50/40 hover:bg-violet-50/20 hover:border-violet-300 transition-all duration-200 group">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <svg
                  className="w-6 h-6 mb-2 text-slate-400 group-hover:text-violet-500 transition-colors"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
                  ></path>
                </svg>
                <p className="text-[11px] font-semibold text-slate-500 group-hover:text-violet-600 transition-colors">
                  Click or drag file to attach
                </p>
                <p className="text-[9px] text-slate-400 mt-1">
                  Supports Images, PDFs, Docs (Max 5MB)
                </p>
              </div>
              <input
                type="file"
                className="hidden"
                accept="image/*,application/pdf,text/plain,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={handleFileChange}
              />
            </label>
          </div>
        </div>
      </Section>

      {/* --- Section 5: Advanced Options --- */}
      <Section title="Advanced options" last>
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-3 py-2.5 text-left transition hover:border-slate-300"
        >
          <span className="text-xs font-bold text-slate-700">Advanced settings</span>
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
                onChange={(e) => onUpdateNodeData("llmTemperature", e.target.value)}
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
                onChange={(e) => onUpdateNodeData("llmMaxTokens", e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:outline-none ring-0 focus:ring-0 focus:border-amber-400 transition-colors shadow-none"
              />
            </div>
          </div>
        )}
      </Section>
    </>
  );
}
