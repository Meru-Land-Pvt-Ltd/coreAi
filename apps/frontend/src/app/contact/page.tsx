"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";
import { BUSINESS_MARKETPLACE_PUBLIC_PATH } from "@/lib/routes";

type SearchType = "faq" | "category" | "article";

type SearchItem = {
  type: SearchType;
  id: string;
  title: string;
  category: string;
  preview: string;
  keywords: string[];
};

type CategoryCard = {
  id: string;
  name: string;
  description: string;
  count: string;
  icon: "rocket" | "settings" | "card" | "tool" | "shield" | "code";
  iconClass: string;
};

type FaqItem = {
  id: string;
  question: string;
  answer: string;
};

const categories: CategoryCard[] = [
  {
    id: "getting-started",
    name: "Getting Started",
    description: "Set up your account, install your first agent, and connect your phone.",
    count: "8 articles",
    icon: "rocket",
    iconClass: "bg-amber-50 text-amber-600 group-hover:bg-amber-100"
  },
  {
    id: "managing-agents",
    name: "Managing Your Agents",
    description: "Pause, configure, update messages, change hours, and monitor performance.",
    count: "12 articles",
    icon: "settings",
    iconClass: "bg-violet-50 text-violet-600 group-hover:bg-violet-100"
  },
  {
    id: "billing-payments",
    name: "Billing & Payments",
    description: "Understand your charges, download invoices, update payment method, cancel.",
    count: "9 articles",
    icon: "card",
    iconClass: "bg-green-50 text-green-600 group-hover:bg-green-100"
  },
  {
    id: "troubleshooting",
    name: "Troubleshooting",
    description: "Agent not responding? Messages not sending? Fix common issues here.",
    count: "11 articles",
    icon: "tool",
    iconClass: "bg-orange-50 text-orange-600 group-hover:bg-orange-100"
  },
  {
    id: "account-security",
    name: "Account & Security",
    description: "Change password, update email, manage team access, data privacy.",
    count: "7 articles",
    icon: "shield",
    iconClass: "bg-blue-50 text-blue-600 group-hover:bg-blue-100"
  },
  {
    id: "for-architects",
    name: "For Architects",
    description: "Building agents, publishing, payouts, API docs, and marketplace tips.",
    count: "15 articles",
    icon: "code",
    iconClass: "bg-teal-50 text-teal-600 group-hover:bg-teal-100"
  }
];

const faqs: FaqItem[] = [
  {
    id: "faq-1",
    question: "How do I change my agent's text message?",
    answer:
      "Go to your Dashboard → click the gear icon on your agent → select Configure → edit the message in the text field → click Save. Changes take effect immediately for all future missed calls."
  },
  {
    id: "faq-2",
    question: "How do I pause my agent temporarily?",
    answer:
      "From your Dashboard, click the gear icon on any agent and select Pause. Your agent will stop responding to missed calls until you resume it. You won't be charged execution fees while paused."
  },
  {
    id: "faq-3",
    question: "When will I be charged after my free trial?",
    answer:
      "Your 7-day free trial starts the moment you complete setup. You'll be charged the one-time agent fee on day 8. You can cancel anytime during the trial with zero charge."
  },
  {
    id: "faq-4",
    question: "My agent isn't sending text messages. What do I do?",
    answer:
      "First, check that your agent is active. Then verify your phone number is still connected under Settings → Phone. If both are fine, try the Test button on your agent. If the test works but real calls don't trigger it, contact support."
  },
  {
    id: "faq-5",
    question: "Can I use CORE with multiple phone numbers?",
    answer:
      "Yes. You can connect multiple business phone numbers and assign different agents to each one. Go to Settings → Phone Numbers → Add Number. Each number can have its own agent with different messages and hours."
  },
  {
    id: "faq-6",
    question: "How do I cancel and get a refund?",
    answer:
      "Go to Settings → Billing → Cancel Subscription. If you're within your trial, you won't be charged. If you're within 30 days of purchase, you're eligible for a full refund."
  },
  {
    id: "faq-7",
    question: "Is my patient data safe / HIPAA compliant?",
    answer:
      "CORE is designed to protect sensitive data using encryption, access controls, and secure handling practices. For healthcare use cases, review the Security page and confirm whether a BAA is required for your workflow."
  },
  {
    id: "faq-8",
    question: "How do I see how much revenue my agent has recovered?",
    answer:
      "Your Dashboard shows real-time metrics including calls handled, appointments booked, and estimated revenue recovered. For detailed analytics, click View Stats on any agent."
  }
];

