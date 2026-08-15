"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Bot } from "lucide-react";
import { HOME_PATH, publicAgentPath } from "@/lib/routes";
import { agentPageAccent, agentPageAccentForeground, type AgentPageData } from "./types";

/**
 * Minimal branded chrome shared by every published-page template: sticky
 * header (agent identity + "Get this agent" CTA), full-height content area,
 * and a one-line footer. Templates render inside `children` and manage their
 * own scrolling — the shell pins itself to the visual viewport (100dvh) so
 * composers are never hidden behind the mobile keyboard.
 */
export function AgentPageShell({
  data,
  children
}: {
  data: AgentPageData;
  children: ReactNode;
}) {
  const accent = agentPageAccent(data);
  // Light accents flip text/icons to dark slate so CTAs stay legible.
  const accentText = agentPageAccentForeground(accent);
  const { listing, architect } = data;

  return (
    <div
      className="flex h-[100dvh] flex-col bg-white text-slate-900 antialiased"
      data-testid="agent-page"
    >
      <header className="sticky top-0 z-50 flex-none border-b border-gray-100 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          {listing.iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={listing.iconUrl}
              alt=""
              className="h-9 w-9 flex-none rounded-xl border border-gray-100 object-cover"
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
              className="truncate text-sm font-semibold text-slate-900"
              data-testid="agent-page-name"
            >
              {listing.name}
            </p>
            {listing.tagline ? (
              <p
                className="truncate text-xs text-slate-500"
                data-testid="agent-page-tagline"
              >
                {listing.tagline}
              </p>
            ) : null}
          </div>

          <Link
            href={publicAgentPath(listing.id)}
            className="flex-none rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: accent, color: accentText }}
            data-testid="agent-page-cta"
          >
            Get this agent
          </Link>
        </div>
      </header>

      <main className="flex min-h-0 flex-1 flex-col">{children}</main>

      <footer className="flex-none border-t border-gray-100 bg-white pb-[env(safe-area-inset-bottom)]">
        <p
          className="py-2.5 text-center text-xs text-slate-400"
          data-testid="agent-page-footer"
        >
          Built by {architect?.displayName ?? "a Triven architect"} ·{" "}
          <Link
            href={HOME_PATH}
            className="transition hover:text-slate-600"
            data-testid="agent-page-footer-link"
          >
            Powered by Triven
          </Link>
        </p>
      </footer>
    </div>
  );
}
