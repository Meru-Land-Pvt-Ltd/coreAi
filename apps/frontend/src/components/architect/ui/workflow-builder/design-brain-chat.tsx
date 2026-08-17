import { useEffect, useRef, useState } from "react";
import { designChat, productChat } from "@/components/architect/features/api";
import type { DesignChatMessage } from "@/components/architect/features/types";
import { BuilderIcon } from "./icons";

/**
 * The Design Brain conversation — one reusable chat, two homes:
 *
 * - "inspector": inside the node properties sidebar (its original home).
 *   Exact same look, copy and testids as before the extraction, so the
 *   sidebar keeps working unchanged.
 * - "docked": a slim, full-height column beside the Test preview. The
 *   architect types how the page should look and watches the frame change
 *   in place, so the "check the Test tab" note never shows here.
 *
 * Both variants talk to the same styling endpoint (designChat) and call
 * onApplied after a change lands so the preview can refetch its config.
 */

const STARTER_SUGGESTIONS = [
  "Dark theme",
  "Pin the box at the bottom",
  "Make it feel warm and welcoming"
] as const;

/**
 * Build mode asks for a whole product, so the examples are briefs, not dials.
 * Each one names a business and what the page is for — the two things the
 * Product Architect needs before it can write pages worth selling.
 */
const BUILD_SUGGESTIONS = [
  "A sell page with pricing and an FAQ",
  "Add privacy and terms pages",
  "A contact page"
] as const;

const FALLBACK_REPLY = "That one didn't go through — give it another try in a moment.";
const BUILD_FALLBACK_REPLY =
  "I couldn't build that one. Say in a sentence what the page should do, and I'll try again.";
const MAX_INSTRUCTION_LENGTH = 500;
/** The build endpoint accepts a longer brief than a styling instruction. */
const MAX_BUILD_INSTRUCTION_LENGTH = 800;
const MAX_HISTORY_TURNS = 10;

/**
 * Two jobs, one chat. "style" turns the dials on the page that already exists
 * (fast, small, the everyday case). "build" hands the whole thing to the
 * Product Architect, which writes pages, sections, copy and the wires back to
 * the agent. They are different endpoints because they are different work —
 * the switch is here so an architect never has to know that.
 */
type ChatMode = "style" | "build";

const MODES: Array<{ id: ChatMode; label: string; hint: string }> = [
  { id: "style", label: "Style", hint: "Change how the page looks" },
  { id: "build", label: "Packaging", hint: "Sell page, pricing, FAQ and legal — the pages that sell your product" }
];

type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The Design Brain changed at least one dial with this reply. */
  applied?: boolean;
  /** Local fallback line (send failed) — never sent back as history. */
  local?: boolean;
};

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `design-brain-message-${messageCounter}`;
}

export type DesignBrainChatVariant = "inspector" | "docked";

