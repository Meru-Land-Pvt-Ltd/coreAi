"use client";

/**
 * THE AI BRAIN.
 *
 * The most used node on the platform, and the one place an architect writes
 * the actual work. Rebuilt around one idea: a person with no training should
 * understand every word on this panel.
 *
 * What was here before, and why each thing went:
 *
 *  • THREE names for one output — {{ai.output}}, {{node.ai-1787399665497.output}}
 *    and {{node.thinker.output}} — one of them carrying a raw timestamp. One
 *    value, three spellings, on a screen where the rule is one fact one place.
 *    There is one name now: `text`, the thing the node declares it gives.
 *  • "Input mapping: this step does not require mapped variables" — a section
 *    whose only job was to announce it was empty.
 *  • Developer options, id / type / kind — platform internals on a screen where
 *    somebody is building a receptionist.
 *  • ONE box asking for "the prompt". A brain is briefed the way a person is:
 *    say what is arriving, show it, say what you want back. One box lets
 *    somebody describe the answer and forget to say what the input is, and the
 *    model then guesses at what it is holding. Two boxes now, with the data
 *    arriving between them from the step before — so there is nothing to type
 *    in the middle, and no {{braces}} in the ordinary case at all.
 *  • Attachments — going to its own File Upload node, so it is not half-here.
 *  • A Temperature slider on models that reject temperature. Anthropic's
 *    thinking models refuse it and claude.adapter.ts has always quietly thrown
 *    the value away, while this panel let an architect drag it. Dials are
 *    declared per model now (see packages/shared/src/model-dials.ts) and a dial
 *    a model does not have is absent, not greyed.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ChevronDown } from "lucide-react";
import { modelDials, type ModelDial } from "@coreai/shared";
import type { BuilderNode, BuilderNodeData } from "./types";
import { modelsForProvider, useLlmModels } from "./use-llm-models";
import { LLM_PROVIDERS, defaultLlmModelForProvider, getLlmProvider, resolveLlmSelection } from "./llm-catalog";
import { isProviderDisabled, providerDisabledTitle, useLlmAvailability } from "./use-llm-availability";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
  /** Names of the steps wired into this one. Optional so the panel renders alone. */
  incomingNodeNames?: string[];
};

/* ------------------------------------------------------------------ pieces */

