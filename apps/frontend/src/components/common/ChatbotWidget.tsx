"use client";

import { useEffect, useRef, useState } from "react";
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
  awaitingInput?: "calculator_usage" | "calculator_agent" | null;
}

interface ChatbotApiResponse {
  reply: string;
  context: ChatbotContext;
  suggestions: string[];
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
    awaitingInput: null
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
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
    } catch (e) {
      return { __html: text };
    }
  };

  return (
    <div style={style} className="fixed right-6 z-50 flex flex-col items-end gap-3 font-sans transition-all duration-300">
      {/* Chat Window */}
      {isOpen && (
        <div
          data-testid="landing-chat-window"
          className="flex h-[520px] w-[360px] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl transition-all duration-300 md:w-[400px]"
        >
          {/* Header */}
          <div className="flex items-center justify-between bg-slate-900 px-5 py-4 text-white">
            <div className="flex items-center gap-2">
              <div className="relative flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500 text-slate-950 font-black text-sm">
                T
                <span className="absolute bottom-0 right-0 h-2 w-2 rounded-full border-2 border-slate-900 bg-emerald-500" />
              </div>
              <div>
                <h3 className="text-sm font-bold leading-none">Triven Assistant</h3>
                <span className="text-[10px] text-slate-400 font-medium">Always Here to Help</span>
              </div>
            </div>
            <button
              data-testid="landing-close-chat-button"
              type="button"
              onClick={() => setIsOpen(false)}
              className="rounded-lg p-1 text-slate-400 hover:bg-white/10 hover:text-white transition-colors"
              aria-label="Close chat"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages list */}
          <div className="flex-1 overflow-y-auto bg-slate-50 p-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                data-testid={`chat-message-${msg.sender}`}
                className={`flex flex-col ${msg.sender === "user" ? "items-end" : "items-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm shadow-sm leading-relaxed ${
                    msg.sender === "user"
                      ? "bg-amber-500 text-slate-950 font-medium rounded-br-none"
                      : "bg-white text-slate-800 border border-slate-100 rounded-bl-none prose prose-sm max-w-none prose-slate"
                  }`}
                >
                  {msg.sender === "user" ? (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  ) : (
                    <div
                      className="markdown-content"
                      dangerouslySetInnerHTML={renderMarkdown(msg.text)}
                    />
                  )}
                </div>
                <span className="mt-1 text-[9px] text-slate-400 px-1">
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>

                {/* Inline Suggestions for Bot Messages */}
                {msg.sender === "bot" && msg.suggestions && msg.suggestions.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5 max-w-[90%]">
                    {msg.suggestions.map((suggestion, sIdx) => (
                      <button
                        key={`${msg.id}-sug-${sIdx}`}
                        data-testid={`chat-suggestion-chip-${sIdx}`}
                        type="button"
                        onClick={() => handleSendMessage(suggestion)}
                        className="rounded-full border border-amber-300 bg-amber-50/50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 hover:text-amber-900 cursor-pointer"
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
                <div className="flex items-center gap-1 rounded-2xl border border-slate-100 bg-white px-4 py-3 shadow-sm rounded-bl-none">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
                  <span className="h-2 w-2 animate-bounce rounded-full bg-amber-500" />
                </div>
                <span className="mt-1 text-[9px] text-slate-400 px-1">Thinking...</span>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Form Input */}
          <form
            data-testid="landing-chat-input-form"
            onSubmit={handleSubmit}
            className="flex items-center gap-2 border-t border-slate-200 bg-white p-3"
          >
            <input
              data-testid="landing-chat-input-field"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about Triven, agents, or pricing..."
              className="flex-1 rounded-xl bg-slate-50 px-4 py-2.5 text-sm text-slate-800 placeholder-slate-400 outline-slate-400 focus:outline-amber-400 focus:bg-white transition"
              disabled={isLoading}
            />
            <button
              data-testid="landing-chat-submit-button"
              type="submit"
              disabled={!input.trim() || isLoading}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-amber-500 text-slate-950 shadow-sm transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:bg-slate-150 disabled:text-slate-400"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
              </svg>
            </button>
          </form>
        </div>
      )}

      {/* Floating Toggle Button */}
      <button
        data-testid="landing-open-chat-button"
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-amber-500 text-slate-950 shadow-glow transition hover:scale-110 cursor-pointer active:scale-95"
        aria-label="Toggle chat"
      >
        {isOpen ? (
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg className="h-6 w-6 animate-pulse-ring" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>
    </div>
  );
}
