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
import { Bot, Plus, RefreshCw, Send } from "lucide-react";
import { publicAgentPath } from "@/lib/routes";
import { agentPageThemeTokens } from "./design-tokens";
import {
  agentPageAccent,
  agentPageAccentForeground,
  agentPageDesign,
  type AgentPageTemplateProps,
  type DesignConfig
} from "./types";
import { RichText } from "./rich-text";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * One this-session conversation. The chat always holds at least one; the
 * history sidebar (Design Brain dial) lets visitors keep several side by side.
 * Pure client state — nothing persists across reloads.
 */
type Conversation = { id: string; messages: ChatMessage[]; sessionId: string | null };

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

/**
 * Spacing presets for the `density` dial. "cozy" is the classic layout,
 * byte-for-byte; "compact" tightens paddings/line-height and shrinks the
 * hero avatar.
 */
const DENSITY_STYLES: Record<
  DesignConfig["density"],
  {
    list: string;
    bubble: string;
    flatRow: string;
    heroIcon: string;
    heroGlyph: string;
    headline: string;
    welcome: string;
  }
> = {
  cozy: {
    list: "space-y-4 px-4 py-6 sm:px-6",
    bubble: "px-4 py-2.5 text-[15px] leading-relaxed",
    flatRow: "py-1 text-[15px] leading-relaxed",
    heroIcon: "h-14 w-14",
    heroGlyph: "h-7 w-7",
    headline: "mt-5 text-2xl",
    welcome: "mt-2 max-w-md text-base leading-relaxed"
  },
  compact: {
    list: "space-y-2.5 px-4 py-4 sm:px-6",
    bubble: "px-3.5 py-2 text-sm leading-snug",
    flatRow: "py-0.5 text-sm leading-snug",
    heroIcon: "h-11 w-11",
    heroGlyph: "h-6 w-6",
    headline: "mt-4 text-xl",
    welcome: "mt-1.5 max-w-md text-sm leading-relaxed"
  }
};