const popularSearches = [
  "How to pause an agent",
  "Change my phone number",
  "Billing & invoices",
  "Cancel subscription",
  "Agent not responding"
];

const searchIndex: SearchItem[] = [
  {
    type: "faq",
    id: "faq-1",
    title: "How do I change my agent's text message?",
    category: "Managing Your Agents",
    preview: "Dashboard → gear icon → Configure → edit the message → Save. Changes apply immediately.",
    keywords: ["change", "edit", "message", "text", "sms", "configure", "wording", "reply", "auto"]
  },
  {
    type: "faq",
    id: "faq-2",
    title: "How do I pause my agent temporarily?",
    category: "Managing Your Agents",
    preview: "Click the gear icon on any agent and select Pause. No execution fees while paused.",
    keywords: ["pause", "stop", "temporarily", "resume", "disable", "turn off", "deactivate"]
  },
  {
    type: "faq",
    id: "faq-3",
    title: "When will I be charged after my free trial?",
    category: "Billing & Payments",
    preview: "Your 7-day trial starts at setup; the one-time agent fee is charged on day 8.",
    keywords: ["charge", "charged", "trial", "free", "billing", "payment", "when", "fee"]
  },
  {
    type: "faq",
    id: "faq-4",
    title: "My agent isn't sending text messages. What do I do?",
    category: "Troubleshooting",
    preview: "Check the agent is active, verify your phone connection, then run the Test button.",
    keywords: ["not", "sending", "messages", "text", "broken", "responding", "fix", "carrier", "test"]
  },
  {
    type: "faq",
    id: "faq-5",
    title: "Can I use CORE with multiple phone numbers?",
    category: "Managing Your Agents",
    preview: "Yes — connect multiple numbers and assign a different agent to each.",
    keywords: ["multiple", "phone", "numbers", "many", "second", "add", "assign"]
  },
  {
    type: "faq",
    id: "faq-6",
    title: "How do I cancel and get a refund?",
    category: "Billing & Payments",
    preview: "Settings → Billing → Cancel Subscription. Full refund within 30 days of purchase.",
    keywords: ["cancel", "refund", "subscription", "money", "back", "stop", "unsubscribe"]
  },
  {
    type: "faq",
    id: "faq-7",
    title: "Is my patient data safe / HIPAA compliant?",
    category: "Account & Security",
    preview: "Learn how CORE protects patient data, encryption, privacy, and compliance workflows.",
    keywords: ["hipaa", "patient", "data", "safe", "secure", "privacy", "compliant", "encryption"]
  },
  {
    type: "faq",
    id: "faq-8",
    title: "How do I see how much revenue my agent has recovered?",
    category: "Managing Your Agents",
    preview: "The Dashboard shows calls handled, bookings, and estimated revenue recovered.",
    keywords: ["revenue", "recovered", "stats", "analytics", "metrics", "money", "report", "performance"]
  },
  {
    type: "category",
    id: "cat-getting-started",
    title: "Getting Started",
    category: "Browse topics",
    preview: "Set up your account, install your first agent, and connect your phone.",
    keywords: ["getting", "started", "setup", "install", "begin", "onboard", "account", "new"]
  },
  {
    type: "category",
    id: "cat-managing",
    title: "Managing Your Agents",
    category: "Browse topics",
    preview: "Pause, configure, update messages, change hours, and monitor performance.",
    keywords: ["manage", "agents", "configure", "settings", "control", "performance"]
  },
  {
    type: "category",
    id: "cat-billing",
    title: "Billing & Payments",
    category: "Browse topics",
    preview: "Understand your charges, download invoices, update payment method, cancel.",
    keywords: ["billing", "payments", "charges", "invoices", "money", "cost", "price"]
  },
  {
    type: "category",
    id: "cat-troubleshooting",
    title: "Troubleshooting",
    category: "Browse topics",
    preview: "Agent not responding? Messages not sending? Fix common issues here.",
    keywords: ["troubleshooting", "fix", "issues", "problem", "error", "help", "broken"]
  },
  {
    type: "category",
    id: "cat-security",
    title: "Account & Security",
    category: "Browse topics",
    preview: "Change password, update email, manage team access, data privacy.",
    keywords: ["account", "security", "password", "email", "team", "access", "privacy"]
  },
  {
    type: "category",
    id: "cat-architects",
    title: "For Architects",
    category: "Browse topics",
    preview: "Building agents, publishing, payouts, API docs, and marketplace tips.",
    keywords: ["architects", "build", "publish", "payouts", "api", "developer", "marketplace"]
  },
  {
    type: "article",
    id: "art-pause",
    title: "How to pause an agent",
    category: "Managing Your Agents",
    preview: "Step-by-step: pause and later resume any agent from your Dashboard.",
    keywords: ["pause", "stop", "resume", "temporarily", "agent"]
  },
  {
    type: "article",
    id: "art-phone-change",
    title: "Change my phone number",
    category: "Account & Security",
    preview: "Update or replace the business number connected to your agent.",
    keywords: ["change", "phone", "number", "update", "replace", "connect"]
  },
  {
    type: "article",
    id: "art-invoices",
    title: "Download invoices & receipts",
    category: "Billing & Payments",
    preview: "Find, view, and download every CORE invoice.",
    keywords: ["invoices", "invoice", "receipts", "download", "pdf", "billing", "statement"]
  },
  {
    type: "article",
    id: "art-cancel",
    title: "Cancel your subscription",
    category: "Billing & Payments",
    preview: "End your plan and check whether you qualify for a refund.",
    keywords: ["cancel", "subscription", "stop", "end", "refund", "close"]
  },
  {
    type: "article",
    id: "art-not-responding",
    title: "Agent not responding",
    category: "Troubleshooting",
    preview: "Diagnose an agent that is offline or not reacting to missed calls.",
    keywords: ["agent", "not", "responding", "offline", "down", "unresponsive", "fix"]
  }
];

