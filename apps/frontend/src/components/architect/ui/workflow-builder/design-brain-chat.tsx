import { useEffect, useRef, useState } from "react";
import { productChat } from "@/components/architect/features/api";
import type { DesignChatMessage } from "@/components/architect/features/types";
import { BuilderIcon } from "./icons";

/**
 * The PACKAGING chat — the column docked beside the Test preview.
 *
 * One job: the pages that SELL the product — sell page, pricing, FAQ,
 * privacy, terms. The architect describes them in a sentence and the
 * Product Architect (product-chat endpoint) writes them.
 *
 * History note: this used to be the Design Brain chat with a second "Style"
 * mode that turned design dials (design-chat endpoint). The Smart Designer
 * replaced that whole job — the working interface is now generated from the
 * orchestration and fixed by talking to the Smart Designer — so Style mode
 * and the old Design Brain identity were removed. The design settings engine
 * itself (design.ts dials, width, layout) still lives and is still consumed
 * by the preview and the manage routes.
 */

/**
 * Packaging asks for whole pages, so the examples are briefs, not dials.
 * Each one names what the page is for — what the Product Architect needs
 * before it can write pages worth selling.
 */
const SUGGESTIONS = [
  "A sell page with pricing and an FAQ",
  "Add privacy and terms pages",
  "A contact page"
] as const;

const FALLBACK_REPLY =
  "I couldn't build that one. Say in a sentence what the page should do, and I'll try again.";
/** The packaging endpoint accepts a longer brief than a styling instruction did. */
const MAX_INSTRUCTION_LENGTH = 800;
const MAX_HISTORY_TURNS = 10;

type ChatBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The Product Architect changed the saved product with this reply. */
  applied?: boolean;
  /** Local fallback line (send failed) — never sent back as history. */
  local?: boolean;
};

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `design-brain-message-${messageCounter}`;
}

export function DesignBrainChat({
  workflowId,
  onApplied
}: {
  /** Saved workflow id — null while a brand-new agent has not autosaved yet. */
  workflowId: string | null;
  /**
   * Called after a build lands so the Test preview refetches the page.
   * Backward compatible: zero-argument callbacks keep working unchanged.
   */
  onApplied?: (result: { graphChanged?: boolean }) => void;
}) {
  /** Testid prefix — kept as "design-dock" so existing test ids stay stable. */
  const t = "design-dock";

  const [messages, setMessages] = useState<ChatBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest bubble in view as the conversation grows.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending]);

  const ready = Boolean(workflowId) && !sending;

  async function send(instruction: string) {
    const trimmed = instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH);
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
          content: FALLBACK_REPLY,
          local: true
        }
      ]);

    try {
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
    } catch {
      failed();
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3">
      {workflowId ? null : (
        <p
          className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
          data-testid={`${t}-save-first`}
        >
          Your agent is still saving — one moment and we can start on your pages.
        </p>
      )}

      {messages.length === 0 ? (
        <div data-testid={`${t}-empty`} className="min-h-0 flex-1">
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((suggestion, index) => (
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
          className="mb-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
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
          placeholder="e.g. a sell page with pricing and an FAQ"
          maxLength={MAX_INSTRUCTION_LENGTH}
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
    </div>
  );
}