export function DesignBrainChat({
  workflowId,
  variant,
  previewVisible = false,
  onApplied
}: {
  /** Saved workflow id — null while a brand-new agent has not autosaved yet. */
  workflowId: string | null;
  /** Where this chat lives — sidebar panel or the column beside the preview. */
  variant: DesignBrainChatVariant;
  /** Inspector only: true while the architect is watching the Test preview. */
  previewVisible?: boolean;
  /**
   * Called after a change lands so the Test preview refetches the page.
   * `graphChanged` is true when the Design Brain also changed the saved
   * canvas graph — the builder then reloads nodes/edges from the server.
   * Backward compatible: zero-argument callbacks keep working unchanged.
   */
  onApplied?: (result: { graphChanged?: boolean }) => void;
}) {
  const docked = variant === "docked";
  /** Testid prefix — "design-brain-*" in the sidebar, "design-dock-*" beside the preview. */
  const t = docked ? "design-dock" : "design-brain";

  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ChatMode>("style");
  const listRef = useRef<HTMLDivElement | null>(null);

  const building = mode === "build";
  const maxLength = building ? MAX_BUILD_INSTRUCTION_LENGTH : MAX_INSTRUCTION_LENGTH;

  // Keep the newest bubble in view as the conversation grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending]);

  const ready = Boolean(workflowId) && !sending;

  async function send(instruction: string) {
    const trimmed = instruction.trim().slice(0, maxLength);
    if (!trimmed || sending || !workflowId) return;

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
        {
          id: nextMessageId(),
          role: "assistant",
          content: building ? BUILD_FALLBACK_REPLY : FALLBACK_REPLY,
          local: true
        }
      ]);

    try {
      if (building) {
        const result = await productChat(workflowId, {
          instruction: trimmed,
          ...(history.length ? { history } : {})
        });
        const data = result.success ? result.data : undefined;

        if (!data) {
          failed();
          return;
        }

        // A build always rewrites the saved product, so the preview must
        // refetch even when no NEW page was added (it may have rewritten one).
        const built = data.pagesCreated.length;
        setMessages((current) => [
          ...current,
          {
            id: nextMessageId(),
            role: "assistant",
            content: built
              ? `${data.reply} (${built} new ${built === 1 ? "page" : "pages"})`
              : data.reply,
            applied: true
          }
        ]);
        onApplied?.({});
        return;
      }

      const result = await designChat(workflowId, {
        instruction: trimmed,
        ...(history.length ? { history } : {})
      });
      const data = result.success ? result.data : undefined;

      if (data) {
        const graphChanged = data.graphChanged === true;
        const applied = Object.keys(data.patch ?? {}).length > 0 || graphChanged;
        setMessages((current) => [
          ...current,
          { id: nextMessageId(), role: "assistant", content: data.reply, applied }
        ]);
        if (applied) onApplied?.({ graphChanged });
      } else {
        failed();
      }
    } catch {
      failed();
    } finally {
      setSending(false);
    }
  }

  const conversation = (
    <>
      {workflowId ? null : (
        <p
          className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
          data-testid={`${t}-save-first`}
        >
          Your agent is still saving — one moment and we can start styling.
        </p>
      )}

      <div
        className="mb-3 inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5"
        data-testid={`${t}-mode`}
        role="group"
        aria-label="What the Design Brain should do"
      >
        {MODES.map((option) => {
          const active = option.id === mode;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => setMode(option.id)}
              aria-pressed={active}
              title={option.hint}
              data-testid={`${t}-mode-${option.id}`}
              className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                active ? "bg-white text-slate-800 shadow-sm" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {messages.length === 0 ? (
        <div data-testid={`${t}-empty`} className={docked ? "min-h-0 flex-1" : undefined}>
          <div className="flex flex-wrap gap-2">
            {(building ? BUILD_SUGGESTIONS : STARTER_SUGGESTIONS).map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                disabled={!ready}
                data-testid={`${t}-chip-${index}`}
                className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          data-testid={`${t}-messages`}
          className={
            docked
              ? "mb-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
              : "mb-1 max-h-72 space-y-2 overflow-y-auto pr-1"
          }
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p
                  data-testid={`${t}-message-user`}
                  className="max-w-[85%] rounded-2xl rounded-br-md bg-amber-500 px-3 py-2 text-xs leading-5 text-white"
                >
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex flex-col items-start">
                <p
                  data-testid={`${t}-message-assistant`}
                  className="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-800"
                >
                  {message.content}
                </p>
                {message.applied && !docked && !previewVisible ? (
                  <p
                    data-testid={`${t}-applied-note`}
                    className="mt-1 pl-1 text-[10px] font-semibold text-emerald-600"
                  >
                    Applied — check the Test tab
                  </p>
                ) : null}
              </div>
            )
          )}

          {sending ? (
            <div className="flex justify-start" data-testid={`${t}-typing`}>
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
            building
              ? "e.g. a sell page with pricing and an FAQ"
              : "e.g. dark theme with a green accent"
          }
          maxLength={maxLength}
          disabled={!workflowId}
          spellCheck={false}
          data-testid={`${t}-input`}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-none outline-none ring-0 transition-colors placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-0 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={!ready || !draft.trim()}
          data-testid={`${t}-send`}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500 text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          <BuilderIcon name="arrow-right" className="h-4 w-4" />
        </button>
      </form>
    </>
  );

  if (docked) {
    // Slim column: messages grow and scroll, the composer stays pinned below.
    return <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">{conversation}</div>;
  }

  return (
    <div className="border-b border-gray-100 p-5" data-testid="design-brain-panel">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">
        Design Brain
      </h3>
      <p className="mb-4 text-xs leading-5 text-slate-500" data-testid="design-brain-intro">
        {building
          ? "Describe the pages that sell your product — it writes them. Your working interface comes from the Smart Designer."
          : "Tell it how your page should look and feel — it restyles everything for you."}
      </p>
      {conversation}
    </div>
  );
}