/** The one sentence describing which brain is doing the work. */
function ModelLine({
  providerName,
  modelName,
  onClick,
  open
}: {
  providerName: string;
  modelName: string;
  onClick: () => void;
  open: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="llm-model-line"
      className="flex w-full items-center justify-between gap-3 rounded-xl border border-gray-200 px-3.5 py-3 text-left transition hover:border-gray-300"
    >
      <span className="min-w-0">
        <span className="block text-[11px] font-semibold uppercase tracking-wide text-slate-400">Brain</span>
        <span className="mt-0.5 block truncate text-[14px] font-semibold text-slate-900">
          {modelName} <span className="font-normal text-slate-400">· {providerName}</span>
        </span>
      </span>
      <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

/** One dial, in the words the model declared for it. */
function Dial({
  dial,
  value,
  onChange
}: {
  dial: ModelDial;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div data-testid={`llm-dial-${dial.key}`}>
      <p className="text-[13px] font-semibold text-slate-900">{dial.label}</p>
      <p className="mt-0.5 text-[12px] leading-5 text-slate-500">{dial.help}</p>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {(dial.options ?? []).map((option) => {
          const picked = value === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              data-testid={`llm-dial-${dial.key}-${option.value}`}
              title={option.note}
              className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium transition ${
                picked
                  ? "border-amber-300 bg-amber-50 text-amber-900"
                  : "border-gray-200 text-slate-600 hover:border-gray-300"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {/* A dial that moves the bill says so before anything is published, not
          after it arrives. */}
      {dial.costNote ? (
        <p className="mt-1.5 text-[11px] leading-5 text-amber-700" data-testid={`llm-dial-cost-${dial.key}`}>
          {dial.costNote}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- the panel */

/**
 * Does this text tell the Brain to DO something, rather than describe what it
 * is about to be handed?
 *
 * Deliberately dumb: a handful of verbs at the start of the text or a
 * sentence. Cheap, instant, no model call — and wrong quietly, because it only
 * ever shows a hint. "A question a customer typed" passes; "detect if its true
 * and say yes or no only" does not, and that exact string is why this exists.
 */
function looksLikeAnOrder(text: string): boolean {
  const trimmed = text.trim().toLowerCase();
  if (trimmed.length < 4) return false;
  return /(^|[.!?]\s+)(detect|say|answer|reply|respond|write|output|return|repeat|translate|summari[sz]e|classify|decide|tell|give|generate|extract|only\s+say)\b/.test(
    trimmed
  );
}

export function LlmNodeInspector({ selectedNode, onUpdateNodeData, incomingNodeNames }: NodePropsPanel) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  const { availability } = useLlmAvailability();
  const liveModels = useLlmModels();

  /* The names of the steps wired into this one, so the middle line names them
     rather than saying "the step before" and leaving somebody to guess which. */
  const feeders = incomingNodeNames ?? [];

  const str = (key: string, fallback = ""): string => {
    const value = (selectedNode.data as Record<string, unknown>)[key];
    return typeof value === "string" && value.length > 0 ? value : fallback;
  };
  const set = (key: string) => (value: string) =>
    onUpdateNodeData(key as keyof BuilderNodeData, value as BuilderNodeData[keyof BuilderNodeData]);

  const selection = resolveLlmSelection(str("llmProvider"), str("llmModel"));
  const provider = getLlmProvider(selection.providerId);
  const providerModels = modelsForProvider(liveModels, selection.providerId);
  const activeModelId = selection.modelId ?? defaultLlmModelForProvider(selection.providerId) ?? "";
  const model = liveModels.find((entry) => entry.id === activeModelId);

  /* What THIS model actually has. A dial it does not have is absent — never a
     control that looks live and is thrown away by the adapter. */
  const dials = modelDials({
    providerId: selection.providerId,
    category: model?.category,
    modelId: activeModelId
  });

  useEffect(() => {
    function onOutside(event: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    }
    document.addEventListener("mousedown", onOutside);
    return () => document.removeEventListener("mousedown", onOutside);
  }, []);

  const chooseModel = (providerId: string, modelId: string) => {
    onUpdateNodeData("llmProvider" as keyof BuilderNodeData, providerId as BuilderNodeData[keyof BuilderNodeData]);
    onUpdateNodeData("llmModel" as keyof BuilderNodeData, modelId as BuilderNodeData[keyof BuilderNodeData]);
    setPickerOpen(false);
  };

  return (
    <>
      {/* ------------------------------------------------------------- name */}
      <div className="px-5 pt-5">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Name</label>
        <input
          value={String(selectedNode.data.title ?? "")}
          onChange={(event) => set("title")(event.target.value)}
          placeholder="AI Brain"
          data-testid="llm-node-name"
          className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm font-medium text-slate-900 outline-none transition focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
        />
      </div>

      {/* ------------------------------------------------------------ brain */}
      <div className="relative mt-4 px-5" ref={pickerRef}>
        <ModelLine
          providerName={provider?.displayName ?? selection.providerId}
          modelName={model?.displayName ?? activeModelId ?? "Choose a brain"}
          onClick={() => setPickerOpen(!pickerOpen)}
          open={pickerOpen}
        />

        {pickerOpen ? (
          <div
            className="absolute left-5 right-5 z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border border-gray-200 bg-white py-1 shadow-lg"
            data-testid="llm-model-picker"
          >
            {LLM_PROVIDERS.map((entry) => {
              const models = modelsForProvider(liveModels, entry.id);
              if (models.length === 0) return null;

              const off = isProviderDisabled(availability, entry.id);

              return (
                <div key={entry.id}>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    {entry.displayName}
                  </p>
                  {models.map((entryModel) => (
                    <button
                      key={entryModel.id}
                      type="button"
                      disabled={off}
                      title={off ? providerDisabledTitle(availability, entry.id) : undefined}
                      onClick={() => chooseModel(entry.id, entryModel.id)}
                      data-testid={`llm-model-option-${entryModel.id}`}
                      className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] transition ${
                        off
                          ? "cursor-not-allowed text-slate-300"
                          : entryModel.id === activeModelId
                            ? "bg-amber-50 font-semibold text-amber-900"
                            : "text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{entryModel.displayName}</span>
                      <span className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
                        {entryModel.badge}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------- what is arriving */}
      <div className="mt-5 px-5">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          What is coming in
        </label>
        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
          Tell it what it is about to be given, the way you would tell a person.
        </p>
        <textarea
          value={str("llmInputIs")}
          onChange={(event) => set("llmInputIs")(event.target.value)}
          placeholder="A question a customer typed on our website."
          rows={3}
          data-testid="llm-input-is"
          className="mt-1.5 w-full resize-y rounded-xl border border-gray-200 px-3.5 py-2.5 text-[14px] leading-7 text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
        />
        {/* THE MISTAKE THE FOUNDER MADE, CAUGHT BEFORE THE FIRST RUN.
            He typed the order — "detect if its true and say yes or no only" —
            into this box, which only describes what arrives, while the answer
            box still said "repeat it back exactly". The Brain obeyed one or the
            other at random and looked broken. Alone, an architect leaves the
            platform over exactly this; the box itself has to say it. */}
        {looksLikeAnOrder(str("llmInputIs")) ? (
          <p
            className="mt-1.5 rounded-lg bg-amber-50 px-3 py-2 text-[12px] leading-5 text-amber-800"
            data-testid="llm-input-is-order-warning"
          >
            This looks like an instruction. This box only describes what arrives — put what the
            Brain should <em>do</em> in “How the answer should be” below, or it may be ignored.
          </p>
        ) : null}
      </div>

      {/* THE DATA ITSELF — nothing to type.
          It arrives from the step before. Saying so out loud is the difference
          between an architect trusting the middle is handled and an architect
          pasting {{text}} in and hoping. */}
      <div className="mt-3 px-5">
        <div
          className="flex items-center gap-2 rounded-xl border border-dashed border-gray-200 bg-slate-50/60 px-3.5 py-2.5"
          data-testid="llm-data-line"
        >
          <ArrowDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
          <span className="text-[12px] leading-5 text-slate-500">
            {feeders.length > 0 ? (
              <>
                The answer from <span className="font-medium text-slate-700">{feeders.join(", ")}</span> arrives
                here automatically.
              </>
            ) : (
              <>Whatever the step before this one produces arrives here automatically.</>
            )}
          </span>
        </div>
      </div>

      {/* --------------------------------------------- what should come back */}
      <div className="mt-3 px-5">
        <label className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          How the answer should be
        </label>
        <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
          What you want back, and anything it must never do.
        </p>
        <textarea
          value={str("llmAnswerShouldBe")}
          onChange={(event) => set("llmAnswerShouldBe")(event.target.value)}
          placeholder={"Friendly, under three sentences, and never invent a price.\n\nIf you do not know, say so and offer to have somebody call them back."}
          rows={12}
          data-testid="llm-answer-should-be"
          className="mt-1.5 min-h-[16rem] w-full resize-y rounded-xl border border-gray-200 px-3.5 py-3 text-[14px] leading-7 text-slate-900 outline-none transition placeholder:text-slate-300 focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
        />
      </div>

      {/* --------------------------------------------------------- settings */}
      <div className="mt-6 px-5 pb-6">
        <button
          type="button"
          onClick={() => setSettingsOpen(!settingsOpen)}
          data-testid="llm-settings-toggle"
          className="flex w-full items-center justify-between gap-2 rounded-xl border border-gray-200 px-3.5 py-2.5 text-left transition hover:border-gray-300"
        >
          <span className="text-[13px] font-semibold text-slate-700">Settings</span>
          <ChevronDown className={`h-4 w-4 text-slate-400 transition ${settingsOpen ? "rotate-180" : ""}`} />
        </button>

        {settingsOpen ? (
          <div className="mt-4 space-y-5" data-testid="llm-settings">
            {dials.map((dial) => (
              <Dial
                key={dial.key}
                dial={dial}
                value={str(dial.key, dial.default)}
                onChange={set(dial.key)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </>
  );
}
