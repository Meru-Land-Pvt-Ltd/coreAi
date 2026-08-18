"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { isContainerNode, type PageSpec, type SpecNode, type Wire } from "@coreai/shared";
import type { AgentPageRuntime } from "../types";
import type { FaceRunResult } from "../blocks/output-stage";

/**
 * The spec run state — the machine that turns a page full of wired sockets
 * into a working product.
 *
 * The doctrine's third clause is "the wires live in named slots". This file is
 * what a named slot resolves to at runtime:
 *
 *   - a node with `wire.role === "input"` stores the customer's value under its
 *     OWN spec-node id, and remembers which workflow node it feeds;
 *   - a node with `wire.role === "action"` runs the chain — composing one
 *     engine prompt out of every input value on the page;
 *   - a node with `wire.role === "output"` renders the run that landed on its
 *     channel.
 *
 * Everything is per-page-visit client state. Nothing here is persisted, and no
 * spec value is ever evaluated — a spec is data, all the way down.
 */

// ---------------------------------------------------------------------------
// Constants mirrored from the block renderer (face-renderer.tsx).
//
// Those two constants are module-private over there and that file belongs to
// another fleet, so they are restated — not re-derived — here. `spec-run.test`
// pins them against `composeEngineInstructions`' real output so the two prompt
// builders can never quietly drift apart.
// ---------------------------------------------------------------------------

/** The backend accepts prompts up to this length (post-composition too). */
export const MAX_PROMPT_LENGTH = 4000;

/** Closing line of every instruction block — the brain must act, not re-ask. */
export const ANSWER_NOW_LINE =
  "Answer now using ALL of the information above. Do not ask again for anything the customer already provided.";

/**
 * Runs kept in memory this session. Media often arrives as multi-MB data:
 * URIs — an uncapped history would grow without bound during a long visit.
 */
export const MAX_RETAINED_RESULTS = 20;

/**
 * The channel a wire with no `nodeId` files under. A page whose author wrote
 * bare `{role:"action"}` / `{role:"output"}` wires still pairs its button to
 * its result, because both land here.
 */
export const DEFAULT_CHANNEL = "__spec_default__";

// ---------------------------------------------------------------------------
// Reading the page: which nodes are fields, which are actions.
// ---------------------------------------------------------------------------

export type SpecFieldKind = "input" | "upload" | "choice";

/** One input-wired node, in document order. */
export type SpecField = {
  /** The spec node's own id — the key its value is stored under. */
  specNodeId: string;
  /** The workflow node this field feeds, when the author named one. */
  wireNodeId?: string;
  label?: string;
  kind: SpecFieldKind;
};

function walk(nodes: SpecNode[], visit: (node: SpecNode) => void): void {
  for (const node of nodes) {
    visit(node);
    if (isContainerNode(node)) walk(node.children, visit);
  }
}

/** The channel a wire belongs to. Absent `nodeId` means the shared default. */
export function channelOf(wire: Wire | undefined): string {
  const nodeId = wire?.nodeId?.trim();
  return nodeId ? nodeId : DEFAULT_CHANNEL;
}

/**
 * Every input-wired field on the page, in document order. Order is read from
 * the tree rather than from mount order, so the composed prompt reads in the
 * same sequence the customer filled the page in — deterministically, and
 * without every field having to register itself on mount.
 */
export function collectSpecFields(page: PageSpec): SpecField[] {
  const fields: SpecField[] = [];
  walk(page.blocks, (node) => {
    if (node.type !== "input" && node.type !== "upload" && node.type !== "choice") return;
    if (node.wire?.role !== "input") return;
    fields.push({
      specNodeId: node.id,
      wireNodeId: node.wire.nodeId,
      label: node.label,
      kind: node.type
    });
  });
  return fields;
}

/** Every distinct channel an action button on this page runs. */
export function collectActionChannels(page: PageSpec): string[] {
  const channels: string[] = [];
  walk(page.blocks, (node) => {
    if (node.type !== "button" || node.wire?.role !== "action") return;
    const channel = channelOf(node.wire);
    if (!channels.includes(channel)) channels.push(channel);
  });
  return channels;
}

/**
 * Which channel an output node reads.
 *
 * The rule is forgiving on purpose. An AI-authored page very often wires the
 * button to a real workflow node (`{role:"action", nodeId:"gen"}`) and leaves
 * the result bare (`{role:"output"}`); a strict match would leave that page
 * permanently blank, which is the exact "broken" the doctrine forbids.
 *
 *   1. One action on the page → every output follows it, whatever was written.
 *   2. Several actions, output pinned to a node → strictly that node's channel.
 *   3. Several actions, output unpinned → whichever ran most recently.
 */
