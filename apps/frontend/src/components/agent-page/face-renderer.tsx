"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Bot, RefreshCw } from "lucide-react";
import { BLOCK_NODE_TYPES } from "@coreai/shared";
import { publicAgentPath } from "@/lib/routes";
import {
  agentPageAccent,
  agentPageAccentForeground,
  type AgentPageData,
  type AgentPageRuntime,
  type FaceBlueprint
} from "./types";
import { PromptComposerBlock } from "./blocks/prompt-composer";
import { PresetGalleryBlock, type FacePreset } from "./blocks/preset-gallery";
import { ModelPickerBlock, type FaceModelOption } from "./blocks/model-picker";
import { ActionButtonRowBlock, type FaceActionButton } from "./blocks/action-button";
import {
  OutputStageBlock,
  type FaceRunResult,
  type OutputStageKind
} from "./blocks/output-stage";
import { ContinueChainBlock } from "./blocks/continue-chain";
import { HistoryShelfBlock } from "./blocks/history-shelf";

/**
 * FaceRenderer — assembles the customer-facing page from the product blocks
 * the architect placed on their canvas, in canvas order (the blueprint payload
 * from GET /agent-pages/:slug or the manage endpoint). Renders as a child of
 * AgentPageShell, exactly like the built-in templates it replaces.
 *
 * All run state is shared across blocks: the Prompt Box's prompt is augmented
 * with the selected style's hidden instructions and the picked model context,
 * the Result Viewer shows the run on stage, the Continue Button chains from
 * it on the same session, and the History Shelf restores earlier runs.
 */

export type FaceRendererProps = {
  data: AgentPageData;
  slug: string;
  runtime: AgentPageRuntime;
  blueprint: FaceBlueprint;
};

/** The backend accepts prompts up to this length (post-augmentation too). */
const MAX_PROMPT_LENGTH = 4000;

/**
 * Results kept in memory this session. Media often arrives as multi-MB data:
 * URIs — an uncapped history would grow without bound during a long session
 * (especially builder previews, which are never rate-limited).
 */
const MAX_RETAINED_RESULTS = 20;

