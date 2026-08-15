"use client";

import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import Link from "next/link";
import { Bot, Download, ExternalLink, RefreshCw, Sparkles } from "lucide-react";
import { publicAgentPath } from "@/lib/routes";
import { agentPageAccent, agentPageAccentForeground, type AgentPageTemplateProps } from "./types";

/**
 * Media template — a centered prompt composer that creates images or videos
 * via runtime.runOnce() and shows every creation in a feed of
 * responsive media grids (newest first). Media arrives either as http(s) URLs
 * or as data: URIs (the image engine returns inline data) — data URIs render
 * in <img>/<video> but browsers block opening them as a page, so their tile
 * action is a real download instead of open-in-new-tab.
 */

type Creation = {
  id: number;
  prompt: string;
  text: string | null;
  mediaUrls: string[];
};

/** The backend accepts prompts up to this length. */
const MAX_PROMPT_LENGTH = 4000;
const MAX_SUGGESTED_PROMPTS = 4;
const SKELETON_TILE_COUNT = 3;
const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v)([?#]|$)/i;

function isVideoUrl(url: string): boolean {
  return url.startsWith("data:video/") || VIDEO_URL_PATTERN.test(url);
}

function isDataUri(url: string): boolean {
  return url.startsWith("data:");
}

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

export function MediaTemplate({ data, runtime }: AgentPageTemplateProps) {
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

  const [draft, setDraft] = useState("");
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [creations, setCreations] = useState<Creation[]>([]);
  const [limitReached, setLimitReached] = useState(
    !isPreview && data.limits.remainingToday <= 0
  );
  const [failedPrompt, setFailedPrompt] = useState<string | null>(null);

  const creationIdRef = useRef(0);

  async function performCreate(prompt: string) {
    setPendingPrompt(prompt);
    setFailedPrompt(null);

    const result = await runtime.runOnce({ prompt });

    setPendingPrompt(null);

    if (!("error" in result)) {
      creationIdRef.current += 1;
      setCreations((prev) => [
        {
          id: creationIdRef.current,
          prompt,
          text: result.output.text,
          mediaUrls: result.output.mediaUrls
        },
        ...prev
      ]);
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

    setFailedPrompt(prompt);
  }

  function requestCreate(rawPrompt: string) {
    const prompt = rawPrompt.trim().slice(0, MAX_PROMPT_LENGTH);
    if (!prompt || pendingPrompt !== null || limitReached) return;
    setDraft("");
    void performCreate(prompt);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    requestCreate(draft);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !isCoarsePointer()) {
      event.preventDefault();
      requestCreate(draft);
    }
  };

  const creating = pendingPrompt !== null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="agent-page-media">
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-col items-center text-center">
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
              Get {listing.name} to keep creating — no daily limits.
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
          <>
            <form
              onSubmit={handleSubmit}
              data-testid="agent-page-media-composer-form"
              className="mt-8 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition focus-within:border-amber-400 focus-within:ring-4 focus-within:ring-amber-100"
            >
              <textarea
                rows={2}
                value={draft}
                maxLength={MAX_PROMPT_LENGTH}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder="Describe what you want to create"
                aria-label="Describe what you want to create"
                data-testid="agent-page-media-composer"
                className="w-full resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
              <div className="flex items-center justify-end px-1 pb-1">
                <button
                  type="submit"
                  disabled={creating || !draft.trim()}
                  data-testid="agent-page-media-create"
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ backgroundColor: accent, color: accentText }}
                >
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {creating ? "Creating…" : "Create"}
                </button>
              </div>
            </form>

            {creations.length === 0 && !creating && suggestedPrompts.length > 0 ? (
              <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
                {suggestedPrompts.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    data-testid="agent-page-suggested-prompt"
                    onClick={() => requestCreate(prompt)}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm transition hover:border-gray-300 hover:bg-slate-50"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            ) : null}
          </>
        )}

        {creating ? (
          <section className="mt-8" data-testid="agent-page-media-loading">
            <p className="text-sm leading-relaxed text-slate-500">&ldquo;{pendingPrompt}&rdquo;</p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: SKELETON_TILE_COUNT }, (_, index) => (
                <div
                  key={index}
                  className="aspect-square animate-pulse rounded-2xl bg-slate-100 motion-reduce:animate-none"
                  data-testid="agent-page-media-skeleton"
                />
              ))}
            </div>
          </section>
        ) : null}

        {failedPrompt && !creating ? (
          <div className="mt-8" data-testid="agent-page-error">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm leading-relaxed text-red-700">
              <span>Something went wrong. Please try again.</span>
              <button
                type="button"
                data-testid="agent-page-retry"
                onClick={() => void performCreate(failedPrompt)}
                className="inline-flex items-center gap-1 font-semibold underline transition hover:text-red-800"
              >
                <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                Try again
              </button>
            </div>
          </div>
        ) : null}

        {creations.map((creation) => (
          <section key={creation.id} className="mt-8" data-testid="agent-page-media-result">
            <p className="text-sm leading-relaxed text-slate-500">&ldquo;{creation.prompt}&rdquo;</p>

            {creation.mediaUrls.length > 0 ? (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                {creation.mediaUrls.map((url, index) => (
                  <div
                    key={`${creation.id}-${index}`}
                    className="group relative aspect-square overflow-hidden rounded-2xl border border-gray-100 bg-slate-50 shadow-sm"
                    data-testid="agent-page-media-tile"
                  >
                    {isVideoUrl(url) ? (
                      <video
                        src={url}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : isDataUri(url) ? (
                      // Browsers refuse to open data: URIs as a page — the
                      // overlay button (a real download) is the tile action.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={url}
                        alt={creation.prompt}
                        loading="lazy"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open full size in a new tab"
                        className="block h-full w-full"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={url}
                          alt={creation.prompt}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      </a>
                    )}
                    {isDataUri(url) ? (
                      <a
                        href={url}
                        download={`${listing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "creation"}-${index + 1}`}
                        aria-label="Download"
                        data-testid="agent-page-media-download"
                        className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                      >
                        <Download className="h-4 w-4" aria-hidden="true" />
                      </a>
                    ) : (
                      // The download attribute is ignored cross-origin — be
                      // honest and open the media full size instead.
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open full size in a new tab"
                        data-testid="agent-page-media-open"
                        className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-700 opacity-0 shadow-sm backdrop-blur transition hover:bg-white focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                      >
                        <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            ) : null}

            {creation.text ? (
              <p
                className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-600"
                data-testid="agent-page-media-caption"
              >
                {creation.text}
              </p>
            ) : null}

            {creation.mediaUrls.length === 0 && !creation.text ? (
              <p className="mt-3 text-sm leading-relaxed text-slate-500">
                Nothing came back for that one. Try describing it a little differently.
              </p>
            ) : null}
          </section>
        ))}
      </div>
    </div>
  );
}
