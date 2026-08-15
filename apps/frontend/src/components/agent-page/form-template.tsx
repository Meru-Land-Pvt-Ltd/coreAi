"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Check, Copy, Paperclip, RefreshCw } from "lucide-react";
import { apiPost } from "@/lib/api";
import { publicAgentPath } from "@/lib/routes";
import { agentPageAccent, agentPageAccentForeground, type AgentPageTemplateProps } from "./types";

/**
 * Form template — one clean "What do you need?" card that submits to
 * POST /agent-pages/:slug/run and renders the result as readable prose
 * with copy-to-clipboard and attachment links.
 */

type RunResponse = {
  output: { text: string | null; mediaUrls: string[] };
  remainingToday: number;
};

type FormResult = {
  text: string | null;
  mediaUrls: string[];
};

/** The backend accepts prompts up to this length. */
const MAX_PROMPT_LENGTH = 4000;
const COPY_FEEDBACK_MS = 2000;
const SKELETON_LINE_WIDTHS = ["w-3/4", "w-full", "w-5/6", "w-2/3"];

function attachmentLabel(url: string, index: number): string {
  if (url.startsWith("data:")) return `Attachment ${index + 1}`;
  try {
    const fileName = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    if (fileName && fileName.length <= 48) return fileName;
  } catch {
    // not a parseable URL — fall through to the generic label
  }
  return `Attachment ${index + 1}`;
}

export function FormTemplate({ data, slug }: AgentPageTemplateProps) {
  const accent = agentPageAccent(data);
  // Light accents flip button text to dark slate so it stays legible.
  const accentText = agentPageAccentForeground(accent);
  const { listing, page } = data;
  const headline = page.headline ?? listing.name;

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<FormResult | null>(null);
  const [limitReached, setLimitReached] = useState(data.limits.remainingToday <= 0);
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function performSubmit(prompt: string) {
    setSubmitting(true);
    setFailedPrompt(null);
    setCopied(false);

    const response = await apiPost<RunResponse>(`/agent-pages/${slug}/run`, { prompt });

    setSubmitting(false);

    const payload = response.success ? response.data : undefined;
    if (payload) {
      setResult({ text: payload.output.text, mediaUrls: payload.output.mediaUrls });
      if (payload.remainingToday <= 0) setLimitReached(true);
      return;
    }

    if (response.code === "PAGE_LIMIT_REACHED" || response.status === 429) {
      setLimitReached(true);
      return;
    }

    setFailedPrompt(prompt);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const prompt = draft.trim().slice(0, MAX_PROMPT_LENGTH);
    if (!prompt || submitting || limitReached) return;
    void performSubmit(prompt);
  };

  async function copyResultText() {
    const text = result?.text;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPY_FEEDBACK_MS);
    } catch {
      // clipboard unavailable — the text stays selectable on the page
    }
  }

  const paragraphs = (result?.text ?? "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-page-form">
      <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="text-center">
          <h1
            className="text-2xl font-bold tracking-tight text-slate-900"
            data-testid="agent-page-headline"
          >
            {headline}
          </h1>
          {listing.tagline ? (
            <p className="mt-2 text-base leading-relaxed text-slate-600">{listing.tagline}</p>
          ) : null}
        </div>

        {limitReached ? (
          <div
            className="mt-8 rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm"
            data-testid="agent-page-limit-card"
          >
            <p className="text-base font-semibold text-slate-900">
              This agent&apos;s free preview is done for today
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-slate-600">
              Get {listing.name} to keep going — no daily limits.
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
            onSubmit={handleSubmit}
            className="mt-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8"
            data-testid="agent-page-form-card"
          >
            <label
              htmlFor="agent-page-form-input"
              className="block text-base font-semibold text-slate-900"
            >
              What do you need?
            </label>
            {page.welcomeMessage ? (
              <p
                className="mt-1 text-sm leading-relaxed text-slate-500"
                data-testid="agent-page-form-helper"
              >
                {page.welcomeMessage}
              </p>
            ) : null}

            <textarea
              id="agent-page-form-input"
              rows={5}
              value={draft}
              maxLength={MAX_PROMPT_LENGTH}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={`Tell ${listing.name} what you need`}
              data-testid="agent-page-form-input"
              className="mt-4 w-full resize-y rounded-xl border border-gray-200 bg-white px-4 py-3 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100"
            />

            <button
              type="submit"
              disabled={submitting || !draft.trim()}
              data-testid="agent-page-form-submit"
              className="mt-4 inline-flex w-full items-center justify-center rounded-xl px-6 py-3 text-base font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              style={{ backgroundColor: accent, color: accentText }}
            >
              {submitting ? "Working on it…" : "Submit"}
            </button>
          </form>
        )}

        {submitting ? (
          <div
            className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8"
            data-testid="agent-page-form-loading"
          >
            <div className="space-y-3">
              {SKELETON_LINE_WIDTHS.map((width) => (
                <div
                  key={width}
                  className={`h-4 animate-pulse rounded-full bg-slate-100 motion-reduce:animate-none ${width}`}
                />
              ))}
            </div>
          </div>
        ) : null}

        {failedPrompt && !submitting ? (
          <div className="mt-6" data-testid="agent-page-error">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm leading-relaxed text-red-700">
              <span>Something went wrong. Please try again.</span>
              <button
                type="button"
                data-testid="agent-page-retry"
                onClick={() => void performSubmit(failedPrompt)}
                className="inline-flex items-center gap-1 font-semibold underline transition hover:text-red-800"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {result && !submitting ? (
          <section
            className="mt-6 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8"
            data-testid="agent-page-form-result"
          >
            {result.text ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Your result
                  </p>
                  <button
                    type="button"
                    onClick={() => void copyResultText()}
                    data-testid="agent-page-form-copy"
                    className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                  >
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {copied ? "Copied" : "Copy"}
                  </button>
                </div>
                <div className="mt-4 max-w-prose space-y-4">
                  {paragraphs.map((paragraph, index) => (
                    <p
                      key={index}
                      className="whitespace-pre-line text-[15px] leading-relaxed text-slate-900"
                    >
                      {paragraph}
                    </p>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-sm leading-relaxed text-slate-600">
                All done — nothing to show for that request. Try wording it a little
                differently.
              </p>
            )}

            {result.mediaUrls.length > 0 ? (
              <div className="mt-5 flex flex-wrap gap-2">
                {result.mediaUrls.map((url, index) => (
                  // data: URIs cannot open as a page — download them instead.
                  <a
                    key={index}
                    href={url}
                    {...(url.startsWith("data:")
                      ? { download: `attachment-${index + 1}` }
                      : { target: "_blank", rel: "noopener noreferrer" })}
                    data-testid="agent-page-form-attachment"
                    className="inline-flex max-w-full items-center gap-1.5 rounded-xl border border-gray-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100"
                  >
                    <Paperclip className="h-3.5 w-3.5 flex-none text-slate-400" aria-hidden="true" />
                    <span className="truncate">{attachmentLabel(url, index)}</span>
                  </a>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}
