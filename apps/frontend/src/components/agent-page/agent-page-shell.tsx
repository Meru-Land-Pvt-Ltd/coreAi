"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Bot } from "lucide-react";
import { HOME_PATH, publicAgentPath } from "@/lib/routes";
import { agentPageThemeTokens } from "./design-tokens";
import {
  agentPageAccent,
  agentPageAccentForeground,
  agentPageDesign,
  type AgentPageData,
  type AgentPageRuntime
} from "./types";

/** How long the preview CTA's "goes live when you publish" note stays up. */
const PREVIEW_CTA_NOTE_MS = 2600;

/**
 * Minimal branded chrome shared by every published-page template: sticky
 * header (agent identity + "Get this agent" CTA), full-height content area,
 * and a one-line footer. Templates render inside `children` and manage their
 * own scrolling — the shell pins itself to the visual viewport (100dvh) so
 * composers are never hidden behind the mobile keyboard.
 *
 * In preview mode (the builder's Test tab) the CTA keeps its exact look but
 * explains itself with a soft note instead of navigating away.
 */
export function AgentPageShell({
  data,
  runtime,
  children
}: {
  data: AgentPageData;
  runtime: AgentPageRuntime;
  children: ReactNode;
}) {
  const accent = agentPageAccent(data);
  // Light accents flip text/icons to dark slate so CTAs stay legible.
  const accentText = agentPageAccentForeground(accent);
  // Theme tokens applied at this root make every template inherit the right
  // ground/ink; templates read the same tokens for their own surfaces.
  const design = agentPageDesign(data);
  const tokens = agentPageThemeTokens(design.theme);
  const { listing, architect } = data;

  const isPreview = runtime.mode === "preview";
  const [previewCtaNote, setPreviewCtaNote] = useState(false);
  const noteTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current);
    };
  }, []);

  const showPreviewCtaNote = () => {
    setPreviewCtaNote(true);
    if (noteTimerRef.current !== null) window.clearTimeout(noteTimerRef.current);
    noteTimerRef.current = window.setTimeout(() => {
      noteTimerRef.current = null;
      setPreviewCtaNote(false);
    }, PREVIEW_CTA_NOTE_MS);
  };

  return (
    <div
      className={
        isPreview
          ? // Preview fills the builder's device frame instead of the viewport.
            "flex h-full flex-col antialiased"
          : "flex h-[100dvh] flex-col antialiased"
      }
      style={{ backgroundColor: tokens.ground, color: tokens.ink }}
      data-testid="agent-page"
      data-design-theme={design.theme}
    >
      <header
        className="sticky top-0 z-50 flex-none border-b backdrop-blur"
        style={{ borderColor: tokens.border, backgroundColor: tokens.surfaceTranslucent }}
      >
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          {listing.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.iconUrl}
              alt=""
              className="h-9 w-9 flex-none rounded-xl border object-cover"
              style={{ borderColor: tokens.border }}
              data-testid="agent-page-icon"
            />
          ) : (
            <span
              className="flex h-9 w-9 flex-none items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: accent, color: accentText }}
              data-testid="agent-page-icon"
            >
              <Bot className="h-5 w-5" aria-hidden="true" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p
              className="truncate text-sm font-semibold"
              style={{ color: tokens.ink }}
              data-testid="agent-page-name"
            >
              {listing.name}
            </p>
            {listing.tagline ? (
              <p
                className="truncate text-xs"
                style={{ color: tokens.inkSubtle }}
                data-testid="agent-page-tagline"
              >
                {listing.tagline}
              </p>
            ) : null}
          </div>

          {isPreview ? (
            <button
              type="button"
              onClick={showPreviewCtaNote}
              className="flex-none rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: accent, color: accentText }}
              data-testid="agent-page-cta"
            >
              Get this agent
            </button>
          ) : (
            <Link
              href={publicAgentPath(listing.id)}
              className="flex-none rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
              style={{ backgroundColor: accent, color: accentText }}
              data-testid="agent-page-cta"
            >
              Get this agent
            </Link>
          )}
        </div>

        {/* Sticky positioning makes the header the containing block, so this
            note hangs just below the CTA without touching the live layout. */}
        {isPreview && previewCtaNote ? (
          <p
            className="absolute right-4 top-full mt-2 rounded-xl border px-3.5 py-2 text-xs font-medium shadow-md sm:right-6"
            style={{
              borderColor: tokens.borderStrong,
              backgroundColor: tokens.card,
              color: tokens.inkMuted
            }}
            role="status"
            data-testid="agent-page-preview-cta-note"
          >
            This button goes live when you publish.
          </p>
        ) : null}
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <footer
        className="flex-none border-t pb-[env(safe-area-inset-bottom)]"
        style={{ borderColor: tokens.border, backgroundColor: tokens.ground }}
      >
        <p
          className="py-2.5 text-center text-xs"
          style={{ color: tokens.inkFaint }}
          data-testid="agent-page-footer"
        >
          Built by {architect?.displayName ?? "a Triven architect"} ·{" "}
          <Link
            href={HOME_PATH}
            className="transition hover:opacity-75"
            data-testid="agent-page-footer-link"
          >
            Powered by Triven
          </Link>
        </p>
      </footer>
    </div>
  );
}
