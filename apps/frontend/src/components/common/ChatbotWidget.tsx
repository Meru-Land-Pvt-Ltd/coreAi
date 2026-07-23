"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { marked } from "marked";
import { CircleUser } from "lucide-react";
import { apiPost } from "@/lib/api";
import { submitContactSubmission } from "@/lib/contact-api";
import { PRIVACY_PATH } from "@/lib/routes";

const ASSISTANT_ICON_SRC = "/assistant_icon.png";
const CHATBOT_FAB_SRC = "/chatbot_icon.svg";
const BUSINESS_SIGNUP_PATH = "/business/signup" as Route;
const CONTACT_CHIP = "Contact";
const SIGNUP_CHIP = "Sign up";
const NOT_SATISFIED_CHIP = "Not satisfied";
const CONTACT_SUCCESS_MESSAGE =
  "We have logged your message. Our team will reach out to you shortly.";
const CONTACT_CANCEL_MESSAGE =
  "I didn’t receive any details from you. Ask another question anytime, or open Contact again when you’re ready.";
const CHATBOT_CONTACT_SUBJECT = "Chatbot Contact Request" as const;
const MESSAGE_MAX_LENGTH = 200;

/** Short UI labels → full queries the backend chatbot engine understands. */
const CHIP_QUERY_MAP: Record<string, string> = {
  Agents: "Show all agents",
  Pricing: "How does pricing work?",
  "Monthly cost": "Estimate my monthly cost",
  "Get started": "How do I get started?",
  "Free trial": "Do you offer a free trial?",
  "What is Triven?": "What is Triven?",
  "Show all agents": "Show all agents",
  "How does pricing work?": "How does pricing work?",
  "Estimate my monthly cost": "Estimate my monthly cost",
  "How do I get started?": "How do I get started?",
  "Do you offer a free trial?": "Do you offer a free trial?",
  "How does it work?": "How does it work?",
  "What are the fees?": "How does pricing work?",
  "What are the execution fees?": "What counts as an execution?",
  "What counts as an execution?": "What counts as an execution?"
};

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
  awaitingInput?:
    | "calculator_usage"
    | "calculator_agent"
    | "fallback_email"
    | "fallback_phone"
    | "fallback_feedback"
    | "general_feedback"
    | null;
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

type ContactFormState = {
  email: string;
  phone: string;
  message: string;
};

type ContactFormErrors = Partial<Record<keyof ContactFormState, string>>;

const emptyContactForm: ContactFormState = {
  email: "",
  phone: "",
  message: ""
};

const DEFAULT_SUGGESTIONS = [
  "What is Triven?",
  "Show all agents",
  "How does pricing work?",
  "Estimate my monthly cost"
];

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isContactFallbackAwaiting(value: ChatbotContext["awaitingInput"]) {
  return (
    value === "fallback_email" ||
    value === "fallback_phone" ||
    value === "fallback_feedback" ||
    value === "general_feedback"
  );
}

function shortenSuggestion(label: string) {
  const reverse: Record<string, string> = {
    "Show all agents": "Agents",
    "How does pricing work?": "Pricing",
    "Estimate my monthly cost": "Monthly cost",
    "How do I get started?": "Get started",
    "Do you offer a free trial?": "Free trial",
    "What are the fees?": "Pricing",
    "Estimate pricing": "Monthly cost",
    "What counts as an execution?": "Executions",
    "What are the execution fees?": "Executions"
  };
  return reverse[label] ?? (label.length > 22 ? `${label.slice(0, 20)}…` : label);
}

function resolveChipQuery(label: string) {
  return CHIP_QUERY_MAP[label] ?? label;
}

function AssistantAvatar({ className = "" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={ASSISTANT_ICON_SRC} alt="" className={className} draggable={false} />
  );
}

