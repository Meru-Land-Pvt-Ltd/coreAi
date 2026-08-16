"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { apiGet } from "@/lib/api";
import { MARKETPLACE_PATH } from "@/lib/routes";
import { AgentPageShell } from "@/components/agent-page/agent-page-shell";
import { ChatTemplate } from "@/components/agent-page/chat-template";
import { VoiceTemplate } from "@/components/agent-page/voice-template";
import { MediaTemplate } from "@/components/agent-page/media-template";
import { FormTemplate } from "@/components/agent-page/form-template";
import { FaceRenderer } from "@/components/agent-page/face-renderer";
import {
  createPublicAgentPageRuntime,
  type AgentPageData
} from "@/components/agent-page/types";

type PageState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error" }
  | { status: "ready"; data: AgentPageData };

function LoadingSkeleton() {
  return (
    <div
      className="flex h-[100dvh] flex-col bg-white antialiased"
      data-testid="agent-page-skeleton"
      aria-hidden="true"
    >
      <div className="flex-none border-b border-gray-100">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-3 px-4 sm:px-6">
          <div className="h-9 w-9 flex-none animate-pulse rounded-xl bg-gray-100" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-40 max-w-full animate-pulse rounded-full bg-gray-100" />
            <div className="h-2.5 w-56 max-w-full animate-pulse rounded-full bg-gray-100" />
          </div>
          <div className="h-9 w-28 flex-none animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-6">
        <div className="h-14 w-14 animate-pulse rounded-2xl bg-gray-100" />
        <div className="mt-5 h-6 w-64 max-w-full animate-pulse rounded-full bg-gray-100" />
        <div className="mt-3 h-3.5 w-80 max-w-full animate-pulse rounded-full bg-gray-100" />
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <div className="h-9 w-36 animate-pulse rounded-xl bg-gray-100" />
          <div className="h-9 w-44 animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
      <div className="flex-none border-t border-gray-100 px-4 py-3 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <div className="h-[46px] flex-1 animate-pulse rounded-2xl bg-gray-100" />
          <div className="h-[46px] w-[46px] flex-none animate-pulse rounded-xl bg-gray-100" />
        </div>
      </div>
    </div>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-white px-6 antialiased">
      <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
        {children}
      </div>
    </div>
  );
}

/**
 * The published agent page as it has always rendered.
 *
 * This is the pre-Product-Spec path, moved out of page.tsx verbatim so the
 * route can choose between it and the new multi-page product renderer. Its
 * behavior, markup and every `data-testid` are unchanged: an agent that has no
 * stored ProductSpec renders through here exactly as it did before, including
 * the loading skeleton, the not-found card and the retryable error state.
 *
 * The only difference is that the slug arrives as a prop instead of from
 * `useParams`, because the server component above already read it.
 */
export function LegacyAgentPage({ slug }: { slug: string }) {
  const [state, setState] = useState<PageState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  // The live runtime — the same public-API calls the templates always made.
  const runtime = useMemo(() => createPublicAgentPageRuntime(slug), [slug]);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const response = await apiGet<AgentPageData>(`/agent-pages/${slug}`);
      if (cancelled) return;
      if (response.success && response.data?.page && response.data.listing) {
        setState({ status: "ready", data: response.data });
      } else if (response.code === "AGENT_PAGE_NOT_FOUND" || response.status === 404) {
        setState({ status: "not-found" });
      } else {
        setState({ status: "error" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, reloadKey]);

  // A slug switch renders the skeleton (not the previous agent) while the new
  // page loads — the effect above will replace the stale data.
  const staleSlug = state.status === "ready" && state.data.page.slug !== slug;

  if (state.status === "loading" || staleSlug) {
    return <LoadingSkeleton />;
  }

  if (state.status === "not-found") {
    return (
      <CenteredCard>
        <div data-testid="agent-page-not-found">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            This agent isn&apos;t available
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            It may have moved or is no longer published. Explore other agents on
            the marketplace.
          </p>
          <Link
            href={MARKETPLACE_PATH}
            data-testid="agent-page-marketplace-link"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Explore agents
          </Link>
        </div>
      </CenteredCard>
    );
  }

  if (state.status === "error") {
    return (
      <CenteredCard>
        <div data-testid="agent-page-load-error">
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            We couldn&apos;t load this page. Check your connection and try again.
          </p>
          <button
            type="button"
            data-testid="agent-page-load-retry"
            onClick={() => {
              setState({ status: "loading" });
              setReloadKey((key) => key + 1);
            }}
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
          >
            Try again
          </button>
        </div>
      </CenteredCard>
    );
  }

  const { data } = state;

  return (
    <AgentPageShell data={data} runtime={runtime}>
      {data.blueprint ? (
        // The architect placed product blocks on their canvas — the page
        // assembles its interface from them instead of a default template.
        <FaceRenderer data={data} slug={slug} runtime={runtime} blueprint={data.blueprint} />
      ) : data.page.template === "voice" ? (
        <VoiceTemplate data={data} slug={slug} runtime={runtime} />
      ) : data.page.template === "media" ? (
        <MediaTemplate data={data} slug={slug} runtime={runtime} />
      ) : data.page.template === "form" ? (
        <FormTemplate data={data} slug={slug} runtime={runtime} />
      ) : (
        <ChatTemplate data={data} slug={slug} runtime={runtime} />
      )}
    </AgentPageShell>
  );
}

export default LegacyAgentPage;
