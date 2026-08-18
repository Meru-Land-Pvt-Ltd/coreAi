import { useEffect, useRef, useState } from "react";
import { smartCompose, smartDesignerChat } from "@/components/architect/features/api";
import type { DesignChatMessage } from "@/components/architect/features/types";
import { BuilderIcon } from "./icons";

/**
 * Smart Designer — the architect's side of the composed-interface feedback
 * loop. A completely separate feature from the Design Brain chat (which keeps
 * styling the page dials untouched); this panel talks to the AI Composer:
 *
 * 1. One primary action while no composed spec exists: "Generate my product's
 *    interface". The composer reads every node's declarations and writes the
 *    minimum page out of our pre-built components.
 * 2. Afterwards, a chat: the architect says what the composer got wrong
 *    ("this box isn't capturing email separately") and it fixes the spec —
 *    like talking to Claude Code, never by dragging.
 *
 * Product UI only. Packaging asks (privacy, landing, sell pages) come back
 * with boundary: "packaging" — rendered as a quiet redirect note, not a
 * failure, and never a preview refetch.
 */

const COMPOSE_FALLBACK_REPLY =
  "I couldn't design the interface just now. Give it a moment and try again.";
const CHAT_FALLBACK_REPLY = "That one didn't go through — give it another try in a moment.";
const MAX_INSTRUCTION_LENGTH = 500;
const MAX_HISTORY_TURNS = 10;

/**
 * Honest progress copy — the two real phases of a compose, no fake
 * percentages. The second line takes over after the read phase has plainly
 * had time to finish.
 */
const PROGRESS_STAGES = ["Reading your workflow…", "Designing the interface…"] as const;
const PROGRESS_STAGE_SWITCH_MS = 1500;

type SmartBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The reply was a packaging redirect — shown as a quiet note, not a fix. */
  boundary?: boolean;
  /** Compose replies carry the merge count so the win is visible. */
  merged?: number;
  /** Local fallback line (send failed) — never sent back as history. */
  local?: boolean;
};

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `smart-designer-message-${messageCounter}`;
}

