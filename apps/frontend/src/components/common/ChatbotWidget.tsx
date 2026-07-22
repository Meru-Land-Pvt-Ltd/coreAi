"use client";

import { useEffect, useId, useRef, useState } from "react";
import { marked } from "marked";
import { apiPost } from "@/lib/api";

interface Message {
  id: string;
  sender: "user" | "bot";
  text: string;
  timestamp: Date;
  suggestions?: string[];
}

interface ChatbotContext {
  lastIntent?: string;
  lastMentionedAgentId?: string;
  awaitingInput?: "calculator_usage" | "calculator_agent" | "fallback_email" | "fallback_phone" | "fallback_feedback" | "general_feedback" | null;
  fallbackQuery?: string;
  fallbackEmail?: string;
  fallbackPhone?: string;
  queryCount?: number;
}

interface ChatbotApiResponse {
  reply: string;
  context: ChatbotContext;
  suggestions: string[];
}

function SarahLogo({
  className = "",
  title,
  variant = "default"
}: {
  className?: string;
  title?: string;
  variant?: "default" | "fab";
}) {
  const uid = useId().replace(/:/g, "");
  const bgGlow = `bg-glow-${uid}`;
  const botBody = `bot-body-${uid}`;
  const accentGrad = `accent-grad-${uid}`;
  const visorGrad = `visor-grad-${uid}`;
  const glow = `glow-${uid}`;
  const softShadow = `soft-shadow-${uid}`;
  const isFab = variant === "fab";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={isFab ? "120 110 560 560" : "40 100 720 560"}
      className={className}
      width="100%"
      height="100%"
      role="img"
      aria-label={title ?? "Sarah AI Assistant"}
    >
      <defs>
        {isFab ? (
          <>
            <linearGradient id={botBody} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#f8fafc" />
            </linearGradient>
            <linearGradient id={accentGrad} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#fff7ed" />
            </linearGradient>
            <linearGradient id={visorGrad} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#1e293b" />
            </linearGradient>
          </>
        ) : (
          <>
            <radialGradient id={bgGlow} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#1e1b4b" />
              <stop offset="100%" stopColor="#0f172a" />
            </radialGradient>
            <linearGradient id={botBody} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f8fafc" />
              <stop offset="50%" stopColor="#e2e8f0" />
              <stop offset="100%" stopColor="#cbd5e1" />
            </linearGradient>
            <linearGradient id={accentGrad} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#f43f5e" />
              <stop offset="50%" stopColor="#ec4899" />
              <stop offset="100%" stopColor="#8b5cf6" />
            </linearGradient>
            <linearGradient id={visorGrad} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#0f172a" />
              <stop offset="100%" stopColor="#1e1b4b" />
            </linearGradient>
          </>
        )}
        <filter id={glow} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
        <filter id={softShadow} x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow
            dx="0"
            dy={isFab ? 6 : 12}
            stdDeviation={isFab ? 8 : 16}
            floodColor="#000000"
            floodOpacity={isFab ? 0.18 : 0.3}
          />
        </filter>
        {isFab ? (
          <clipPath id={`fab-clip-${uid}`}>
            <circle cx="400" cy="390" r="280" />
          </clipPath>
        ) : null}
      </defs>

      <g clipPath={isFab ? `url(#fab-clip-${uid})` : undefined}>
        {isFab ? (
          <circle cx="400" cy="390" r="280" fill="#f59e0b" />
        ) : (
          <rect x="40" y="100" width="720" height="560" fill={`url(#${bgGlow})`} rx="40" />
        )}

        {!isFab ? (
          <>
            <circle
              cx="400"
              cy="380"
              r="220"
              fill="none"
              stroke={`url(#${accentGrad})`}
              strokeWidth="3"
              opacity="0.4"
              filter={`url(#${glow})`}
            />
            <circle
              cx="400"
              cy="380"
              r="170"
              fill="none"
              stroke="#38bdf8"
              strokeWidth="1.5"
              strokeDasharray="8 12"
              opacity="0.3"
            />
          </>
        ) : (
          <circle
            cx="400"
            cy="380"
            r="210"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            opacity="0.35"
          />
        )}

        <g filter={`url(#${softShadow})`}>
          <g>
            <rect x="200" y="320" width="30" height="80" rx="15" fill={`url(#${botBody})`} />
            <rect
              x="210"
              y="340"
              width="10"
              height="40"
              rx="5"
              fill={isFab ? "#fb923c" : `url(#${accentGrad})`}
              filter={isFab ? undefined : `url(#${glow})`}
            />
            <rect x="570" y="320" width="30" height="80" rx="15" fill={`url(#${botBody})`} />
            <rect
              x="580"
              y="340"
              width="10"
              height="40"
              rx="5"
              fill={isFab ? "#fb923c" : `url(#${accentGrad})`}
              filter={isFab ? undefined : `url(#${glow})`}
            />
          </g>

          <rect x="220" y="220" width="360" height="280" rx="100" fill={`url(#${botBody})`} />

          <path
            d="M 400 220 L 400 160"
            stroke={`url(#${botBody})`}
            strokeWidth="12"
            strokeLinecap="round"
          />
          <circle
            cx="400"
            cy="150"
            r="18"
            fill={isFab ? "#ffffff" : `url(#${accentGrad})`}
            filter={isFab ? undefined : `url(#${glow})`}
          />

          <rect x="250" y="260" width="300" height="190" rx="60" fill={`url(#${visorGrad})`} />
          <rect
            x="250"
            y="260"
            width="300"
            height="190"
            rx="60"
            fill="none"
            stroke={isFab ? "#ffffff" : `url(#${accentGrad})`}
            strokeWidth="3"
            opacity={isFab ? 0.35 : 0.7}
          />

          <g filter={isFab ? undefined : `url(#${glow})`}>
            <path
              d="M 300 340 A 25 25 0 0 1 350 340"
              fill="none"
              stroke={isFab ? "#fda4af" : "#ec4899"}
              strokeWidth="12"
              strokeLinecap="round"
            />
            <circle cx="325" cy="315" r="5" fill={isFab ? "#7dd3fc" : "#38bdf8"} />
            <path
              d="M 450 340 A 25 25 0 0 1 500 340"
              fill="none"
              stroke={isFab ? "#fda4af" : "#ec4899"}
              strokeWidth="12"
              strokeLinecap="round"
            />
            <circle cx="475" cy="315" r="5" fill={isFab ? "#7dd3fc" : "#38bdf8"} />
          </g>

          <path
            d="M 360 400 C 380 390, 380 410, 400 400 C 420 390, 420 410, 440 400"
            fill="none"
            stroke={isFab ? "#7dd3fc" : "#38bdf8"}
            strokeWidth="6"
            strokeLinecap="round"
            filter={isFab ? undefined : `url(#${glow})`}
          />

          {!isFab ? (
            <>
              <circle cx="290" cy="380" r="12" fill="#f43f5e" opacity="0.3" filter={`url(#${glow})`} />
              <circle cx="510" cy="380" r="12" fill="#f43f5e" opacity="0.3" filter={`url(#${glow})`} />
            </>
          ) : null}

          <path
            d="M 280 520 C 280 480, 520 480, 520 520 L 560 620 C 560 650, 240 650, 240 620 Z"
            fill={`url(#${botBody})`}
          />

          <rect x="360" y="520" width="80" height="50" rx="25" fill={`url(#${visorGrad})`} />
          <path
            d="M 392 537 C 392 533, 408 533, 408 540 C 408 547, 392 543, 392 550 C 392 557, 408 557, 408 553"
            fill="none"
            stroke={isFab ? "#ffffff" : `url(#${accentGrad})`}
            strokeWidth="4"
            strokeLinecap="round"
            filter={isFab ? undefined : `url(#${glow})`}
          />
        </g>
      </g>
    </svg>
  );
}

