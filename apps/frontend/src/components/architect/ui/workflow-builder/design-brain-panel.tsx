import { useEffect, useRef, useState } from "react";
import { designChat } from "@/components/architect/features/api";
import type { DesignChatMessage } from "@/components/architect/features/types";
import { BuilderIcon } from "./icons";

/**
 * Design Brain chat — lives inside the node properties sidebar. The architect
 * types how the page should look ("dark theme, pin the box at the bottom") and
 * the backend applies a validated design patch; the reply lands here and the
 * Test preview refreshes through onDesignApplied.
 */

const STARTER_SUGGESTIONS = [
  "Dark theme",
  "Pin the box at the bottom",
  "Make it feel warm and welcoming"
] as const;

const FALLBACK_REPLY = "That one didn't go through — give it another try in a moment.";
const MAX_INSTRUCTION_LENGTH = 500;
const MAX_HISTORY_TURNS = 10;

type PanelMessage = {
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

export function DesignBrainPanel({
  workflowId,
  previewVisible = false,
  onDesignApplied
}: {
  /** Saved workflow id — null while a brand-new agent has not autosaved yet. */
  workflowId: string | null;
  /** True while the architect is watching the Test preview. */
  previewVisible?: boolean;
  /** Called after a patch lands so the Test preview refetches the page. */
  onDesignApplied?: () => void;
}) {
  const [messages, setMessages] = useState<PanelMessage[]>([]);
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

    try {
      const result = await designChat(workflowId, {
        instruction: trimmed,
        ...(history.length ? { history } : {})
      });
      const data = result.success ? result.data : undefined;

      if (data) {
        const applied = Object.keys(data.patch ?? {}).length > 0;
        setMessages((current) => [
          ...current,
          { id: nextMessageId(), role: "assistant", content: data.reply, applied }
        ]);
        if (applied) onDesignApplied?.();
      } else {
        setMessages((current) => [
          ...current,
          { id: nextMessageId(), role: "assistant", content: FALLBACK_REPLY, local: true }
        ]);
      }
    } catch {
      setMessages((current) => [
        ...current,
        { id: nextMessageId(), role: "assistant", content: FALLBACK_REPLY, local: true }
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border-b border-gray-100 p-5" data-testid="design-brain-panel">
      <h3 className="mb-1 text-xs font-bold uppercase tracking-wider text-slate-400">
        Design Brain
      </h3>
      <p className="mb-4 text-xs leading-5 text-slate-500" data-testid="design-brain-intro">
        Tell it how your page should look and feel — it restyles everything for you.
      </p>

      {workflowId ? null : (
        <p
          className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
          data-testid="design-brain-save-first"
        >
          Your agent is still saving — one moment and we can start styling.
        </p>
      )}

      {messages.length === 0 ? (
        <div data-testid="design-brain-empty">
          <div className="flex flex-wrap gap-2">
            {STARTER_SUGGESTIONS.map((suggestion, index) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => void send(suggestion)}
                disabled={!ready}
                data-testid={`design-brain-chip-${index}`}
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100 disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={listRef}
          data-testid="design-brain-messages"
          className="mb-1 max-h-72 space-y-2 overflow-y-auto pr-1"
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p
                  data-testid="design-brain-message-user"
                  className="max-w-[85%] rounded-2xl rounded-br-md bg-rose-600 px-3 py-2 text-xs leading-5 text-white"
                >
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={message.id} className="flex flex-col items-start">
                <p
                  data-testid="design-brain-message-assistant"
                  className="max-w-[85%] rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-800"
                >
                  {message.content}
                </p>
                {message.applied && !previewVisible ? (
                  <p
                    data-testid="design-brain-applied-note"
                    className="mt-1 pl-1 text-[10px] font-semibold text-emerald-600"
                  >
                    Applied — check the Test tab
                  </p>
                ) : null}
              </div>
            )
          )}

          {sending ? (
            <div className="flex justify-start" data-testid="design-brain-typing">
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
          placeholder="e.g. dark theme with a green accent"
          maxLength={MAX_INSTRUCTION_LENGTH}
          disabled={!workflowId}
          spellCheck={false}
          data-testid="design-brain-input"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-none outline-none ring-0 transition-colors placeholder:text-slate-400 focus:border-rose-400 focus:outline-none focus:ring-0 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={!ready || !draft.trim()}
          data-testid="design-brain-send"
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-600 text-white transition hover:bg-rose-700 disabled:opacity-40"
        >
          <BuilderIcon name="arrow-right" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