const DEFAULT_PROMPT_PLACEHOLDER = "Describe what you want…";
const DEFAULT_CONTINUE_LABEL = "Continue";
const DEFAULT_ACTION_BUTTON_LABEL = "Go";

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `face-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Config coercion — blueprints arrive backend-sanitized; these only guarantee
// shape so a hand-edited or stale payload can never crash the page.
// ---------------------------------------------------------------------------

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function presetsFrom(config: Record<string, unknown>): FacePreset[] {
  if (!Array.isArray(config.presets)) return [];
  const presets: FacePreset[] = [];
  for (const entry of config.presets) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id.length === 0) continue;
    if (typeof raw.title !== "string" || raw.title.length === 0) continue;
    presets.push({
      id: raw.id,
      title: raw.title,
      emoji: typeof raw.emoji === "string" ? raw.emoji : "",
      promptFragment: typeof raw.promptFragment === "string" ? raw.promptFragment : ""
    });
  }
  return presets;
}

function optionsFrom(config: Record<string, unknown>): FaceModelOption[] {
  if (!Array.isArray(config.options)) return [];
  const options: FaceModelOption[] = [];
  for (const entry of config.options) {
    if (typeof entry !== "object" || entry === null) continue;
    const raw = entry as Record<string, unknown>;
    if (typeof raw.id !== "string" || raw.id.length === 0) continue;
    options.push({
      id: raw.id,
      label: typeof raw.label === "string" && raw.label.length > 0 ? raw.label : raw.id
    });
  }
  return options;
}

function kindFrom(config: Record<string, unknown>): OutputStageKind {
  const kind = config.kind;
  return kind === "image" || kind === "video" || kind === "text" ? kind : "auto";
}

/**
 * One run, with the engine prompt kept strictly apart from what the page may
 * show. `prompt` carries the hidden instruction block (button press, chosen
 * style, picked option, typed words) and only ever travels to the engine;
 * `displayPrompt` is the customer's own words (or the Continue button's
 * label) and is the only prompt rendered; `basePrompt` seeds Continue chains
 * so scaffolding never nests.
 */
type RunRequest = {
  prompt: string;
  displayPrompt: string;
  basePrompt: string;
};

/** Closing line of every instruction block — the brain must act, not re-ask. */
const ENGINE_ANSWER_NOW_LINE =
  "Answer now using ALL of the information above. Do not ask again for anything the customer already provided.";

const WRITTEN_LINE_PREFIX = "The customer wrote: ";

/**
 * The engine prompt is an explicit instruction block, not bare prefixes:
 * every piece of input the customer provided becomes one plain sentence the
 * brain can act on, closed by a line that forbids re-asking for anything
 * already given. None of it ever reaches the DOM — displayPrompt stays the
 * customer's own words.
 *
 * The block always fits MAX_PROMPT_LENGTH by trimming the tail of the
 * written text, never the instruction lines — a near-cap draft must not cost
 * the closing "answer now" order (the call-site slice would otherwise cut
 * the block from the bottom).
 */
export function composeEngineInstructions(parts: {
  buttonLabel?: string;
  style?: FacePreset | null;
  optionLabel?: string | null;
  written?: string;
}): string {
  const lines: string[] = [];

  if (parts.buttonLabel) {
    lines.push(`The customer pressed the button: '${parts.buttonLabel}'.`);
  }

  if (parts.style) {
    const fragment = parts.style.promptFragment.trim();
    lines.push(
      fragment
        ? `The customer selected style: '${parts.style.title}' — ${fragment}${/[.!?]$/.test(fragment) ? "" : "."}`
        : `The customer selected style: '${parts.style.title}'.`
    );
  }

  if (parts.optionLabel) {
    lines.push(`The customer selected option: '${parts.optionLabel}'.`);
  }

  if (parts.written) {
    const overhead = [...lines, WRITTEN_LINE_PREFIX, ENGINE_ANSWER_NOW_LINE].join("\n").length;
    const written = parts.written.slice(0, Math.max(0, MAX_PROMPT_LENGTH - overhead));
    if (written) lines.push(`${WRITTEN_LINE_PREFIX}${written}`);
  }

  lines.push(ENGINE_ANSWER_NOW_LINE);
  return lines.join("\n");
}

export function FaceRenderer({ data, runtime, blueprint }: FaceRendererProps) {
  const accent = agentPageAccent(data);
  // Light accents flip button text/icons to dark slate so they stay legible.
  const accentText = agentPageAccentForeground(accent);
  const { listing, page } = data;
  const headline = page.headline ?? listing.name;

  // Architect previews are never rate-limited — the limit card is a
  // published-page concept and must not appear while testing a draft.
  const isPreview = runtime.mode === "preview";

  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  // The Prompt Box's live draft, mirrored up so Button presses can include
  // whatever the customer has typed without submitting the composer.
  const [composerDraft, setComposerDraft] = useState("");
  const [pendingRun, setPendingRun] = useState<RunRequest | null>(null);
  const [results, setResults] = useState<FaceRunResult[]>([]);
  const [activeResultId, setActiveResultId] = useState<number | null>(null);
  const [failedRun, setFailedRun] = useState<RunRequest | null>(null);
  // The run that just finished — only its text gets the word-by-word reveal;
  // results restored from the History Shelf render instantly.
  const [freshResultId, setFreshResultId] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(
    !isPreview && data.limits.remainingToday <= 0
  );

  // One session per page visit — every run (including Continue) shares it.
  const [sessionId] = useState(newSessionId);

  const resultIdRef = useRef(0);

  // Every style across every Styles Gallery on the page — the title and the
  // hidden instructions both travel to the engine as one instruction line.
  const presetById = useMemo(() => {
    const map = new Map<string, FacePreset>();
    for (const block of blueprint.blocks) {
      if (block.type !== BLOCK_NODE_TYPES.presetGallery) continue;
      for (const preset of presetsFrom(block.config)) {
        map.set(preset.id, preset);
      }
    }
    return map;
  }, [blueprint]);

  // Model choices across every Model Picker on the page. The human label is
  // what travels as prompt context — a generated id means nothing to the AI.
  const modelLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const block of blueprint.blocks) {
      if (block.type !== BLOCK_NODE_TYPES.modelPicker) continue;
      for (const option of optionsFrom(block.config)) {
        map.set(option.id, option.label);
      }
    }
    return map;
  }, [blueprint]);

  const hasOutputStage = blueprint.blocks.some(
    (block) => block.type === BLOCK_NODE_TYPES.outputStage
  );
  const hasPromptComposer = blueprint.blocks.some(
    (block) => block.type === BLOCK_NODE_TYPES.promptComposer
  );

  // Every Button on the canvas, in blueprint (canvas) order. They render as
  // ONE row at the earliest Button's position — a scattered canvas must never
  // scatter buttons across the customer page.
  const actionButtons = useMemo<FaceActionButton[]>(
    () =>
      blueprint.blocks
        .filter((block) => block.type === BLOCK_NODE_TYPES.actionButton)
        .map((block) => ({
          label: asText(block.config.label, DEFAULT_ACTION_BUTTON_LABEL)
        })),
    [blueprint]
  );
  const firstActionButtonIndex = blueprint.blocks.findIndex(
    (block) => block.type === BLOCK_NODE_TYPES.actionButton
  );

  const running = pendingRun !== null;
  const activeResult =
    results.find((result) => result.id === activeResultId) ??
    (results.length > 0 ? results[results.length - 1] : null);

  async function performRun(request: RunRequest) {
    setPendingRun(request);
    setFailedRun(null);

    let result: Awaited<ReturnType<AgentPageRuntime["runOnce"]>>;
    try {
      result = await runtime.runOnce({ prompt: request.prompt, sessionId });
    } catch {
      // Both runtimes resolve with { error } today — but a thrown rejection
      // must never strand the page in a forever-shimmer with no retry.
      setPendingRun(null);
      setFailedRun(request);
      return;
    }

    setPendingRun(null);

    if (!("error" in result)) {
      resultIdRef.current += 1;
      const entry: FaceRunResult = {
        id: resultIdRef.current,
        displayPrompt: request.displayPrompt,
        basePrompt: request.basePrompt,
        text: result.output.text,
        mediaUrls: result.output.mediaUrls
      };
      // Keep only the newest results — media is often multi-MB data: URIs.
      setResults((prev) => [...prev, entry].slice(-MAX_RETAINED_RESULTS));
      setActiveResultId(entry.id);
      setFreshResultId(entry.id);
      if (!isPreview && typeof result.remainingToday === "number" && result.remainingToday <= 0)
        setLimitReached(true);
      return;
    }

    // Both limit codes count — same behavior as the built-in templates.
    if (
      !isPreview &&
      (result.code === "PAGE_LIMIT_REACHED" || result.code === "DEMO_LIMIT_REACHED")
    ) {
      setLimitReached(true);
      return;
    }

    setFailedRun(request);
  }

  /** The picked model's human label — the only form the AI can act on. */
  function selectedModelContext(): string | null {
    if (!selectedModelId) return null;
    return modelLabelById.get(selectedModelId) ?? null;
  }

  /**
   * A Prompt Box submit. Bare typed text travels as-is; the moment a style or
   * option rides along, the engine prompt becomes an explicit instruction
   * block so the brain uses everything instead of re-asking. Only `base`
   * (the customer's own words) is ever shown back to them.
   */
  function requestGenerate(rawPrompt: string) {
    const base = rawPrompt.trim();
    if (!base || running || limitReached) return;

    const preset = selectedPresetId ? presetById.get(selectedPresetId) ?? null : null;
    const modelLabel = selectedModelContext();
    const prompt =
      preset || modelLabel
        ? composeEngineInstructions({ style: preset, optionLabel: modelLabel, written: base })
        : base;

    void performRun({
      prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
      displayPrompt: base,
      basePrompt: base
    });
  }

  /**
   * A Button press — a doorway into the graph. The engine prompt is an
   * instruction block naming the pressed button plus whatever the customer
   * already put in (composer text, style, model choice); an empty composer is
   * fine, so button-only products work. The customer only ever sees their own
   * words — or, when they typed nothing, the button's label.
   */
  function requestButtonRun(label: string) {
    if (running || limitReached) return;
    const base = composerDraft.trim();

    const preset = selectedPresetId ? presetById.get(selectedPresetId) ?? null : null;
    const prompt = composeEngineInstructions({
      buttonLabel: label,
      style: preset,
      optionLabel: selectedModelContext(),
      written: base || undefined
    });

    void performRun({
      prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
      displayPrompt: base || label,
      basePrompt: base || label
    });
  }

  /** A Continue Button tap — chain from the result currently on stage. */
  function requestContinue(label: string) {
    if (!activeResult || running || limitReached) return;
    // Chain from the last output text, falling back to the customer's own
    // prompt that seeded the chain — never the augmented engine prompt, so
    // repeated taps can't nest scaffolding or duplicate hidden instructions.
    const basis = activeResult.text?.trim() || activeResult.basePrompt;
    let prompt = `Continue from the previous result:\n${basis}`;
    const modelLabel = selectedModelContext();
    if (modelLabel) prompt = `The customer selected option: '${modelLabel}'.\n${prompt}`;

    void performRun({
      prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
      displayPrompt: label,
      basePrompt: activeResult.basePrompt
    });
  }

  const errorState =
    failedRun !== null && !running
      ? { onRetry: () => void performRun(failedRun) }
      : null;

  const limitCard = (
    <div
      className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm"
      data-testid="agent-page-limit-card"
    >
      <p className="text-base font-semibold text-slate-900">
        This agent&apos;s free preview is done for today
      </p>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
        Get {listing.name} to keep creating — no daily limits.
      </p>
      <Link
        href={publicAgentPath(listing.id)}
        data-testid="agent-page-limit-cta"
        className="mt-4 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold text-white transition hover:opacity-90 sm:w-auto"
        style={{ backgroundColor: accent, color: accentText }}
      >
        Get this agent
      </Link>
    </div>
  );

  function renderBlock(block: FaceBlueprint["blocks"][number], index: number) {
    const key = `${block.type}-${index}`;

    switch (block.type) {
      case BLOCK_NODE_TYPES.promptComposer:
        if (limitReached) return <div key={key}>{limitCard}</div>;
        return (
          <PromptComposerBlock
            key={key}
            placeholder={asText(block.config.placeholder, DEFAULT_PROMPT_PLACEHOLDER)}
            accent={accent}
            accentText={accentText}
            busy={running}
            onGenerate={requestGenerate}
            onDraftChange={setComposerDraft}
          />
        );

      case BLOCK_NODE_TYPES.presetGallery:
        return (
          <PresetGalleryBlock
            key={key}
            presets={presetsFrom(block.config)}
            selectedId={selectedPresetId}
            onSelect={setSelectedPresetId}
            // In the builder's Test preview an empty gallery still shows a
            // placeholder — a freshly dropped block must never look broken.
            emptyHint={
              isPreview
                ? "Your style cards will appear here — add styles in this section's panel on the Build tab."
                : null
            }
          />
        );

      case BLOCK_NODE_TYPES.modelPicker:
        return (
          <ModelPickerBlock
            key={key}
            options={optionsFrom(block.config)}
            selectedId={selectedModelId}
            onSelect={setSelectedModelId}
            accent={accent}
            accentText={accentText}
            emptyHint={
              isPreview
                ? "Your choices will appear here — add them in this section's panel on the Build tab."
                : null
            }
          />
        );

      case BLOCK_NODE_TYPES.actionButton: {
        // All Buttons render as one row where the earliest one sits; the
        // rest render nothing so the row never repeats down the page.
        if (index !== firstActionButtonIndex) return null;
        // When the daily limit hits, a page with a Prompt Box already shows
        // the limit card there; a button-only page shows it here instead.
        if (limitReached) return hasPromptComposer ? null : <div key={key}>{limitCard}</div>;
        return (
          <ActionButtonRowBlock
            key={key}
            buttons={actionButtons}
            busy={running}
            accent={accent}
            accentText={accentText}
            onPress={requestButtonRun}
          />
        );
      }

      case BLOCK_NODE_TYPES.outputStage:
        return (
          <OutputStageBlock
            key={key}
            kind={kindFrom(block.config)}
            runningPrompt={pendingRun?.displayPrompt ?? null}
            result={activeResult}
            listingName={listing.name}
            error={errorState}
            animateText={activeResult !== null && activeResult.id === freshResultId}
          />
        );

      case BLOCK_NODE_TYPES.continueChain: {
        // Appears only after a successful run — never on a fresh page.
        if (results.length === 0 || limitReached) return null;
        const label = asText(block.config.label, DEFAULT_CONTINUE_LABEL);
        return (
          <ContinueChainBlock
            key={key}
            label={label}
            busy={running}
            accent={accent}
            accentText={accentText}
            onContinue={() => requestContinue(label)}
          />
        );
      }

      case BLOCK_NODE_TYPES.historyShelf:
        return (
          <HistoryShelfBlock
            key={key}
            results={results}
            activeId={activeResult?.id ?? null}
            onRestore={(id) => {
              // Restored results render instantly — no replayed reveal.
              setFreshResultId(null);
              setActiveResultId(id);
            }}
          />
        );

      default:
        // Future block types flow through the payload — older pages skip them.
        return null;
    }
  }

  // "Pin the box at the bottom" (Claude-style): the Prompt Box docks as a
  // sticky footer instead of flowing inline, when the design dial says so.
  const pinComposerBottom = data.design?.composerPosition === "bottom";
  const composerIndex = blueprint.blocks.findIndex(
    (block) => block.type === BLOCK_NODE_TYPES.promptComposer
  );
  const dockComposer = pinComposerBottom && composerIndex !== -1;

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-page-face">
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col items-center text-center">
          {listing.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.iconUrl}
              alt=""
              className="h-14 w-14 rounded-2xl border border-gray-100 object-cover"
            />
          ) : (
            <span
              className="flex h-14 w-14 items-center justify-center rounded-2xl text-white"
              style={{ backgroundColor: accent, color: accentText }}
            >
              <Bot className="h-7 w-7" aria-hidden="true" />
            </span>
          )}

          <h1
            className="mt-5 text-2xl font-bold tracking-tight text-slate-900"
            data-testid="agent-page-headline"
          >
            {headline}
          </h1>

          {page.welcomeMessage ? (
            <p
              className="mt-2 max-w-md text-base leading-relaxed text-slate-600"
              data-testid="agent-page-welcome"
            >
              {page.welcomeMessage}
            </p>
          ) : null}
        </div>

        {blueprint.blocks.map((block, index) =>
          dockComposer && index === composerIndex ? null : renderBlock(block, index)
        )}

        {/* Pages without a Result Viewer still surface failures honestly. */}
        {!hasOutputStage && failedRun !== null && !running ? (
          <div className="mt-6" data-testid="agent-block-run-error">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm leading-relaxed text-red-700">
              <span>Something went wrong. Please try again.</span>
              <button
                type="button"
                data-testid="agent-block-retry"
                onClick={() => void performRun(failedRun)}
                className="inline-flex items-center gap-1 font-semibold underline transition hover:text-red-800 motion-reduce:transition-none"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : null}
      </div>
      </div>

      {dockComposer ? (
        <div className="flex-none border-t border-gray-100 bg-white/85 backdrop-blur">
          <div className="mx-auto w-full max-w-3xl px-4 pb-4 sm:px-6">
            {renderBlock(blueprint.blocks[composerIndex], composerIndex)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