/** Sidebar label: the conversation's first user message, or a friendly stub. */
function conversationTitle(conversation: Conversation): string {
  const firstUserTurn = conversation.messages.find((message) => message.role === "user");
  if (!firstUserTurn) return "New chat";
  const text = firstUserTurn.content.trim();
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

export function ChatTemplate({ data, runtime }: AgentPageTemplateProps) {
  const accent = agentPageAccent(data);
  // Light accents flip button text/icons to dark slate so they stay legible.
  const accentText = agentPageAccentForeground(accent);
  // The Design Brain dials + their theme tokens — every visual branch below
  // reads from these, so a design change re-renders the whole face.
  const design = agentPageDesign(data);
  const tokens = agentPageThemeTokens(design.theme);
  const density = DENSITY_STYLES[design.density];
  const { listing, page } = data;
  const headline = page.headline ?? listing.name;
  const suggestedPrompts = page.suggestedPrompts
    .filter((prompt) => prompt.trim().length > 0)
    .slice(0, MAX_SUGGESTED_PROMPTS);

  // Architect previews are never rate-limited — the limit card is a
  // published-page concept and must not appear while testing a draft.
  const isPreview = runtime.mode === "preview";

  // Conversations are the single source of truth for messages + engine
  // session ids. Without the sidebar there is exactly one and the behavior
  // matches the classic single-thread chat.
  const conversationCounter = useRef(1);
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: "conversation-1", messages: [], sessionId: null }
  ]);
  const [activeConversationId, setActiveConversationId] = useState("conversation-1");
  const activeConversation =
    conversations.find((conversation) => conversation.id === activeConversationId) ??
    conversations[0];
  const messages = activeConversation.messages;

  const [draft, setDraft] = useState("");
  // The conversation currently waiting on the engine (null = idle). Replies
  // always land in the conversation that sent them, even if the visitor
  // switches away mid-turn.
  const [sendingIn, setSendingIn] = useState<string | null>(null);
  const sending = sendingIn !== null;
  const [limitReached, setLimitReached] = useState(
    !isPreview && data.limits.remainingToday <= 0
  );
  const [failed, setFailed] = useState<{ conversationId: string; text: string } | null>(null);
  const failedMessage =
    failed && failed.conversationId === activeConversationId ? failed.text : null;

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
  }, [messages, sendingIn, failed, limitReached]);

  const resetComposerHeight = () => {
    const el = composerRef.current;
    if (el) el.style.height = "auto";
  };

  const updateConversation = useCallback(
    (id: string, update: (conversation: Conversation) => Conversation) => {
      setConversations((prev) =>
        prev.map((conversation) =>
          conversation.id === id ? update(conversation) : conversation
        )
      );
    },
    []
  );

  const performSend = useCallback(
    async (
      text: string,
      priorMessages: ChatMessage[],
      conversationId: string,
      sessionId: string | null
    ) => {
      setSendingIn(conversationId);
      setFailed(null);

      const history = priorMessages
        .slice(-MAX_HISTORY_TURNS)
        .map(({ role, content }) => ({ role, content }));

      const result = await runtime.sendChat({
        message: text,
        history,
        sessionId: sessionId ?? undefined
      });

      setSendingIn(null);

      if (!("error" in result)) {
        updateConversation(conversationId, (conversation) => ({
          ...conversation,
          sessionId: result.sessionId,
          messages: [...conversation.messages, { role: "assistant", content: result.reply }]
        }));
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

      setFailed({ conversationId, text });
    },
    [runtime, isPreview, updateConversation]
  );

  const sendMessage = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text || sending || limitReached) return;
      // Sending your own message always snaps the view back to the bottom.
      stickToBottomRef.current = true;
      const conversation = activeConversation;
      const prior = conversation.messages;
      updateConversation(conversation.id, (current) => ({
        ...current,
        messages: [...current.messages, { role: "user", content: text }]
      }));
      setDraft("");
      resetComposerHeight();
      void performSend(text, prior, conversation.id, conversation.sessionId);
    },
    [activeConversation, sending, limitReached, performSend, updateConversation]
  );

  const retryLast = useCallback(() => {
    if (!failedMessage || sending) return;
    // The failed user bubble is already the last message; history is everything before it.
    void performSend(
      failedMessage,
      messages.slice(0, -1),
      activeConversationId,
      activeConversation.sessionId
    );
  }, [failedMessage, sending, messages, activeConversationId, activeConversation, performSend]);

  const startNewConversation = useCallback(() => {
    // The current chat is already fresh — starting "new" again is a no-op.
    if (activeConversation.messages.length === 0) {
      setActiveConversationId(activeConversation.id);
      return;
    }
    conversationCounter.current += 1;
    const id = `conversation-${conversationCounter.current}`;
    setConversations((prev) => [...prev, { id, messages: [], sessionId: null }]);
    setActiveConversationId(id);
    stickToBottomRef.current = true;
  }, [activeConversation]);

  const switchConversation = useCallback(
    (id: string) => {
      if (id === activeConversationId) return;
      stickToBottomRef.current = true;
      setActiveConversationId(id);
    },
    [activeConversationId]
  );

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

  // "center" keeps the composer with the hero until the first message, then
  // docks it (ChatGPT feel). "bottom" always docks (Claude feel). The limit
  // card always lives in the docked bar.
  const composerCentered =
    design.composerPosition === "center" && messages.length === 0 && !limitReached;

  // One composer form, rendered either centered in the empty state or docked
  // at the bottom — never both, so every testid stays unique.
  const composerForm = (
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
        className={`max-h-[120px] min-h-[46px] flex-1 resize-none rounded-2xl border px-4 py-2.5 text-[15px] leading-relaxed transition focus:outline-none ${tokens.placeholderClass} ${tokens.composerFocusClass}`}
        style={{
          backgroundColor: tokens.card,
          borderColor: tokens.borderStrong,
          color: tokens.ink
        }}
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
  );

  return (
    <div className="flex min-h-0 flex-1" data-testid="agent-page-chat">
      {design.showHistorySidebar ? (
        // This-session conversation list — lg+ screens only, never on mobile.
        <aside
          className="hidden w-56 flex-none flex-col border-r lg:flex"
          style={{ borderColor: tokens.border }}
          data-testid="agent-page-history-sidebar"
        >
          <div className="flex-none p-3">
            <button
              type="button"
              onClick={startNewConversation}
              data-testid="agent-page-new-chat"
              className="flex w-full items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm font-medium shadow-sm transition hover:opacity-80"
              style={{
                borderColor: tokens.borderStrong,
                backgroundColor: tokens.card,
                color: tokens.ink
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              New chat
            </button>
          </div>
          <nav
            className="min-h-0 flex-1 space-y-1 overflow-y-auto px-3 pb-3"
            aria-label="Conversations"
          >
            {conversations.map((conversation) => {
              const active = conversation.id === activeConversationId;
              return (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => switchConversation(conversation.id)}
                  aria-current={active ? "true" : undefined}
                  data-testid="agent-page-history-item"
                  className={
                    active
                      ? "block w-full truncate rounded-lg px-3 py-2 text-left text-sm font-semibold transition"
                      : "block w-full truncate rounded-lg px-3 py-2 text-left text-sm transition hover:opacity-80"
                  }
                  style={
                    active
                      ? { backgroundColor: tokens.userBubbleBg, color: tokens.ink }
                      : { color: tokens.inkMuted }
                  }
                >
                  {conversationTitle(conversation)}
                </button>
              );
            })}
          </nav>
        </aside>
      ) : null}

      <div className="flex min-h-0 flex-1 flex-col">
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
                  className={`${density.heroIcon} rounded-2xl border object-cover`}
                  style={{ borderColor: tokens.border }}
                />
              ) : (
                <span
                  className={`flex ${density.heroIcon} items-center justify-center rounded-2xl text-white`}
                  style={{ backgroundColor: accent, color: accentText }}
                >
                  <Bot className={density.heroGlyph} aria-hidden="true" />
                </span>
              )}

              <h1
                className={`${density.headline} font-bold tracking-tight`}
                style={{ color: tokens.ink }}
                data-testid="agent-page-headline"
              >
                {headline}
              </h1>

              {page.welcomeMessage ? (
                <p
                  className={density.welcome}
                  style={{ color: tokens.inkMuted }}
                  data-testid="agent-page-welcome"
                >
                  {page.welcomeMessage}
                </p>
              ) : null}

              {composerCentered ? (
                <div
                  className="mt-6 w-full max-w-xl text-left"
                  data-testid="agent-page-composer-centered"
                >
                  {composerForm}
                </div>
              ) : null}

              {suggestedPrompts.length > 0 && !limitReached ? (
                <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                  {suggestedPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      data-testid="agent-page-suggested-prompt"
                      onClick={() => sendMessage(prompt)}
                      className="rounded-xl border px-4 py-2.5 text-sm shadow-sm transition hover:opacity-80"
                      style={{
                        borderColor: tokens.borderStrong,
                        backgroundColor: tokens.card,
                        color: tokens.inkMuted
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div
              className={`mx-auto w-full max-w-3xl ${density.list}`}
              data-bubble-style={design.bubbleStyle}
            >
              {messages.map((message, index) =>
                design.bubbleStyle === "flat" ? (
                  // Flat: an editorial thread — no bubble backgrounds, just a
                  // thin left rule (accent = the visitor, hairline = the agent).
                  <div
                    key={`${index}-${message.role}`}
                    className="flex justify-start"
                    data-testid={
                      message.role === "user"
                        ? "agent-page-user-message"
                        : "agent-page-assistant-message"
                    }
                  >
                    <div
                      className={`w-full border-l-2 pl-3 ${density.flatRow}${
                        message.role === "user" ? " whitespace-pre-wrap" : ""
                      }`}
                      style={{
                        borderLeftColor: message.role === "user" ? accent : tokens.borderStrong,
                        color: tokens.ink
                      }}
                    >
                      {message.role === "assistant" ? (
                        <RichText text={message.content} reveal />
                      ) : (
                        message.content
                      )}
                    </div>
                  </div>
                ) : (
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
                          ? `max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md ${density.bubble}`
                          : `max-w-[85%] rounded-2xl rounded-bl-md border ${density.bubble} shadow-sm`
                      }
                      style={
                        message.role === "user"
                          ? { backgroundColor: tokens.userBubbleBg, color: tokens.ink }
                          : {
                              backgroundColor: tokens.card,
                              borderColor: tokens.border,
                              color: tokens.ink
                            }
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
                )
              )}

              {sendingIn === activeConversationId ? (
                <div className="flex justify-start" data-testid="agent-page-typing">
                  {design.bubbleStyle === "flat" ? (
                    <div
                      className="flex w-full items-center gap-1.5 border-l-2 py-2 pl-3"
                      style={{ borderLeftColor: tokens.borderStrong }}
                    >
                      <span className="sr-only">The agent is replying</span>
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          aria-hidden="true"
                          className="h-1.5 w-1.5 animate-bounce rounded-full motion-reduce:animate-none"
                          style={{ animationDelay: `${delay}ms`, backgroundColor: tokens.typingDot }}
                        />
                      ))}
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-1.5 rounded-2xl rounded-bl-md border px-4 py-3.5 shadow-sm"
                      style={{ backgroundColor: tokens.card, borderColor: tokens.border }}
                    >
                      <span className="sr-only">The agent is replying</span>
                      {[0, 150, 300].map((delay) => (
                        <span
                          key={delay}
                          aria-hidden="true"
                          className="h-1.5 w-1.5 animate-bounce rounded-full motion-reduce:animate-none"
                          style={{ animationDelay: `${delay}ms`, backgroundColor: tokens.typingDot }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              ) : null}

              {failedMessage && !sending ? (
                <div className="flex justify-start" data-testid="agent-page-error">
                  <div
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border px-4 py-2.5 text-sm leading-relaxed"
                    style={{
                      borderColor: tokens.errorBorder,
                      backgroundColor: tokens.errorBg,
                      color: tokens.errorText
                    }}
                  >
                    <span>Something went wrong. Please try again.</span>
                    <button
                      type="button"
                      data-testid="agent-page-retry"
                      onClick={retryLast}
                      className="inline-flex items-center gap-1 font-semibold underline transition hover:opacity-80"
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

        {composerCentered ? null : (
          <div
            className="flex-none border-t px-4 py-3 sm:px-6"
            style={{ borderColor: tokens.border, backgroundColor: tokens.ground }}
          >
            <div className="mx-auto w-full max-w-3xl">
              {limitReached ? (
                <div
                  className="rounded-2xl border p-6 text-center shadow-sm"
                  style={{ backgroundColor: tokens.card, borderColor: tokens.border }}
                  data-testid="agent-page-limit-card"
                >
                  <p className="text-base font-semibold" style={{ color: tokens.ink }}>
                    This agent&apos;s free preview is done for today
                  </p>
                  <p
                    className="mt-1.5 text-sm leading-relaxed"
                    style={{ color: tokens.inkMuted }}
                  >
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
                composerForm
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