function formatDayLabel(date: Date) {
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  const time = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }).toLowerCase();
  return sameDay ? `Today, ${time}` : `${date.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

function isValidEmail(value: string) {
  return /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/.test(
    value
  );
}

function isValidPhone(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return false;
  return /^[+]?[\d\s().-]{10,20}$/.test(value.trim());
}

function nameFromEmail(email: string) {
  const local = email.split("@")[0]?.trim() || "Visitor";
  return local
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 80);
}

function renderMarkdown(text: string) {
  try {
    const html = marked.parse(text, { breaks: true, gfm: true }) as string;
    return { __html: html };
  } catch {
    return { __html: text };
  }
}

export function ChatbotWidget({ style }: { style?: React.CSSProperties }) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "initial-msg",
      sender: "bot",
      text: "Hi! Welcome to Triven. I can tell you about our AI agent marketplace, explain how pricing works, compare agents, or estimate your monthly cost. What would you like to know?",
      timestamp: new Date(),
      suggestions: DEFAULT_SUGGESTIONS
    }
  ]);
  const [input] = useState("");
  const [context, setContext] = useState<ChatbotContext>({});
  const [isLoading, setIsLoading] = useState(false);
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactForm, setContactForm] = useState<ContactFormState>(emptyContactForm);
  const [contactErrors, setContactErrors] = useState<ContactFormErrors>({});
  const [contactTouched, setContactTouched] = useState<Partial<Record<keyof ContactFormState, boolean>>>({});
  const [contactSubmitting, setContactSubmitting] = useState(false);
  const [contactSubmitError, setContactSubmitError] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const dayLabel = useMemo(() => formatDayLabel(messages[0]?.timestamp ?? new Date()), [messages]);
  const lastBot = [...messages].reverse().find((m) => m.sender === "bot");
  const topicSuggestions = (lastBot?.suggestions ?? []).filter(
    (s) => s !== CONTACT_CHIP && s !== SIGNUP_CHIP && s !== NOT_SATISFIED_CHIP
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, showContactForm]);

  function openContactForm(reason: "contact" | "not_satisfied") {
    if (showContactForm || isLoading) return;

    setShowContactForm(true);
    setContactSubmitError("");
    setContactErrors({});
    setContactTouched({});
    setContactForm(emptyContactForm);

    const userLabel = reason === "not_satisfied" ? NOT_SATISFIED_CHIP : CONTACT_CHIP;

    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last?.sender === "user" && last.text === userLabel) return prev;
      return [
        ...prev,
        {
          id: `user-${Date.now()}`,
          sender: "user",
          text: userLabel,
          timestamp: new Date()
        }
      ];
    });
  }

  function cancelContactForm() {
    setShowContactForm(false);
    setContactForm(emptyContactForm);
    setContactErrors({});
    setContactTouched({});
    setContactSubmitError("");
    setContext({});
    setMessages((prev) => [
      ...prev,
      {
        id: `bot-contact-cancel-${Date.now()}`,
        sender: "bot",
        text: CONTACT_CANCEL_MESSAGE,
        timestamp: new Date(),
        suggestions: DEFAULT_SUGGESTIONS
      }
    ]);
  }

  function getFieldError(field: keyof ContactFormState, value: string): string | undefined {
    const trimmed = value.trim();
    if (field === "email") {
      if (!trimmed) return "Email is required.";
      if (!isValidEmail(trimmed)) return "Enter a valid email address.";
      return undefined;
    }
    if (field === "phone") {
      if (!trimmed) return "Phone number is required.";
      if (!isValidPhone(trimmed)) return "Enter a valid phone number (10–15 digits).";
      return undefined;
    }
    if (!trimmed) return "Message is required.";
    if (trimmed.length > MESSAGE_MAX_LENGTH) {
      return `Message must be ${MESSAGE_MAX_LENGTH} characters or less.`;
    }
    return undefined;
  }

  function updateContactField(field: keyof ContactFormState, value: string) {
    const nextValue = field === "message" ? value.slice(0, MESSAGE_MAX_LENGTH) : value;
    setContactForm((current) => ({ ...current, [field]: nextValue }));
    setContactErrors((current) => {
      if (!contactTouched[field]) return current;
      const error = getFieldError(field, nextValue);
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }

  function touchContactField(field: keyof ContactFormState) {
    setContactTouched((current) => ({ ...current, [field]: true }));
    setContactErrors((current) => {
      const error = getFieldError(field, contactForm[field]);
      const next = { ...current };
      if (error) next[field] = error;
      else delete next[field];
      return next;
    });
  }

  function validateContactForm() {
    const nextErrors: ContactFormErrors = {};
    const emailError = getFieldError("email", contactForm.email);
    const phoneError = getFieldError("phone", contactForm.phone);
    const messageError = getFieldError("message", contactForm.message);
    if (emailError) nextErrors.email = emailError;
    if (phoneError) nextErrors.phone = phoneError;
    if (messageError) nextErrors.message = messageError;
    setContactTouched({ email: true, phone: true, message: true });
    setContactErrors(nextErrors);
    return !emailError && !phoneError && !messageError;
  }

  const contactFormValid =
    !getFieldError("email", contactForm.email) &&
    !getFieldError("phone", contactForm.phone) &&
    !getFieldError("message", contactForm.message);

  async function handleContactSubmit(event: FormEvent) {
    event.preventDefault();
    if (contactSubmitting) return;
    if (!validateContactForm()) return;

    setContactSubmitting(true);
    setContactSubmitError("");

    const email = contactForm.email.trim();
    const phone = contactForm.phone.trim();
    const message = contactForm.message.trim();

    const result = await submitContactSubmission({
      name: `${nameFromEmail(email)} (Phone: ${phone})`,
      email,
      subject: CHATBOT_CONTACT_SUBJECT,
      message: `Source: Chatbot\nPhone: ${phone}\n\n${message}`
    });

    setContactSubmitting(false);

    if (!result.success) {
      setContactSubmitError(result.error ?? "Could not send your message. Please try again.");
      return;
    }

    setShowContactForm(false);
    setContactForm(emptyContactForm);
    setContactTouched({});
    setContactErrors({});
    setContext({});
    setMessages((prev) => [
      ...prev,
      {
        id: `bot-contact-success-${Date.now()}`,
        sender: "bot",
        text: CONTACT_SUCCESS_MESSAGE,
        timestamp: new Date(),
        suggestions: DEFAULT_SUGGESTIONS
      }
    ]);
  }

  async function handleSendMessage(textToSend: string) {
    const trimmed = textToSend.trim();
    if (!trimmed || isLoading || showContactForm) return;

    const apiQuery = resolveChipQuery(trimmed);

    setMessages((prev) => [
      ...prev,
      {
        id: `user-${Date.now()}`,
        sender: "user",
        text: trimmed,
        timestamp: new Date()
      }
    ]);
    setIsLoading(true);

    // Keep a short thinking delay so replies feel conversational.
    const thinkingMs = 400 + Math.floor(Math.random() * 500);
    const [result] = await Promise.all([
      apiPost<ChatbotApiResponse>("/chatbot/message", {
        message: apiQuery,
        context
      }),
      sleep(thinkingMs)
    ]);

    if (!result.success || !result.data) {
      setMessages((prev) => [
        ...prev,
        {
          id: `bot-${Date.now()}`,
          sender: "bot",
          text:
            "I couldn’t reach the assistant just now. Try again, or tap Contact and leave your details for our team.",
          timestamp: new Date(),
          suggestions: DEFAULT_SUGGESTIONS
        }
      ]);
      setIsLoading(false);
      return;
    }

    const nextContext = result.data.context ?? {};
    const suggestions =
      result.data.suggestions?.length > 0 ? result.data.suggestions : DEFAULT_SUGGESTIONS;

    setContext(nextContext);
    setMessages((prev) => [
      ...prev,
      {
        id: `bot-${Date.now()}`,
        sender: "bot",
        text: result.data!.reply,
        timestamp: new Date(),
        suggestions: isContactFallbackAwaiting(nextContext.awaitingInput) ? [] : suggestions
      }
    ]);

    // Backend fallback / feedback collection → use in-chat contact form (chip UI has no free text).
    if (isContactFallbackAwaiting(nextContext.awaitingInput)) {
      setContext({ ...nextContext, awaitingInput: null, fallbackQuery: apiQuery });
      setShowContactForm(true);
      setContactSubmitError("");
      setContactErrors({});
      setContactTouched({});
      setContactForm(emptyContactForm);
    }

    setIsLoading(false);
  }

  const handleSuggestionClick = (suggestion: string) => {
    if (suggestion === CONTACT_CHIP) {
      openContactForm("contact");
      return;
    }
    if (suggestion === NOT_SATISFIED_CHIP) {
      openContactForm("not_satisfied");
      return;
    }
    if (suggestion === SIGNUP_CHIP) {
      window.location.assign(BUSINESS_SIGNUP_PATH);
      return;
    }
    void handleSendMessage(suggestion);
  };

  return (
    <div
      style={{
        ...style,
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
      }}
      className="fixed right-4 z-50 flex flex-col items-end antialiased sm:right-6"
    >
      {isOpen ? (
        <div
          data-testid="landing-chat-window"
          className="flex h-[min(580px,calc(100vh-6.5rem))] w-[min(100vw-2rem,360px)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-red-500  to-amber-50 text-sm text-slate-900 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] sm:w-[380px]"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 bg-amber-500 px-4 py-3.5 text-slate-950">
            <div className="flex min-w-0 items-center gap-3">
              <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-white/20 ring-2 ring-white/40">
                <AssistantAvatar className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold leading-tight tracking-tight">Triva</h3>
                <span className="mt-0.5 block truncate text-xs font-medium text-slate-900/70">AI Assistant</span>
              </div>
            </div>
            <button
              data-testid="landing-close-chat-button"
              type="button"
              onClick={() => setIsOpen(false)}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-900/80 transition-colors hover:bg-black/10 hover:text-slate-950"
              aria-label="Close chat"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex-1 space-y-4 overflow-y-auto bg-white px-4 py-4">
            <p className="text-center text-xs font-medium text-slate-400">{dayLabel}</p>

            {messages.map((msg) => (
              <div
                key={msg.id}
                data-testid={`chat-message-${msg.sender}`}
                className={`flex ${msg.sender === "user" ? "justify-end" : "items-end gap-2"}`}
              >
                {msg.sender === "bot" ? (
                  <div className="mb-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full bg-amber-100">
                    <AssistantAvatar className="h-full w-full object-cover" />
                  </div>
                ) : null}

                <div
                  className={`max-w-[78%] px-3.5 py-2.5 text-sm leading-6 ${
                    msg.sender === "user"
                      ? "rounded-2xl rounded-br-md bg-amber-500 font-semibold text-slate-950"
                      : "rounded-2xl rounded-bl-md bg-slate-100 font-normal text-slate-800"
                  }`}
                >
                  {msg.sender === "bot" ? (
                    <div
                      className="chatbot-md whitespace-pre-wrap [&_a]:font-semibold [&_a]:text-amber-700 [&_a]:underline [&_em]:not-italic [&_i]:not-italic [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_p]:mb-2 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4"
                      dangerouslySetInnerHTML={renderMarkdown(msg.text)}
                    />
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.text}</p>
                  )}
                </div>
              </div>
            ))}

            {showContactForm ? (
              <div className="flex items-end gap-2" data-testid="landing-chat-contact-form-wrap">
                <div className="mb-0.5 h-7 w-7 shrink-0 overflow-hidden rounded-full bg-amber-100">
                  <AssistantAvatar className="h-full w-full object-cover" />
                </div>
                <form
                  onSubmit={handleContactSubmit}
                  className="w-full max-w-[85%] space-y-2.5 rounded-2xl rounded-bl-md border border-amber-200 bg-amber-50/60 p-3"
                  data-testid="landing-chat-contact-form"
                >
                  <div>
                    <label htmlFor="chat-contact-email" className="mb-1 block text-xs font-semibold text-slate-700">
                      Email
                    </label>
                    <input
                      id="chat-contact-email"
                      data-testid="landing-chat-contact-email"
                      type="email"
                      autoComplete="email"
                      value={contactForm.email}
                      onChange={(e) => updateContactField("email", e.target.value)}
                      onBlur={() => touchContactField("email")}
                      aria-invalid={Boolean(contactErrors.email)}
                      className={`h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-800 outline-none ${
                        contactErrors.email
                          ? "border-red-400 focus:border-red-500"
                          : "border-slate-200 focus:border-amber-400"
                      }`}
                      placeholder="you@company.com"
                      disabled={contactSubmitting}
                    />
                    {contactErrors.email ? (
                      <p className="mt-1 text-xs font-medium text-red-600" data-testid="landing-chat-contact-email-error">
                        {contactErrors.email}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <label htmlFor="chat-contact-phone" className="mb-1 block text-xs font-semibold text-slate-700">
                      Phone number
                    </label>
                    <input
                      id="chat-contact-phone"
                      data-testid="landing-chat-contact-phone"
                      type="tel"
                      autoComplete="tel"
                      value={contactForm.phone}
                      onChange={(e) => updateContactField("phone", e.target.value)}
                      onBlur={() => touchContactField("phone")}
                      aria-invalid={Boolean(contactErrors.phone)}
                      className={`h-9 w-full rounded-lg border bg-white px-3 text-sm text-slate-800 outline-none ${
                        contactErrors.phone
                          ? "border-red-400 focus:border-red-500"
                          : "border-slate-200 focus:border-amber-400"
                      }`}
                      placeholder="+1 555 000 0000"
                      disabled={contactSubmitting}
                    />
                    {contactErrors.phone ? (
                      <p className="mt-1 text-xs font-medium text-red-600" data-testid="landing-chat-contact-phone-error">
                        {contactErrors.phone}
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <label htmlFor="chat-contact-message" className="block text-xs font-semibold text-slate-700">
                        Message
                      </label>
                      <span
                        className={`text-[11px] font-medium ${contactForm.message.length >= MESSAGE_MAX_LENGTH ? "text-red-600" : "text-slate-400"}`}
                        data-testid="landing-chat-contact-message-count"
                      >
                        {contactForm.message.length}/{MESSAGE_MAX_LENGTH}
                      </span>
                    </div>
                    <textarea
                      id="chat-contact-message"
                      data-testid="landing-chat-contact-message"
                      value={contactForm.message}
                      onChange={(e) => updateContactField("message", e.target.value)}
                      onBlur={() => touchContactField("message")}
                      aria-invalid={Boolean(contactErrors.message)}
                      rows={3}
                      maxLength={MESSAGE_MAX_LENGTH}
                      className={`w-full resize-none rounded-lg border bg-white px-3 py-2 text-sm text-slate-800 outline-none ${
                        contactErrors.message
                          ? "border-red-400 focus:border-red-500"
                          : "border-slate-200 focus:border-amber-400"
                      }`}
                      placeholder="How can we help?"
                      disabled={contactSubmitting}
                    />
                    {contactErrors.message ? (
                      <p className="mt-1 text-xs font-medium text-red-600" data-testid="landing-chat-contact-message-error">
                        {contactErrors.message}
                      </p>
                    ) : null}
                  </div>
                  {contactSubmitError ? (
                    <p className="text-xs font-medium text-red-600" data-testid="landing-chat-contact-error">
                      {contactSubmitError}
                    </p>
                  ) : null}
                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="submit"
                      data-testid="landing-chat-contact-submit"
                      disabled={contactSubmitting || !contactFormValid}
                      className="rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {contactSubmitting ? "Sending..." : "Send message"}
                    </button>
                    <button
                      type="button"
                      data-testid="landing-chat-contact-cancel"
                      disabled={contactSubmitting}
                      onClick={cancelContactForm}
                      className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-white disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              </div>
            ) : null}

            {!isLoading && !showContactForm && topicSuggestions.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pl-9">
                {topicSuggestions.slice(0, 4).map((suggestion, sIdx) => (
                  <button
                    key={`topic-${sIdx}`}
                    data-testid={`chat-suggestion-chip-${sIdx}`}
                    type="button"
                    disabled={isLoading}
                    onClick={() => handleSuggestionClick(suggestion)}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                  >
                    {shortenSuggestion(suggestion)}
                  </button>
                ))}
                <button
                  type="button"
                  data-testid="chat-suggestion-not-satisfied"
                  disabled={isLoading}
                  onClick={() => handleSuggestionClick(NOT_SATISFIED_CHIP)}
                  className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
                >
                  {NOT_SATISFIED_CHIP}
                </button>
              </div>
            ) : null}

            {isLoading ? (
              <div className="flex items-end gap-2" data-testid="chat-typing-indicator">
                <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-amber-100">
                  <AssistantAvatar className="h-full w-full object-cover" />
                </div>
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500 [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-amber-500" />
                </div>
              </div>
            ) : null}
            <div ref={messagesEndRef} />
          </div>

          <div className="flex flex-wrap gap-1.5 bg-white px-4 pb-2">
            <button
              type="button"
              data-testid="landing-chat-quick-contact"
              onClick={() => handleSuggestionClick(CONTACT_CHIP)}
              disabled={showContactForm || isLoading}
              className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-2 py-0.5 text-[10px] font-semibold leading-4 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CircleUser className="h-3.5 w-3.5 text-amber-300" />
              {CONTACT_CHIP}
            </button>
            <button
              type="button"
              data-testid="landing-chat-quick-signup"
              onClick={() => handleSuggestionClick(SIGNUP_CHIP)}
              className="inline-flex items-center gap-1 rounded-full bg-slate-950 px-2 py-0.5 text-sm font-semibold leading-4 text-white transition hover:bg-slate-800"
            >
              <span aria-hidden="true">👉</span>
              {SIGNUP_CHIP}
            </button>
          </div>

          <div className="bg-white px-4 pb-3">
            <form
              data-testid="landing-chat-input-form"
              onSubmit={(e) => e.preventDefault()}
              className="flex h-11 items-center gap-1 rounded-xl border-2 border-slate-200 bg-slate-50 pl-3.5 pr-1.5"
            >
              <input
                data-testid="landing-chat-input-field"
                type="text"
                value={input}
                readOnly
                placeholder="Select a suggestion to continue"
                className="h-full min-w-0 flex-1 cursor-not-allowed bg-transparent text-sm font-normal text-slate-400 placeholder:text-slate-400 outline-none"
                disabled
                aria-disabled="true"
              />
              <button
                data-testid="landing-chat-submit-button"
                type="button"
                disabled
                className="flex h-8 w-8 shrink-0 cursor-not-allowed items-center justify-center rounded-lg text-slate-300"
                aria-label="Send message"
              >
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M3.4 20.4 20.85 12.92c.76-.33.76-1.5 0-1.84L3.4 3.6A1.13 1.13 0 0 0 1.9 4.9l2.4 5.85c.12.3.38.5.7.55l8.2 1.2c.18.03.18.28 0 .3l-8.2 1.2a.9.9 0 0 0-.7.55L1.9 19.1a1.13 1.13 0 0 0 1.5 1.3Z" />
                </svg>
              </button>
            </form>
          </div>

          <div className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-center text-xs font-medium text-slate-500">
            Triven{" "}
            <Link href={PRIVACY_PATH} data-testid="landing-chat-privacy-link" className="font-semibold text-slate-700 underline underline-offset-2 hover:text-amber-700">
              Privacy Policy
            </Link>
          </div>
        </div>
      ) : (
        <button
          data-testid="landing-open-chat-button"
          type="button"
          onClick={() => setIsOpen(true)}
          className="h-14 w-14 cursor-pointer rounded-full bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 p-[2.5px] shadow-[0_12px_28px_-8px_rgba(245,158,11,0.55)] transition hover:scale-105 hover:brightness-110 active:scale-95 sm:h-16 sm:w-16"
          aria-label="Open Triven Assistant"
        >
          <span className="block h-full w-full overflow-hidden rounded-full bg-red-500">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`${CHATBOT_FAB_SRC}?v=amber`} alt="" className="h-full w-full object-cover" draggable={false} />
          </span>
        </button>
      )}
    </div>
  );
}
