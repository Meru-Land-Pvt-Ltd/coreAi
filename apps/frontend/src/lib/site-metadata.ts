import type { Metadata } from "next";

export const SITE_NAME = "Triven.ai";
export const SITE_TAGLINE = "Your AI Workforce";
export const SITE_DESCRIPTION =
  "AI agent marketplace for businesses and AI architects — install, build, and run production-ready agents.";

/** Canonical site origin for Open Graph / absolute URLs. */
export function getSiteUrl(): URL {
  const fromEnv =
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  try {
    return new URL(fromEnv || "https://triven.ai");
  } catch {
    return new URL("https://triven.ai");
  }
}

export function absoluteUrl(path = "/"): string {
  const base = getSiteUrl();
  if (!path || path === "/") return base.origin;
  return new URL(path.startsWith("/") ? path : `/${path}`, base).toString();
}

/** Leaf page title that fills the active layout template (e.g. "Workflows" → "Workflows | Triven.ai"). */
export function pageTitle(title: string): Metadata {
  return { title };
}

/** Full browser title that bypasses parent templates. */
export function absoluteTitle(title: string): Metadata {
  return { title: { absolute: title } };
}

export function sectionMetadata(options: {
  section: string;
  description?: string;
  path?: string;
}): Metadata {
  const { section, description = SITE_DESCRIPTION, path } = options;
  return {
    title: {
      default: section,
      template: `%s | ${section} | ${SITE_NAME}`
    },
    description,
    ...(path
      ? {
          alternates: { canonical: absoluteUrl(path) },
          openGraph: {
            title: `${section} | ${SITE_NAME}`,
            description,
            url: absoluteUrl(path),
            siteName: SITE_NAME,
            type: "website"
          }
        }
      : {})
  };
}

export function buildRootMetadata(): Metadata {
  const siteUrl = getSiteUrl();
  return {
    metadataBase: siteUrl,
    title: {
      default: `${SITE_NAME} — ${SITE_TAGLINE}`,
      template: `%s | ${SITE_NAME}`
    },
    description: SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    authors: [{ name: SITE_NAME }],
    creator: SITE_NAME,
    publisher: SITE_NAME,
    keywords: [
      "AI agents",
      "AI marketplace",
      "AI receptionist",
      "automation",
      "Twilio",
      "Vapi",
      "Triven"
    ],
    icons: {
      icon: [{ url: "/favicon.ico", sizes: "any" }],
      shortcut: ["/favicon.ico"],
      apple: [{ url: "/favicon.ico" }]
    },
    manifest: "/site.webmanifest",
    openGraph: {
      type: "website",
      locale: "en_US",
      url: siteUrl,
      siteName: SITE_NAME,
      title: `${SITE_NAME} — ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION
    },
    twitter: {
      card: "summary",
      title: `${SITE_NAME} — ${SITE_TAGLINE}`,
      description: SITE_DESCRIPTION
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1
      }
    },
    formatDetection: {
      email: false,
      address: false,
      telephone: false
    }
  };
}