export function SmartDesignerPanel({
  workflowId,
  hasComposedSpec = false,
  onApplied
}: {
  /** Saved workflow id — null while a brand-new agent has not autosaved yet. */
  workflowId: string | null;
  /** True when a composed spec already exists (product blocks on the graph). */
  hasComposedSpec?: boolean;
  /**
   * Same refetch contract as the Design Brain chat: called after the composer
   * lands a change so the Test preview refetches the page. Never called for
   * a packaging redirect — nothing changed.
   */
  onApplied?: (result: { graphChanged?: boolean }) => void;
}) {
  const [messages, setMessages] = useState<SmartBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [composed, setComposed] = useState(hasComposedSpec);
  const listRef = useRef<HTMLDivElement | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the newest bubble in view as the conversation grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending, generating]);

  // A compose can outlive the panel (the architect closes the dock) — the
  // stage timer must not fire into an unmounted component.
  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    };
  }, []);

  const chatReady = Boolean(workflowId) && composed && !sending && !generating;

  async function generate() {
    if (!workflowId || generating || sending) return;

    setGenerating(true);
    setProgressStage(0);
    progressTimerRef.current = setTimeout(
      () => setProgressStage(1),
      PROGRESS_STAGE_SWITCH_MS
    );

    try {
      const result = await smartCompose(workflowId);
      const data = result.success ? result.data : undefined;

      if (data) {
        setComposed(true);
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: "assistant",
            content: data.reply,
            merged: data.merged
          }
        ]);
        onApplied?.({});
      } else {
        setMessages((current) => [
          ...current,
          { id: nextMessageId(), role: "assistant", content: COMPOSE_FALLBACK_REPLY, local: true }
        ]);
      }
    } catch {
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "assistant", content: COMPOSE_FALLBACK_REPLY, local: true }
      ]);
    } finally {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      setGenerating(false);
    }
  }

  async function send(instruction: string) {
    const trimmed = instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH);
    if (!trimmed || !chatReady || !workflowId) return;

    // History is everything said so far (newest last), minus local error lines.
    const history: DesignChatMessage[] = messages
      .filter((message) => !message.local)
      .slice(-MAX_HISTORY_TURNS)
      .map((message) => ({ role: message.role, content: message.content }));

    setMessages((current) => [...current, { id: nextMessageId(), role: "user", content: trimmed }]);
    setDraft("");
    setSending(true);

    const failed = () =>
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "assistant", content: CHAT_FALLBACK_REPLY, local: true }
      ]);

    try {
      const result = await smartDesignerChat(workflowId, {
        instruction: trimmed,
        ...(history.length ? { history } : {})
      });
      const data = result.success ? result.data : undefined;

      if (!data) {
        failed();
        return;
      }

      if (data.boundary === "packaging") {
        // A redirect, not a failure — and nothing changed, so no refetch.
        setMessages((current) => [
          ...current,
          { id: nextMessageId(), role: "assistant", content: data.reply, boundary: true }
        ]);
        return;
      }

      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "assistant", content: data.reply }
      ]);
      onApplied?.({});
    } catch {
      failed();
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3"
      data-testid="smart-designer-panel"
    >
      {workflowId ? null : (
        <p
          className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
          data-testid="smart-designer-save-first"
        >
          Your agent is still saving — one moment and we can design its interface.
        </p>
      )}

      {composed ? null : (
        <div className="mb-3" data-testid="smart-designer-intro">
          <p className="mb-3 text-xs leading-5 text-slate-500">
            The composer reads your whole workflow — every question your nodes need answered —
            and designs the smallest page that does the job.
          </p>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!workflowId || generating}
            data-testid="smart-designer-generate"
            className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            Generate my product&apos;s interface
          </button>
        </div>
      )}

      {messages.length === 0 && !generating ? (
        composed ? (
          <p
            className="min-h-0 flex-1 text-xs leading-5 text-slate-500"
            data-testid="smart-designer-empty"
          >
            Your interface is generated. Tell me what to change — &ldquo;this box isn&apos;t
            capturing email separately&rdquo; — and I&apos;ll fix it.
          </p>
        ) : (
          <div className="min-h-0 flex-1" />
        )
      ) : (
        <div
          ref={listRef}
          data-testid="smart-designer-messages"
          className="mb-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p
                  data-testid="smart-designer-message-user"
                  className="max-w-[85%] rounded-2xl rounded-br-md bg-amber-500 px-3 py-2 text-xs leading-5 text-white"
                >
                  {message.content}
                </p>
              </div>
            ) : message.boundary ? (
              // A packaging redirect — visibly quieter than a normal reply so
              // the architect reads "sent elsewhere", never "failed".
              <div key={message.id} className="flex flex-col items-start">
                <div
                  data-testid="smart-designer-boundary"
                  className="max-w-[85%] rounded-2xl rounded-bl-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    That belongs to Packaging
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-600">{message.content}</p>
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex flex-col items-start">
                <p
                  data-testid="smart-designer-message-assistant"
                  className="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-800"
                >
                  {message.content}
                </p>
                {typeof message.merged === "number" && message.merged > 0 ? (
                  <p
                    data-testid="smart-designer-merged"
                    className="mt-1 pl-1 text-[10px] font-semibold text-emerald-600"
                  >
                    {message.merged} inputs merged
                  </p>
                ) : null}
              </div>
            )
          )}

          {generating ? (
            <div className="flex justify-start" data-testid="smart-designer-progress">
              <span className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                <span className="text-xs leading-5 text-slate-600">
                  {PROGRESS_STAGES[progressStage]}
                </span>
              </span>
            </div>
          ) : null}

          {sending ? (
            <div className="flex justify-start" data-testid="smart-designer-typing">
              <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
            </div>
          ) : null}
        </div>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={
            composed
              ? "e.g. this box isn't capturing email separately"
              : "Generate the interface first"
          }
          maxLength={MAX_INSTRUCTION_LENGTH}
          disabled={!workflowId || !composed || generating}
          spellCheck={false}
          data-testid="smart-designer-input"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-none outline-none ring-0 transition-colors placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-0 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={!chatReady || !draft.trim()}
          data-testid="smart-designer-send"
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500 text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          <BuilderIcon name="arrow-right" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