const stopWords = new Set([
  "how",
  "to",
  "a",
  "an",
  "the",
  "my",
  "is",
  "are",
  "of",
  "for",
  "do",
  "does",
  "i",
  "can",
  "with",
  "and",
  "in",
  "on",
  "your",
  "you",
  "me",
  "it",
  "this",
  "that",
  "what",
  "when",
  "where",
  "will",
  "be",
  "get",
  "if"
]);

export default function HelpPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(true);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [openFaq, setOpenFaq] = useState<string | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const hash = window.location.hash.replace("#", "");
    if (hash && faqs.some((faq) => faq.id === hash)) {
      setOpenFaq(hash);
      setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
    }
  }, []);

  const results = useMemo(() => searchItems(query), [query]);
  const showResults = query.trim().length > 0;

  function showToast(message: string) {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 2400);
  }

  function selectResult(item: SearchItem) {
    setQuery("");
    setActiveIndex(-1);

    if (item.type === "faq") {
      setOpenFaq(item.id);
      window.history.replaceState(null, "", `#${item.id}`);
      setTimeout(() => document.getElementById(item.id)?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
      return;
    }

    showToast(`Opening ${item.title}…`);
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!showResults) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current + 1) % results.length : -1));
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => (results.length ? (current - 1 + results.length) % results.length : -1));
    }

    if (event.key === "Enter" && results.length) {
      event.preventDefault();
      selectResult(results[activeIndex >= 0 ? activeIndex : 0]);
    }

    if (event.key === "Escape") {
      setQuery("");
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-700 antialiased selection:bg-amber-200 selection:text-amber-900">
      <CoreHeader
        navTop={0}
        navScrolled={navScrolled}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      <main id="main">
        <span id="top" />

        <section className="relative overflow-hidden bg-gradient-to-br from-amber-50 via-white to-orange-50 px-5 pb-12 pt-36 text-center sm:px-8 md:pt-40">
          <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-amber-200/40 blur-3xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -right-20 top-10 h-64 w-64 rounded-full bg-orange-200/40 blur-3xl" />

          <div className="relative z-10 mx-auto max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200/80 bg-white/70 px-3.5 py-1.5 text-xs font-semibold text-amber-700 shadow-sm backdrop-blur">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
              </span>
              Average answer time: under 10 seconds
            </span>

            <h1 className="mt-5 text-4xl font-black tracking-tight text-slate-900 sm:text-5xl">
              How can we help?
            </h1>

            <p className="mt-3 text-lg text-slate-500">
              Search our knowledge base or browse topics below.
            </p>

            <div className="relative mx-auto mt-8 max-w-2xl text-left">
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400">
                  <SearchIcon />
                </span>

                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setActiveIndex(-1);
                  }}
                  onKeyDown={handleSearchKeyDown}
                  type="text"
                  role="combobox"
                  aria-expanded={showResults}
                  aria-controls="search-results"
                  aria-autocomplete="list"
                  aria-label="Search the help center"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Search for answers... (e.g., 'change agent message')"
                  className="w-full rounded-2xl border border-gray-200 bg-white py-4 pl-12 pr-6 text-base text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-amber-400 focus:shadow-md focus:outline-none focus:ring-2 focus:ring-amber-400 sm:pr-20"
                />

                <kbd className="absolute right-3 top-1/2 hidden -translate-y-1/2 select-none items-center gap-0.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 font-sans text-xs font-semibold text-slate-400 sm:flex">
                  ⌘K
                </kbd>
              </div>

              {showResults ? (
                <div
                  id="search-results"
                  role="listbox"
                  aria-label="Search results"
                  className="absolute left-0 right-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-xl border border-gray-100 bg-white shadow-xl shadow-slate-900/10"
                >
                  {results.length ? (
                    results.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        role="option"
                        data-testid={`help-search-result-${item.id}`}
                        onMouseEnter={() => setActiveIndex(index)}
                        onClick={() => selectResult(item)}
                        className={`flex w-full items-start gap-3 border-b border-gray-50 px-4 py-3 text-left transition-colors last:border-0 hover:bg-slate-50 ${
                          activeIndex === index ? "bg-amber-50" : ""
                        }`}
                      >
                        <span className={`mt-0.5 inline-grid h-9 w-9 shrink-0 place-items-center rounded-lg ${typeIconClass(item.type)}`}>
                          <SearchTypeIcon type={item.type} />
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold text-slate-900">
                            <HighlightedText text={item.title} query={query} />
                          </span>
                          <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-slate-400">
                            Help Center › {item.category}
                          </span>
                          <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-slate-500">
                            {item.preview}
                          </span>
                        </span>

                        <span className="mt-1 shrink-0 self-start text-slate-300">
                          <ExternalArrowIcon />
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center">
                      <div className="text-sm font-semibold text-slate-700">
                        No results for &quot;{query.trim()}&quot;
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        Try a different keyword, or scroll down to contact our team.
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <span className="self-center pr-1 text-sm font-medium text-slate-400">
                Popular:
              </span>

              {popularSearches.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  data-testid={`help-popular-search-${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  onClick={() => {
                    setQuery(tag);
                    inputRef.current?.focus();
                  }}
                  className="cursor-pointer rounded-full border border-gray-200 bg-white px-4 py-1.5 text-sm text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto mt-14 max-w-5xl px-5 sm:px-8">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {categories.map((category) => (
              <CategoryCardItem key={category.id} category={category} showToast={showToast} />
            ))}
          </div>
        </section>

        <section className="mx-auto mt-20 max-w-4xl px-5 sm:px-8">
          <div>
            <h2 className="text-center text-2xl font-bold text-slate-900">
              Frequently asked questions
            </h2>

            <p className="mt-2 text-center text-slate-500">
              Quick answers to the most common questions.
            </p>

            <div className="mt-10 divide-y divide-gray-100 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {faqs.map((faq) => {
                const open = openFaq === faq.id;

                return (
                  <div key={faq.id} id={faq.id} className="scroll-mt-28">
                    <button
                      type="button"
                      data-testid={`help-faq-toggle-${faq.id}`}
                      onClick={() => {
                        const nextOpen = open ? null : faq.id;
                        setOpenFaq(nextOpen);
                        if (nextOpen) window.history.replaceState(null, "", `#${faq.id}`);
                      }}
                      className="flex w-full items-center justify-between gap-4 px-6 py-5 text-left transition-colors hover:bg-slate-50/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-400"
                      aria-expanded={open}
                    >
                      <span className="text-base font-semibold text-slate-900">
                        {faq.question}
                      </span>

                      <ChevronIcon open={open} />
                    </button>

                    <div
                      className={`overflow-hidden transition-all duration-300 ${
                        open ? "max-h-96" : "max-h-0"
                      }`}
                    >
                      <div className="px-6 pb-5 text-sm leading-relaxed text-slate-600">
                        {faq.answer}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section id="contact" className="mt-16 bg-gray-50 py-16">
          <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
            <h2 className="text-2xl font-bold text-slate-900">Still need help?</h2>

            <p className="mt-2 text-slate-500">
              Our team typically responds within 2 hours during business hours.
            </p>

            <div className="mt-8 grid grid-cols-1 gap-5 sm:grid-cols-2">
              <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
                <span className="mx-auto inline-grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-600">
                  <MailIcon />
                </span>

                <h3 className="mt-3 text-lg font-bold text-slate-900">Email Support</h3>
                <p className="mt-1 text-sm text-slate-500">Get a response within 2 hours</p>

                <a
                  href="mailto:info@triven.ai"
                  className="mt-4 inline-flex items-center justify-center rounded-xl bg-amber-500 px-6 py-3 font-semibold text-white shadow-sm transition-colors hover:bg-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                >
                  info@triven.ai
                </a>
              </div>

              <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
                <span className="mx-auto inline-grid h-12 w-12 place-items-center rounded-full bg-green-50 text-green-600">
                  <ChatIcon />
                </span>

                <h3 className="mt-3 text-lg font-bold text-slate-900">Live Chat</h3>
                <p className="mt-1 text-sm text-slate-500">
                  Available Mon-Fri, 9am-6pm EST
                </p>

                <button
                  type="button"
                  data-testid="help-start-chat"
                  onClick={() => showToast("Starting live chat…")}
                  className="mt-4 inline-flex items-center justify-center rounded-xl border border-amber-500 px-6 py-3 font-semibold text-amber-600 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                >
                  Start a chat
                </button>
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-gray-100 bg-white py-12 text-center">
          <div className="mx-auto max-w-4xl px-5 sm:px-8">
            <h2 className="text-xl font-bold text-slate-900">Ready to get started?</h2>

            <Link
              href={BUSINESS_MARKETPLACE_PUBLIC_PATH}
              className="mt-4 inline-flex items-center justify-center rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white shadow-lg shadow-amber-500/30 transition-all hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-amber-500/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
            >
              Browse AI Agents
            </Link>
          </div>
        </section>
      </main>

      <CoreFooter />

      <div className="pointer-events-none fixed bottom-6 right-6 z-[60] flex flex-col items-end gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex max-w-xs items-center gap-2.5 rounded-xl bg-slate-900 py-2.5 pl-3.5 pr-4 text-sm font-medium text-white shadow-lg shadow-slate-900/25"
          >
            <span className="inline-grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-400 text-slate-900">
              <CheckIcon />
            </span>
            <span>{toast.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function searchItems(query: string) {
  const clean = query.trim();
  const words = tokens(clean);
  if (!words.length) return [];

  const joined = words.join(" ");

  return searchIndex
    .map((item) => {
      const title = item.title.toLowerCase();
      const keywordText = item.keywords.join(" ").toLowerCase();
      const haystack = `${item.title} ${item.category} ${item.preview} ${keywordText}`.toLowerCase();

      const matches = words.every((word) => haystack.includes(word));
      if (!matches) return null;

      let score = 0;

      if (title.includes(joined)) score += 50;
      if (title.startsWith(joined)) score += 20;

      words.forEach((word) => {
        if (title.includes(word)) score += 12;
        if (keywordText.includes(word)) score += 8;
        if (item.preview.toLowerCase().includes(word)) score += 3;
        if (item.category.toLowerCase().includes(word)) score += 4;
      });

      if (item.type === "faq") score += 3;

      return { item, score };
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .slice(0, 8)
    .map((result) => result!.item);
}

function tokens(query: string) {
  const all = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const meaningful = all.filter((word) => !stopWords.has(word));
  return meaningful.length ? meaningful : all;
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const words = tokens(query);

  if (!words.length) return text;

  const pattern = new RegExp(`(${words.map(escapeRegex).join("|")})`, "gi");
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, index) =>
        words.some((word) => word.toLowerCase() === part.toLowerCase()) ? (
          <mark key={`${part}-${index}`} className="rounded bg-amber-200 px-0.5 text-inherit">
            {part}
          </mark>
        ) : (
          <span key={`${part}-${index}`}>{part}</span>
        )
      )}
    </>
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function CategoryCardItem({
  category,
  showToast
}: {
  category: CategoryCard;
  showToast: (message: string) => void;
}) {
  return (
    <div>
      <button
        type="button"
        data-testid={`help-category-${category.id}`}
        onClick={() => showToast(`Opening ${category.name}…`)}
        className="group flex h-full w-full cursor-pointer flex-col rounded-2xl border border-gray-100 bg-white p-6 text-left shadow-sm transition-all duration-300 hover:-translate-y-1 hover:border-amber-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
      >
        <span className={`inline-grid h-12 w-12 place-items-center rounded-xl transition-colors ${category.iconClass}`}>
          <CategoryIcon name={category.icon} />
        </span>

        <h3 className="mt-4 text-lg font-bold text-slate-900">{category.name}</h3>

        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          {category.description}
        </p>

        <div className="mt-3 flex items-center gap-1.5 text-xs font-medium text-slate-400">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-300" />
          {category.count}
        </div>

        {category.id === "for-architects" ? (
          <span className="mt-2 inline-flex w-fit items-center gap-1 rounded text-xs font-semibold text-amber-600 transition-colors group-hover:text-amber-700">
            Go to Architect Docs <span aria-hidden="true">→</span>
          </span>
        ) : null}
      </button>
    </div>
  );
}

function typeIconClass(type: SearchType) {
  if (type === "faq") return "bg-amber-50 text-amber-600";
  if (type === "category") return "bg-violet-50 text-violet-600";
  return "bg-blue-50 text-blue-600";
}

function SearchTypeIcon({ type }: { type: SearchType }) {
  if (type === "faq") return <FaqIcon />;
  if (type === "category") return <LayersIcon />;
  return <ArticleIcon />;
}

function CategoryIcon({ name }: { name: CategoryCard["icon"] }) {
  if (name === "rocket") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
        <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
        <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
        <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (name === "card") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect width="20" height="14" x="2" y="5" rx="2" />
        <line x1="2" x2="22" y1="10" y2="10" />
      </svg>
    );
  }

  if (name === "tool") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
      </svg>
    );
  }

  if (name === "shield") {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function FaqIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  );
}

function LayersIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />
      <path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />
    </svg>
  );
}

function ArticleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  );
}

function ExternalArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 7h10v10" />
      <path d="M7 17 17 7" />
    </svg>
  );
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-5 w-5 shrink-0 text-slate-400 transition-transform duration-300 ${
        open ? "rotate-180" : ""
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}