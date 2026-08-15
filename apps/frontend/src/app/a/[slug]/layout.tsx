import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SITE_NAME } from "@/lib/site-metadata";

/**
 * Server-side metadata for shared links: architects paste /a/<slug> URLs into
 * socials and DMs, so the unfurl must carry the agent's real name, tagline,
 * and icon — never a generic "AI Agent" card. Falls back to the generic title
 * when the page is missing or the API is unreachable.
 */

// Same resolution as src/lib/api.ts — this runs on the server, where the
// axios client (and its interceptors) are browser-oriented.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

type AgentPageMetaResponse = {
  success?: boolean;
  data?: {
    page?: { headline?: string | null } | null;
    listing?: {
      name?: string;
      tagline?: string | null;
      shortDescription?: string | null;
      iconUrl?: string | null;
    } | null;
  };
};

const FALLBACK_METADATA: Metadata = { title: "AI Agent" };

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  if (!slug) return FALLBACK_METADATA;

  try {
    const response = await fetch(`${API_URL}/agent-pages/${encodeURIComponent(slug)}`, {
      // Freshness is not critical for an unfurl — cache briefly.
      next: { revalidate: 300 }
    });
    if (!response.ok) return FALLBACK_METADATA;

    const json = (await response.json()) as AgentPageMetaResponse;
    const listing = json?.data?.listing;
    const name = listing?.name?.trim();
    if (!json?.success || !name) return FALLBACK_METADATA;

    const description =
      json.data?.page?.headline?.trim() ||
      listing?.tagline?.trim() ||
      listing?.shortDescription?.trim() ||
      undefined;
    const iconUrl = listing?.iconUrl?.trim() || undefined;
    const socialTitle = `${name} | ${SITE_NAME}`;

    return {
      title: name,
      description,
      openGraph: {
        title: socialTitle,
        description,
        type: "website",
        ...(iconUrl ? { images: [{ url: iconUrl }] } : {})
      },
      twitter: {
        card: "summary",
        title: socialTitle,
        description,
        ...(iconUrl ? { images: [iconUrl] } : {})
      }
    };
  } catch {
    return FALLBACK_METADATA;
  }
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