export function resolveResultChannel(
  wire: Wire | undefined,
  state: { actionChannels: string[]; lastChannel: string | null }
): string {
  if (state.actionChannels.length === 1) return state.actionChannels[0];
  const pinned = wire?.nodeId?.trim();
  if (pinned) return pinned;
  return state.lastChannel ?? DEFAULT_CHANNEL;
}

// ---------------------------------------------------------------------------
// Prompt composition — mirrors face-renderer's instruction block.
// ---------------------------------------------------------------------------

/** One filled-in field, ready to become a prompt line. */
export type ComposeField = {
  kind: SpecFieldKind;
  label?: string;
  value: string;
};

export type ComposedPrompt = {
  /** Travels to the engine. Carries the hidden scaffolding. */
  prompt: string;
  /** The customer's own words — the ONLY prompt text ever rendered. */
  displayPrompt: string;
};

function fieldLine(field: ComposeField): string | null {
  const value = field.value.trim();
  if (!value) return null;
  const label = field.label?.trim();

  if (field.kind === "choice") {
    return label
      ? `For '${label}', the customer selected: '${value}'.`
      : `The customer selected option: '${value}'.`;
  }
  if (field.kind === "upload") {
    return label
      ? `For '${label}', the customer attached a file: '${value}'.`
      : `The customer attached a file: '${value}'.`;
  }
  return label ? `For '${label}', the customer wrote: ${value}` : `The customer wrote: ${value}`;
}

/**
 * Builds the engine prompt and the display prompt for one run.
 *
 * Two behaviors are copied deliberately from the block renderer:
 *
 *   **Honesty.** `displayPrompt` is only ever the customer's own typed words —
 *   or, when they typed nothing, the button's label. The scaffolding (which
 *   button was pressed, which option was chosen, which file was attached) is
 *   engine-only and never reaches the DOM.
 *
 *   **Bare text stays bare.** A page that is one text box and one button with
 *   nothing else to say sends exactly what the customer typed, with no
 *   instruction block wrapped around it.
 *
 * The block always fits MAX_PROMPT_LENGTH by trimming the tail of the WRITTEN
 * text, never the instruction lines — a near-cap draft must not cost the
 * closing "answer now" order.
 */
export function composeSpecPrompt(parts: {
  buttonLabel?: string;
  fields: ComposeField[];
}): ComposedPrompt {
  const written = parts.fields.filter((field) => field.kind === "input");
  const others = parts.fields.filter((field) => field.kind !== "input");

  const typed = written
    .map((field) => field.value.trim())
    .filter((value) => value.length > 0);
  const displayPrompt = typed.length > 0 ? typed.join(" — ") : (parts.buttonLabel ?? "");

  // The bare case: nothing to explain, so explain nothing.
  const onlyBareText =
    !parts.buttonLabel &&
    others.length === 0 &&
    written.length === 1 &&
    !written[0].label?.trim() &&
    typed.length === 1;
  if (onlyBareText) {
    const bare = typed[0].slice(0, MAX_PROMPT_LENGTH);
    return { prompt: bare, displayPrompt: bare };
  }

  const scaffolding: string[] = [];
  if (parts.buttonLabel) {
    scaffolding.push(`The customer pressed the button: '${parts.buttonLabel}'.`);
  }
  for (const field of others) {
    const line = fieldLine(field);
    if (line) scaffolding.push(line);
  }

  const writtenLines: string[] = [];
  for (const field of written) {
    const line = fieldLine(field);
    if (line) writtenLines.push(line);
  }

  // Reserve the instruction lines and the closing order; the written block
  // absorbs whatever budget is left, trimmed from its tail.
  const overhead = [...scaffolding, ANSWER_NOW_LINE].join("\n").length + 1;
  const budget = Math.max(0, MAX_PROMPT_LENGTH - overhead);
  let writtenBlock = writtenLines.join("\n");
  if (writtenBlock.length > budget) writtenBlock = writtenBlock.slice(0, budget);

  const lines = [...scaffolding, ...(writtenBlock ? [writtenBlock] : []), ANSWER_NOW_LINE];
  return { prompt: lines.join("\n").slice(0, MAX_PROMPT_LENGTH), displayPrompt };
}

// ---------------------------------------------------------------------------
// State.
// ---------------------------------------------------------------------------

/** One finished run. Extends the block renderer's result with its channel. */
export type SpecRunResult = FaceRunResult & { channel: string };

/** What a retry needs to replay a failed run exactly. */
export type SpecRunRequest = {
  channel: string;
  prompt: string;
  displayPrompt: string;
};

export type SpecRunValue = {
  /** The raw value the customer put in, keyed by spec node id. */
  value: string;
  /** Display-only detail (a file's size), never sent to the engine. */
  detail?: string;
};

