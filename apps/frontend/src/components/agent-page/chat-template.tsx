"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from "react";
import Link from "next/link";
import { Bot, RefreshCw, Send } from "lucide-react";
import { publicAgentPath } from "@/lib/routes";
import { agentPageAccent, agentPageAccentForeground, type AgentPageTemplateProps } from "./types";
import { RichText } from "./rich-text";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * Touch keyboards have no Shift — Enter must insert a newline there and only
 * send on devices with a fine pointer (ChatGPT-style behavior).
 */
function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/** The backend accepts at most this many prior turns per request. */
const MAX_HISTORY_TURNS = 20;
/** Composer grows with the draft up to ~4 lines, then scrolls internally. */
const MAX_COMPOSER_HEIGHT_PX = 120;
const MAX_SUGGESTED_PROMPTS = 4;

export function ChatTemplate({ data, runtime }: AgentPageTemplateProps) {
  const accent = agentPageAccent(data);
  // Light accents flip button text/icons to dark slate so they stay legible.
  const accentText = agentPageAccentForeground(accent);
  const { listing, page } = data;
  const headline = page.headline ?? listing.name;
  const suggestedPrompts = page.suggestedPrompts
    .filter((prompt) => prompt.trim().length > 0)
    .slice(0, MAX_SUGGESTED_PROMPTS);

  // Architect previews are never rate-limited — the limit card is a
  // published-page concept and must not appear while testing a draft.
  const isPreview = runtime.mode === "preview";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [limitReached, setLimitReached] = useState(
    !isPreview && data.limits.remainingToday <= 0
  );
  const [failedMessage, setFailedMessage] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  // Only auto-scroll while the visitor is already at the bottom — never yank
  // someone who scrolled up to reread when a reply lands.
  const stickToBottomRef = useRef(true);

  const handleTranscriptScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  // Keep the newest message in view. Instant scroll — no motion to reduce.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending, failedMessage, limitReached]);

  const resetComposerHeight = () => {
    const el = composerRef.current;
    if (el) el.style.height = "auto";
  };

  const performSend = useCallback(
    async (text: string, priorMessages: ChatMessage[]) => {
      setSending(true);
      setFailedMessage(null);

      const history = priorMessages
        .slice(-MAX_HISTORY_TURNS)
        .map(({ role, content }) => ({ role, content }));

      const result = await runtime.sendChat({
        message: text,
        history,
        sessionId: sessionIdRef.current ?? undefined
      });

      setSending(false);

      if (!("error" in result)) {
        sessionIdRef.current = result.sessionId;
        setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
        if (!isPreview && typeof result.remainingToday === "number" && result.remainingToday <= 0)
          setLimitReached(true);
        return;
      }

      // Both limit codes count — before the runtime refactor any HTTP 429
      // raised the limit card, whichever limiter produced it.
      if (
        !isPreview &&
        (result.code === "PAGE_LIMIT_REACHED" || result.code === "DEMO_LIMIT_REACHED")
      ) {
        setLimitReached(true);
        return;
      }

      setFailedMessage(text);
    },
    [runtime, isPreview]
  );

  const sendMessage = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text || sending || limitReached) return;
      // Sending your own message always snaps the view back to the bottom.
      stickToBottomRef.current = true;
      const prior = messages;
      setMessages([...prior, { role: "user", content: text }]);
      setDraft("");
      resetComposerHeight();
      void performSend(text, prior);
    },
    [messages, sending, limitReached, performSend]
  );

  const retryLast = useCallback(() => {
    if (!failedMessage || sending) return;
    // The failed user bubble is already the last message; history is everything before it.
    void performSend(failedMessage, messages.slice(0, -1));
  }, [failedMessage, sending, messages, performSend]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    sendMessage(draft);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !isCoarsePointer()) {
      event.preventDefault();
      sendMessage(draft);
    }
  };

  const handleDraftChange = (value: string) => {
    setDraft(value);
    const el = composerRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX)}px`;
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="agent-page-chat">
      <div
        ref={scrollRef}
        onScroll={handleTranscriptScroll}
        className="min-h-0 flex-1 overflow-y-auto"
        aria-live="polite"
        data-testid="agent-page-messages"
      >
        {messages.length === 0 ? (
          <div
            className="mx-auto flex h-full w-full max-w-3xl flex-col items-center justify-center px-6 py-10 text-center"
            data-testid="agent-page-empty-state"
          >
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

            {suggestedPrompts.length > 0 && !limitReached ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    data-testid="agent-page-suggested-prompt"
                    onClick={() => sendMessage(prompt)}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm transition hover:border-gray-300 hover:bg-slate-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6 sm:px-6">
            {messages.map((message, index) => (
              <div
                key={`${index}-${message.role}`}
                className={message.role === "user" ? "flex justify-end" : "flex justify-start"}
                data-testid={
                  message.role === "user"
                    ? "agent-page-user-message"
                    : "agent-page-assistant-message"
                }
              >
                <div
                  className={
                    message.role === "user"
                      ? "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-amber-50 px-4 py-2.5 text-[15px] leading-relaxed text-slate-900"
                      : "max-w-[85%] rounded-2xl rounded-bl-md border border-gray-100 bg-white px-4 py-2.5 text-[15px] leading-relaxed text-slate-900 shadow-sm"
                  }
                >
                  {message.role === "assistant" ? (
                    // AI replies get safe markdown + a word-by-word reveal.
                    // The full reply mounts at once (opacity-only animation),
                    // so the aria-live transcript announces it exactly once,
                    // complete. The customer's own words stay plain text.
                    <RichText text={message.content} reveal />
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))}

            {sending ? (
              <div className="flex justify-start" data-testid="agent-page-typing">
                <div className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border border-gray-100 bg-white px-4 py-3.5 shadow-sm">
                  <span className="sr-only">The agent is replying</span>
                  {[0, 150, 300].map((delay) => (
                    <span
                      key={delay}
                      aria-hidden="true"
                      className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 motion-reduce:animate-none"
                      style={{ animationDelay: `${delay}ms` }}
                    />
                  ))}
                </div>
              </div>
            ) : null}

            {failedMessage && !sending ? (
              <div className="flex justify-start" data-testid="agent-page-error">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm leading-relaxed text-red-700">
                  <span>Something went wrong. Please try again.</span>
                  <button
                    type="button"
                    data-testid="agent-page-retry"
                    onClick={retryLast}
                    className="inline-flex items-center gap-1 font-semibold underline transition hover:text-red-800"
                  >
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                    Try again
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex-none border-t border-gray-100 bg-white px-4 py-3 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {limitReached ? (
            <div
              className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm"
              data-testid="agent-page-limit-card"
            >
              <p className="text-base font-semibold text-slate-900">
                This agent&apos;s free preview is done for today
              </p>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
                Get {listing.name} to keep the conversation going — no daily limits.
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
          ) : (
            <form
              className="flex items-end gap-2"
              onSubmit={handleSubmit}
              data-testid="agent-page-composer-form"
            >
              <textarea
                ref={composerRef}
                rows={1}
                value={draft}
                onChange={(event) => handleDraftChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={`Message ${listing.name}`}
                aria-label={`Message ${listing.name}`}
                data-testid="agent-page-composer"
                className="max-h-[120px] min-h-[46px] flex-1 resize-none rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100"
              />
              <button
                type="submit"
                data-testid="agent-page-send"
                disabled={sending || !draft.trim()}
                aria-label="Send message"
                className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                style={{ backgroundColor: accent, color: accentText }}
              >
                <Send className="h-5 w-5" aria-hidden="true" />
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