export function ChatbotWidget({ style }: { style?: React.CSSProperties }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "initial-msg",
      sender: "bot",
      text: "Hi! Welcome to Triven AI Assistant. I can tell you about our AI agent marketplace, explain how pricing works, compare different agents, or run our monthly cost estimator. What would you like to know?",
      timestamp: new Date(),
      suggestions: ["What is Triven?", "Show all agents", "How does pricing work?", "Estimate my monthly cost"]
    }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [context, setContext] = useState<ChatbotContext>({
    lastIntent: undefined,
    lastMentionedAgentId: undefined,
    awaitingInput: null,
    fallbackQuery: undefined,
    fallbackEmail: undefined,
    fallbackPhone: undefined,
    queryCount: undefined
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const handleSendMessage = async (textToSend: string) => {
    if (!textToSend.trim() || isLoading) return;

    const userMsgId = `user-${Date.now()}`;
    const newMessages: Message[] = [
      ...messages,
      {
        id: userMsgId,
        sender: "user",
        text: textToSend,
        timestamp: new Date()
      }
    ];

    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    try {
      const response = await apiPost<ChatbotApiResponse>("/chatbot/message", {
        message: textToSend,
        context: context
      });

      if (response.success && response.data) {
        const botReply = response.data.reply;
        const nextContext = response.data.context;
        const nextSuggestions = response.data.suggestions;

        setContext(nextContext);
        setMessages((prev) => [
          ...prev,
          {
            id: `bot-${Date.now()}`,
            sender: "bot",
            text: botReply,
            timestamp: new Date(),
            suggestions: nextSuggestions
          }
        ]);
      } else {
        throw new Error(response.error ?? "Unknown chatbot API error");
      }
    } catch (error) {
      console.error("Chatbot communication error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: "bot",
          text: "I am having trouble communicating with Triven servers. Please check your network connection or try again. You can also contact us directly at info@triven.ai.",
          timestamp: new Date(),
          suggestions: ["Retry", "What is Triven?", "How does pricing work?"]
        }
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSendMessage(input);
  };

  const renderMarkdown = (text: string) => {
    try {
      const html = marked.parse(text, { breaks: true, gfm: true }) as string;
      return { __html: html };
    } catch {
      return { __html: text };
    }
  };

  return (
    <div style={style} className="fixed right-4 z-50 flex flex-col items-end font-sans sm:right-6">
      {isOpen ? (
        <div
          data-testid="landing-chat-window"
          className="flex h-[min(560px,calc(100vh-6.5rem))] w-[min(100vw-2rem,380px)] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] sm:w-[400px]"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/5 bg-slate-900 px-4 py-3 text-white">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full ring-1 ring-white/15">
                <SarahLogo className="h-full w-full" title="Sarah" variant="fab" />
                <span className="absolute bottom-0.5 right-0.5 h-2 w-2 rounded-full border-2 border-slate-900 bg-emerald-500" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold leading-tight tracking-tight">Sarah</h3>
                <span className="block truncate text-[11px] font-medium text-slate-400">AI Assistant</span>
              </div>
            </div>
            <button
              data-testid="landing-close-chat-button"
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Close chat"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3.5 py-3.5">
            {messages.map((msg) => (
              <div
                key={msg.id}
                data-testid={`chat-message-${msg.sender}`}
                className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed shadow-sm ${
                    msg.sender === "user"
                      ? "rounded-br-md bg-amber-500 font-medium text-slate-950"
                      : "prose prose-sm prose-slate max-w-none rounded-bl-md border border-slate-100 bg-white text-slate-800"
                  }`}
                >
                  {msg.sender === "user" ? (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <div className="markdown-content" dangerouslySetInnerHTML={renderMarkdown(msg.text)} />
                  )}
                </div>
                <span className="mt-1 px-1 text-[9px] text-slate-400">
                  {msg.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>

                {msg.sender === "bot" && msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="mt-1.5 flex max-w-[92%] flex-wrap gap-1.5">
                    {msg.suggestions.map((suggestion, sIdx) => (
                      <button
                        key={`${msg.id}-sug-${sIdx}`}
                        data-testid={`chat-suggestion-chip-${sIdx}`}
                        type="button"
                        onClick={() => handleSendMessage(suggestion)}
                        className="cursor-pointer rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-800 transition hover:border-amber-300 hover:bg-amber-50"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex flex-col items-start" data-testid="chat-typing-indicator">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-slate-100 bg-white px-3.5 py-2.5 shadow-sm">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form
            data-testid="landing-chat-input-form"
            onSubmit={handleSubmit}
            className="flex shrink-0 items-center gap-2 border-t border-slate-100 bg-white px-3 py-2.5"
          >
            <input
              data-testid="landing-chat-input-field"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Sarah anything..."
              className="h-10 min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm text-slate-800 placeholder-slate-400 outline-none transition focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-200/60"
              disabled={isLoading}
            />
            <button
              data-testid="landing-chat-submit-button"
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              aria-label="Send message"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      ) : (
        <button
          data-testid="landing-open-chat-button"
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex h-14 w-14 cursor-pointer items-center justify-center overflow-hidden rounded-full bg-amber-500 shadow-[0_12px_28px_-8px_rgba(245,158,11,0.55)] ring-2 ring-white transition hover:scale-105 hover:bg-amber-400 active:scale-95 sm:h-16 sm:w-16"
          aria-label="Open Sarah AI Assistant"
        >
          <SarahLogo className="h-full w-full" title="Open Sarah AI Assistant" variant="fab" />
        </button>
      )}
    </div>
  );
}