export type SpecRunContextValue = {
  /** Values keyed by SPEC node id. */
  values: Record<string, SpecRunValue | undefined>;
  setValue: (specNodeId: string, value: SpecRunValue | null) => void;

  /** Every finished run this visit, oldest first. */
  runs: SpecRunResult[];
  /** Channels an action button on this page can run. */
  actionChannels: string[];
  /** The channel of the most recent run. */
  lastChannel: string | null;

  /** In-flight run per channel — the display prompt to shimmer under. */
  pending: Record<string, string | undefined>;
  /** Failed run per channel, replayable by `retry`. */
  failed: Record<string, SpecRunRequest | undefined>;
  /** The run that just landed — only it gets the word-by-word reveal. */
  freshResultId: number | null;

  /** True once the daily free limit is spent (never in a preview). */
  limitReached: boolean;

  /** Press an action button. */
  runAction: (args: { channel: string; buttonLabel?: string }) => void;
  /** Replay the failed run on a channel. */
  retry: (channel: string) => void;
  /** Put an earlier run back on a channel's stage. */
  restore: (channel: string, resultId: number) => void;
  /** The run currently on a channel's stage. */
  resultFor: (channel: string) => SpecRunResult | null;
  /** Every run on a channel, oldest first. */
  runsFor: (channel: string) => SpecRunResult[];

  /** Page accent, for charts. */
  accent: string;
  /** Listing name, for media download filenames. */
  listingName: string;
};

const SpecRunContext = createContext<SpecRunContextValue | null>(null);

/**
 * The run state for the page. Returns null outside a provider, which is how a
 * wired node knows to paint itself inert — the builder's static preview and
 * the sections library's own tests both render with no provider mounted.
 */
export function useSpecRun(): SpecRunContextValue | null {
  return useContext(SpecRunContext);
}

function newSessionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `spec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export type SpecRunProviderProps = {
  /** The page whose wires this provider serves. */
  page: PageSpec;
  runtime: AgentPageRuntime;
  /**
   * Runs left today. `<= 0` starts the page in its limit state. Ignored in a
   * preview, which is never rate-limited.
   */
  remainingToday?: number;
  /** Page accent (resolved from the spec theme) — chart bars and lines. */
  accent?: string;
  /** Listing name — used for media download filenames. */
  listingName?: string;
  children: ReactNode;
};

export function SpecRunProvider({
  page,
  runtime,
  remainingToday,
  accent = "#f59e0b",
  listingName = "result",
  children
}: SpecRunProviderProps) {
  // Architect previews are never rate-limited — the limit state is a
  // published-page concept and must not appear while testing a draft.
  const isPreview = runtime.mode === "preview";

  const fields = useMemo(() => collectSpecFields(page), [page]);
  const actionChannels = useMemo(() => collectActionChannels(page), [page]);

  const [values, setValues] = useState<Record<string, SpecRunValue | undefined>>({});
  const [runs, setRuns] = useState<SpecRunResult[]>([]);
  const [activeByChannel, setActiveByChannel] = useState<Record<string, number | undefined>>({});
  const [pending, setPending] = useState<Record<string, string | undefined>>({});
  const [failed, setFailed] = useState<Record<string, SpecRunRequest | undefined>>({});
  const [lastChannel, setLastChannel] = useState<string | null>(null);
  const [freshResultId, setFreshResultId] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(
    !isPreview && typeof remainingToday === "number" && remainingToday <= 0
  );

  // One session per page visit — every run on every channel shares it.
  const [sessionId] = useState(newSessionId);
  const resultIdRef = useRef(0);

  /**
   * Channels with a run in the air right now.
   *
   * This is deliberately a ref and not the `pending` state: it is written and
   * read inside event handlers only, so it updates synchronously. Two clicks
   * landing in one tick would both pass a guard written against batched state,
   * and would fire the same run twice.
   */
  const inFlightRef = useRef<Set<string>>(new Set());

  /**
   * False once this provider leaves the page.
   *
   * A run is a promise nobody can recall: the customer can navigate away from
   * the product mid-answer, and `runtime.runOnce` still resolves afterwards.
   * Writing state at that point is a write to a tree that no longer exists —
   * React schedules a commit for a root it is tearing down, and the passive
   * flush it queues reads `window` on a later tick. Every settle path checks
   * this flag first, so a departed page simply drops its answer.
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const performRun = useCallback(
    async (request: SpecRunRequest) => {
      inFlightRef.current.add(request.channel);
      setPending((prev) => ({ ...prev, [request.channel]: request.displayPrompt }));
      setFailed((prev) => ({ ...prev, [request.channel]: undefined }));

      try {
        let result: Awaited<ReturnType<AgentPageRuntime["runOnce"]>>;
        try {
          result = await runtime.runOnce({ prompt: request.prompt, sessionId });
        } catch {
          // Both runtimes resolve with { error } today — but a thrown rejection
          // must never strand a channel in a forever-shimmer with no retry.
          if (!aliveRef.current) return;
          setPending((prev) => ({ ...prev, [request.channel]: undefined }));
          setFailed((prev) => ({ ...prev, [request.channel]: request }));
          return;
        }

        // The page may have been closed while the agent was thinking. Past this
        // line every branch writes state, so this is the one place to stop.
        if (!aliveRef.current) return;

        setPending((prev) => ({ ...prev, [request.channel]: undefined }));

        if (!("error" in result)) {
          resultIdRef.current += 1;
          const entry: SpecRunResult = {
            id: resultIdRef.current,
            channel: request.channel,
            displayPrompt: request.displayPrompt,
            basePrompt: request.displayPrompt,
            text: result.output.text,
            mediaUrls: result.output.mediaUrls,
            structured: result.output.structured ?? null
          };
          setRuns((prev) => [...prev, entry].slice(-MAX_RETAINED_RESULTS));
          setActiveByChannel((prev) => ({ ...prev, [request.channel]: entry.id }));
          setLastChannel(request.channel);
          setFreshResultId(entry.id);
          if (
            !isPreview &&
            typeof result.remainingToday === "number" &&
            result.remainingToday <= 0
          ) {
            setLimitReached(true);
          }
          return;
        }

        // Both limit codes count — same behavior as the block renderer.
        if (
          !isPreview &&
          (result.code === "PAGE_LIMIT_REACHED" || result.code === "DEMO_LIMIT_REACHED")
        ) {
          setLimitReached(true);
          return;
        }

        setFailed((prev) => ({ ...prev, [request.channel]: request }));
      } finally {
        // Whatever happened, the channel is free again — a run that failed on
        // a path nobody predicted must never lock its button forever.
        inFlightRef.current.delete(request.channel);
      }
    },
    [runtime, sessionId, isPreview]
  );

  const runAction = useCallback(
    ({ channel, buttonLabel }: { channel: string; buttonLabel?: string }) => {
      if (limitReached) return;
      // Only this channel is blocked while it works — a second button on
      // another channel stays live, so two products on one page run at once.
      if (inFlightRef.current.has(channel)) return;

      const composeFields: ComposeField[] = fields
        .map((field) => ({
          kind: field.kind,
          label: field.label,
          value: values[field.specNodeId]?.value ?? ""
        }))
        .filter((field) => field.value.trim().length > 0);

      const { prompt, displayPrompt } = composeSpecPrompt({ buttonLabel, fields: composeFields });
      // A button with nothing to say and no label would send an empty prompt.
      if (!prompt.trim()) return;

      void performRun({ channel, prompt, displayPrompt });
    },
    [fields, values, limitReached, performRun]
  );

  const retry = useCallback(
    (channel: string) => {
      if (limitReached) return;
      // Same in-flight guard as a fresh press: a double-tapped Try again must
      // not put two identical runs on the same channel.
      if (inFlightRef.current.has(channel)) return;
      const request = failed[channel];
      if (!request) return;
      void performRun(request);
    },
    [failed, limitReached, performRun]
  );

  const restore = useCallback((channel: string, resultId: number) => {
    // Restored runs render instantly — no replayed reveal.
    setFreshResultId(null);
    setActiveByChannel((prev) => ({ ...prev, [channel]: resultId }));
  }, []);

  const setValue = useCallback((specNodeId: string, value: SpecRunValue | null) => {
    setValues((prev) => ({ ...prev, [specNodeId]: value ?? undefined }));
  }, []);

  const runsFor = useCallback(
    (channel: string) => runs.filter((run) => run.channel === channel),
    [runs]
  );

  const resultFor = useCallback(
    (channel: string) => {
      const activeId = activeByChannel[channel];
      if (activeId !== undefined) {
        const active = runs.find((run) => run.id === activeId);
        if (active) return active;
      }
      // Falls back to the newest run on the channel, so a result restored from
      // a trimmed history never leaves the stage empty.
      const own = runs.filter((run) => run.channel === channel);
      return own.length > 0 ? own[own.length - 1] : null;
    },
    [activeByChannel, runs]
  );

  const value = useMemo<SpecRunContextValue>(
    () => ({
      values,
      setValue,
      runs,
      actionChannels,
      lastChannel,
      pending,
      failed,
      freshResultId,
      limitReached,
      runAction,
      retry,
      restore,
      resultFor,
      runsFor,
      accent,
      listingName
    }),
    [
      values,
      setValue,
      runs,
      actionChannels,
      lastChannel,
      pending,
      failed,
      freshResultId,
      limitReached,
      runAction,
      retry,
      restore,
      resultFor,
      runsFor,
      accent,
      listingName
    ]
  );

  return <SpecRunContext.Provider value={value}>{children}</SpecRunContext.Provider>;
}
