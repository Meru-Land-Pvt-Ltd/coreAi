"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { ResourceArticleBanner } from "./resource-banners";
import {
  resourceCategories,
  resources,
  searchResources,
  type ResourceItem,
} from "./resources.const";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";
const HOME_ROUTE = "/" as Route;
const HELP_CENTER_ROUTE = "/contact" as Route;

const RESOURCES_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');

.resources-root {
  --resources-header-h: 73px;
  --resources-bg: #ffffff;
  --resources-heading: #0f172a;
  --resources-body: #334155;
  --resources-secondary: #64748b;
  --resources-muted: #94a3b8;
  --resources-border: #e5e7eb;
  --resources-accent: #f59e0b;

  font-family: Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  background: var(--resources-bg);
  color: var(--resources-body);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.resources-root code,
.resources-root .resources-mono {
  font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

.resources-root .resources-h1 {
  font-size: 30px;
  line-height: 36px;
  font-weight: 700;
  color: var(--resources-heading);
  letter-spacing: -0.02em;
}

.resources-root .resources-h2 {
  font-size: 20px;
  line-height: 28px;
  font-weight: 700;
  color: var(--resources-heading);
  letter-spacing: -0.01em;
}

.resources-root .resources-h3 {
  font-size: 18px;
  line-height: 28px;
  font-weight: 600;
  color: var(--resources-heading);
}

.resources-root .resources-body {
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  color: var(--resources-body);
}

.resources-root .resources-small {
  font-size: 14px;
  line-height: 20px;
  font-weight: 400;
}

.resources-root .resources-caption {
  font-size: 12px;
  line-height: 16px;
  font-weight: 400;
}

.resources-root .resources-tiny {
  font-size: 11px;
  line-height: 16px;
  font-weight: 600;
}

.resources-root [data-section] {
  scroll-margin-top: calc(var(--resources-header-h) + 24px);
}

.resources-root .thin-scroll {
  scrollbar-width: thin;
  scrollbar-color: #e2e8f0 transparent;
}
.resources-root .thin-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.resources-root .thin-scroll::-webkit-scrollbar-thumb { background: #e2e8f0; border-radius: 9999px; }
.resources-root .thin-scroll::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
.resources-root .thin-scroll::-webkit-scrollbar-track { background: transparent; }

.resources-root :focus-visible {
  outline: 2px solid var(--resources-accent);
  outline-offset: 2px;
  border-radius: 8px;
}

.resources-root .resources-nav-category {
  font-size: 11px;
  line-height: 16px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: var(--resources-muted);
}

.resources-root .resources-nav-item {
  font-size: 14px !important;
  line-height: 20px !important;
  font-weight: 400;
  color: var(--resources-secondary);
}
.resources-root .resources-nav-item[aria-current="page"] {
  font-weight: 600;
  color: #b45309;
  background: #fffbeb;
}
`;

export type ResourcesHubMode = "business" | "architect";

function getHubCategories(mode: ResourcesHubMode) {
  return resourceCategories
    .filter((c) => c.hub === mode)
    .sort((a, b) => a.order - b.order);
}

function getHubResources(mode: ResourcesHubMode) {
  const cats = new Set(getHubCategories(mode).map((c) => c.id));
  return resources.filter((r) => cats.has(r.category));
}

function SearchIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

function CloseIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M6 6l12 12M18 6 6 18" strokeLinecap="round" />
    </svg>
  );
}

function MenuIcon({ open }: { open: boolean }) {
  return open ? (
    <CloseIcon className="h-5 w-5" />
  ) : (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 text-slate-300 transition-transform group-hover:text-slate-400 ${open ? "" : "-rotate-90"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function BreadcrumbChevron() {
  return (
    <svg
      className="h-3.5 w-3.5 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function categoryTitle(categoryId: string) {
  return resourceCategories.find((c) => c.id === categoryId)?.title ?? "Guides";
}

/** Short sidebar label derived from the full article title (article keeps full title). */
function sidebarTopicName(title: string, maxLen = 34) {
  let t = title.trim().replace(/\?+$/, "");

  const howDoes = /^How does (.+?)(?: work)?$/i.exec(t);
  if (howDoes?.[1]) return clampLabel(capitalizePhrase(howDoes[1].replace(/\s+work$/i, "")), maxLen);

  const whatIs = /^What (?:is|are) (?:the |an |a )?(.+)$/i.exec(t);
  if (whatIs?.[1]) return clampLabel(capitalizePhrase(whatIs[1]), maxLen);

  const howDo = /^How (?:do I|to|can I) (.+)$/i.exec(t);
  if (howDo?.[1]) return clampLabel(capitalizePhrase(howDo[1]), maxLen);

  const canI = /^Can I (.+)$/i.exec(t);
  if (canI?.[1]) return clampLabel(capitalizePhrase(canI[1]), maxLen);

  const isX = /^Is (.+)$/i.exec(t);
  if (isX?.[1]) return clampLabel(capitalizePhrase(isX[1]), maxLen);

  const who = /^Who (.+)$/i.exec(t);
  if (who?.[1]) return clampLabel(capitalizePhrase(who[1]), maxLen);

  const when = /^When (.+)$/i.exec(t);
  if (when?.[1]) return clampLabel(capitalizePhrase(when[1]), maxLen);

  t = t.replace(/\s*[—–-].*$/, "").trim();
  t = t.replace(/\.\s*What do I (?:do|check)$/i, "").trim();

  return clampLabel(t, maxLen);
}

function clampLabel(value: string, maxLen: number) {
  if (value.length <= maxLen) return value;
  return `${value.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function capitalizePhrase(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

/** Compact TOC labels so long architect section titles match business density. */
function tocLabel(title: string) {
  return clampLabel(title.replace(/\s+/g, " ").trim(), 28);
}

function AudienceBadges({ audience }: { audience?: ("business" | "architect" | "both")[] }) {
  const labels =
    !audience?.length || audience.includes("both")
      ? (["Business", "Architect"] as const)
      : audience.map((a) => (a === "business" ? "Business" : "Architect"));

  return (
    <div className="flex flex-wrap gap-1.5" data-testid="resources-audience-badges">
      {labels.map((label) => (
        <span
          key={label}
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold leading-4 ${
            label === "Business"
              ? "bg-sky-50 text-sky-700"
              : "bg-violet-50 text-violet-700"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function ResourceCoverImage({ src, alt }: { src: string; alt: string }) {
  const isRemote = /^https?:\/\//i.test(src);

  if (isRemote) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className="h-auto max-h-[280px] w-full object-contain"
        loading="lazy"
        data-testid="resources-article-image-el"
      />
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      width={1200}
      height={320}
      className="h-auto max-h-[280px] w-full object-contain"
      data-testid="resources-article-image-el"
    />
  );
}

function SearchPopup({
  open,
  query,
  onQueryChange,
  suggestions,
  popular,
  onSelect,
  onClose,
}: {
  open: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  suggestions: ResourceItem[];
  popular: ResourceItem[];
  onSelect: (slug: string) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const showList = query.trim() ? suggestions : popular;
  const empty = query.trim() && suggestions.length === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-3 pt-[12vh] backdrop-blur-sm sm:px-4"
      data-testid="resources-search-popup"
      role="dialog"
      aria-modal="true"
      aria-label="Search resources"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 border-b border-[#E5E7EB] px-4 py-4 sm:px-6">
          <SearchIcon className="h-5 w-5 shrink-0 text-[#94A3B8]" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search guides & articles…"
            data-testid="resources-search-popup-input"
            className="resources-body min-w-0 flex-1 bg-transparent text-[#0F172A] placeholder:text-[#94A3B8] outline-none"
          />
          <kbd className="resources-tiny hidden rounded-[10px] border border-[#E5E7EB] px-2 py-1 text-[#94A3B8] sm:inline-flex">
            Esc
          </kbd>
          <button
            type="button"
            onClick={onClose}
            className="rounded-[10px] p-1.5 text-[#94A3B8] transition hover:bg-gray-50 hover:text-[#334155] sm:hidden"
            aria-label="Close search"
            data-testid="resources-search-popup-close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="thin-scroll max-h-[min(420px,55vh)] overflow-y-auto py-2" data-testid="resources-search-suggestions">
          <p className="resources-tiny px-4 pb-2 pt-2 uppercase tracking-wider text-[#94A3B8]">
            {query.trim() ? "Related articles" : "Suggested articles"}
          </p>

          {empty ? (
            <p className="resources-small px-4 py-8 text-center text-[#94A3B8]" data-testid="resources-search-empty">
              No articles match “{query}”.
            </p>
          ) : (
            <ul className="px-2">
              {showList.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={`resources-search-result-${item.slug}`}
                    onClick={() => onSelect(item.slug)}
                    className="flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition hover:bg-amber-50"
                  >
                    <span className="resources-small font-semibold text-[#0F172A]">{item.title}</span>
                    <span className="resources-caption line-clamp-1 text-[#64748B]">
                      {item.description}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="resources-caption font-medium text-[#F59E0B]">
                        {categoryTitle(item.category)}
                      </span>
                      <AudienceBadges audience={item.audience} />
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="resources-caption border-t border-[#E5E7EB] px-4 py-2.5 text-[#94A3B8]">
          Esc to close · Ctrl/⌘ K to search
        </div>
      </div>
    </div>
  );
}

export function ResourcesHub({ mode = "business" }: { mode?: ResourcesHubMode }) {
  const searchParams = useSearchParams();
  const categoryParam = searchParams.get("category");
  const articleParam = searchParams.get("article");

  const hubCategories = useMemo(() => getHubCategories(mode), [mode]);
  const hubResources = useMemo(() => getHubResources(mode), [mode]);

  const initialSlug = useMemo(() => {
    if (articleParam && hubResources.some((r) => r.slug === articleParam)) {
      return articleParam;
    }
    if (categoryParam) {
      const firstInCategory = hubResources.find((r) => r.category === categoryParam);
      if (firstInCategory) return firstInCategory.slug;
    }
    return hubResources[0]?.slug ?? "";
  }, [articleParam, categoryParam, hubResources]);

  const [selectedSlug, setSelectedSlug] = useState(initialSlug);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(hubCategories.map((c) => [c.id, true]))
  );

  useEffect(() => {
    setSelectedSlug(initialSlug);
  }, [initialSlug]);

  useEffect(() => {
    if (categoryParam && hubCategories.some((c) => c.id === categoryParam)) {
      setExpandedCategories((prev) => ({ ...prev, [categoryParam]: true }));
    }
  }, [categoryParam, hubCategories]);

  const suggestions = useMemo(
    () => (query.trim() ? searchResources(query, hubResources).slice(0, 12) : []),
    [query, hubResources]
  );

  const selected = useMemo(
    () => hubResources.find((r) => r.slug === selectedSlug) ?? hubResources[0],
    [selectedSlug, hubResources]
  );

  const related = useMemo(() => {
    if (!selected?.related?.length) return [];
    return selected.related
      .map((id) => hubResources.find((r) => r.id === id || r.slug === id))
      .filter((r): r is ResourceItem => r != null && r.id !== selected.id);
  }, [selected, hubResources]);

  const jumpSections = useMemo(() => {
    if (!selected) return [] as { id: string; label: string }[];
    const items = selected.sections.map((section, index) => ({
      id: `section-${index + 1}`,
      label: tocLabel(section.title),
    }));
    if (selected.proTips?.length) {
      items.push({ id: "section-pro-tips", label: "Pro tips" });
    }
    if (related.length > 0) {
      items.push({ id: "section-related", label: "Related articles" });
    }
    return items;
  }, [selected, related]);

  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  useEffect(() => {
    setActiveSectionId(jumpSections[0]?.id ?? null);
  }, [selected?.id, jumpSections]);

  useEffect(() => {
    if (!jumpSections.length || typeof window === "undefined") return;

    const elements = jumpSections
      .map((section) => document.getElementById(section.id))
      .filter((el): el is HTMLElement => el != null);

    if (!elements.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0]?.target;
        if (top?.id) setActiveSectionId(top.id);
      },
      {
        root: null,
        rootMargin: "-20% 0px -60% 0px",
        threshold: [0, 0.1, 0.25, 0.5, 1],
      }
    );

    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [jumpSections, selected?.id]);

  const selectResource = (slug: string) => {
    setSelectedSlug(slug);
    setSidebarOpen(false);
    setSearchOpen(false);
    setQuery("");
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  const openSearch = () => {
    setQuery("");
    setSearchOpen(true);
  };

  const toggleCategory = (id: string) => {
    setExpandedCategories((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      const typing = tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable;

      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        openSearch();
        return;
      }

      if (e.key === "/" && !searchOpen && !typing) {
        e.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const hubLabel = mode === "architect" ? "Architect Docs" : "Business Docs";

  const selectedIndex = selected ? hubResources.findIndex((r) => r.id === selected.id) : -1;
  const prevResource = selectedIndex > 0 ? hubResources[selectedIndex - 1] : null;
  const nextResource =
    selectedIndex >= 0 && selectedIndex < hubResources.length - 1
      ? hubResources[selectedIndex + 1]
      : null;

  return (
    <div
      className="resources-root min-h-screen bg-white"
      data-testid={mode === "architect" ? "resources-architect-page" : "resources-page"}
    >
      <style>{RESOURCES_STYLES}</style>

      <header
        className="sticky top-0 z-40 border-b border-[#E5E7EB] bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80"
        data-testid="resources-header"
      >
        <div className="mx-auto flex max-w-[90%] items-center gap-2 px-3 py-3 sm:gap-3 sm:px-6 sm:py-4">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 sm:flex-none sm:gap-2">
            <button
              type="button"
              className="-ml-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-[#64748B] hover:bg-gray-50 lg:hidden"
              aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
              data-testid="resources-mobile-nav-toggle"
              onClick={() => setSidebarOpen((v) => !v)}
            >
              <MenuIcon open={sidebarOpen} />
            </button>

            <Link
              href={HOME_ROUTE}
              className="flex min-w-0 items-center gap-1.5 sm:gap-2"
              data-testid="resources-logo-link"
            >
              <Image
                src={TRIVEN_LOGO_SRC}
                alt="Triven logo"
                width={32}
                height={32}
                className="h-7 w-7 shrink-0 object-contain sm:h-8 sm:w-8"
                priority
              />
              <span className="flex min-w-0 items-center gap-1.5 sm:gap-2">
                <span className="hidden truncate text-[15px] font-bold tracking-tight text-[#0F172A] min-[380px]:inline sm:text-[17px]">
                  Triven.ai
                </span>
                <span className="resources-caption shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 font-semibold text-amber-700 sm:px-2">
                  <span className="sm:hidden">Docs</span>
                  <span className="hidden sm:inline">{hubLabel}</span>
                </span>
              </span>
            </Link>
          </div>

          <Link
            href={HELP_CENTER_ROUTE}
            className="resources-small hidden shrink-0 font-semibold text-[#64748B] transition hover:text-[#F59E0B] md:inline"
            data-testid="resources-help-center-link"
          >
            Help Center
          </Link>

          {/* Mobile: icon-only search */}
          <button
            type="button"
            onClick={openSearch}
            data-testid="resources-search-trigger-mobile"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-[#E5E7EB] bg-gray-50 text-[#64748B] transition hover:bg-white hover:text-[#0F172A] sm:hidden"
            aria-label="Search documentation"
            aria-keyshortcuts="Meta+K Control+K"
          >
            <SearchIcon className="h-4 w-4" />
          </button>

          {/* Tablet/desktop: full search field */}
          <div className="hidden min-w-0 flex-1 justify-center px-1 sm:flex sm:px-4">
            <button
              type="button"
              onClick={openSearch}
              data-testid="resources-search-trigger"
              className="group flex w-full max-w-xl items-center gap-2.5 rounded-xl border border-[#E5E7EB] bg-gray-50 py-2.5 pl-3.5 pr-2 text-[#94A3B8] transition hover:border-gray-300 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              aria-keyshortcuts="Meta+K Control+K"
            >
              <SearchIcon className="h-4 w-4 shrink-0 text-[#94A3B8]" />
              <span className="resources-small min-w-0 flex-1 truncate text-left">
                Search documentation…
              </span>
              <kbd className="resources-tiny hidden items-center gap-0.5 rounded-[10px] border border-[#E5E7EB] bg-white px-1.5 py-0.5 text-[#94A3B8] md:inline-flex">
                <span className="text-[13px] leading-none">⌘</span>K
              </kbd>
            </button>
          </div>
        </div>
      </header>

      <SearchPopup
        open={searchOpen}
        query={query}
        onQueryChange={setQuery}
        suggestions={suggestions}
        popular={hubResources.slice(0, 6)}
        onSelect={selectResource}
        onClose={() => {
          setSearchOpen(false);
          setQuery("");
        }}
      />

      <div className="mx-auto flex max-w-[90%]">
        <aside
          data-testid="resources-sidebar"
          className={`thin-scroll fixed inset-y-0 left-0 z-30 flex w-72 shrink-0 flex-col overflow-hidden border-r border-[#E5E7EB] bg-white pt-[var(--resources-header-h)] transition-transform lg:sticky lg:top-[var(--resources-header-h)] lg:z-0 lg:h-[calc(100vh-var(--resources-header-h))] lg:w-64 lg:translate-x-0 lg:self-start lg:pt-0 ${
            sidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"
          }`}
          role="navigation"
          aria-label="Documentation"
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6">
            <div className="space-y-2" data-testid="resources-category-nav">
              {hubCategories.map((category) => {
                const items = hubResources.filter((r) => r.category === category.id);
                if (!items.length) return null;
                const open = expandedCategories[category.id] !== false;
                return (
                  <div key={category.id} data-testid={`resources-category-${category.id}`} className="mb-6 last:mb-0">
                    <button
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className="group mb-2 flex w-full items-center justify-between rounded-[10px] px-3 py-1 text-left"
                      aria-expanded={open}
                    >
                      <span className="resources-nav-category uppercase group-hover:text-[#64748B]">
                        {category.title}
                      </span>
                      <ChevronIcon open={open} />
                    </button>
                    {open ? (
                      <div className="mb-1 ml-3 space-y-0.5 border-l border-[#E5E7EB] pl-2.5">
                        {items.map((item) => {
                          const active = selected?.slug === item.slug;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-testid={`resources-nav-${item.slug}`}
                              onClick={() => selectResource(item.slug)}
                              aria-current={active ? "page" : undefined}
                              className={`resources-nav-item block w-full truncate rounded-[10px] px-2.5 py-1.5 text-left transition ${
                                active
                                  ? "bg-amber-50"
                                  : "hover:bg-gray-50 hover:text-[#0F172A]"
                              }`}
                            >
                              {sidebarTopicName(item.title, mode === "architect" ? 24 : 30)}
                            </button>
                          );
                        })}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        </aside>

        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close sidebar overlay"
            className="fixed inset-0 top-[var(--resources-header-h)] z-20 bg-slate-900/30 backdrop-blur-sm lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="min-w-0 flex-1" data-testid="resources-main">
          {selected ? (
            <div className="relative flex">
              <article
                className="mx-auto min-w-0 w-full max-w-[90%] flex-1 px-6 py-8 sm:px-8 lg:px-12"
                data-testid="resources-article"
              >
                <nav
                  className="resources-small flex flex-wrap items-center gap-1.5 text-[#94A3B8]"
                  aria-label="Breadcrumb"
                  data-testid="resources-breadcrumb"
                >
                  <span>{hubLabel}</span>
                  <BreadcrumbChevron />
                  <span>{categoryTitle(selected.category)}</span>
                  <BreadcrumbChevron />
                  <span className="font-medium text-[#64748B]">
                    {sidebarTopicName(selected.title, mode === "architect" ? 26 : 40)}
                  </span>
                </nav>

                <div className="mt-3">
                  <AudienceBadges audience={selected.audience} />
                </div>

                <h1 className="resources-h1 mt-4" data-testid="resources-article-title">
                  {sidebarTopicName(selected.title, mode === "architect" ? 48 : 72)}
                </h1>
                <p
                  className="resources-body mt-2 text-[#64748B]"
                  data-testid="resources-article-description"
                  style={{ fontSize: 16, lineHeight: "24px" }}
                >
                  {selected.description}
                </p>

                {selected.image?.endsWith(".svg") ? (
                  <div className="mt-6 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-gray-50/60 shadow-sm">
                    <ResourceArticleBanner image={selected.image} alt={selected.imageAlt || selected.title} />
                  </div>
                ) : selected.image ? (
                  <figure
                    className="mt-6 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-gray-50/60 p-5 shadow-sm"
                    data-testid="resources-article-image"
                  >
                    <ResourceCoverImage
                      src={selected.image}
                      alt={selected.imageAlt || selected.title}
                    />
                  </figure>
                ) : null}

                <div className="mt-4 flex flex-wrap gap-2" data-testid="resources-article-keywords">
                  {selected.keywords.map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => {
                        setQuery(kw);
                        setSearchOpen(true);
                      }}
                      className="resources-caption rounded-[10px] bg-gray-100 px-2 py-1 font-medium text-[#64748B] transition hover:bg-amber-50 hover:text-amber-800"
                      data-testid={`resources-keyword-${kw.replace(/\s+/g, "-")}`}
                    >
                      {kw}
                    </button>
                  ))}
                </div>

                <section
                  className="resources-body mt-10 space-y-12"
                  data-testid="resources-article-content"
                >
                  <p className="mt-0">{selected.intro}</p>

                  {selected.sections.map((section, index) => (
                    <section
                      key={`${selected.id}-${index}`}
                      id={`section-${index + 1}`}
                      data-section
                    >
                      <h2 className="resources-h2">{section.title}</h2>
                      <p className="mt-3">{section.body}</p>

                      {section.examples && section.examples.length > 0 ? (
                        <div className="mt-5 overflow-x-auto rounded-xl border border-[#E5E7EB] shadow-sm">
                          <table className="resources-small w-full min-w-[420px] border-collapse">
                            <thead>
                              <tr className="bg-gray-50 text-left">
                                <th className="px-4 py-3 font-semibold text-[#64748B]">Type</th>
                                <th className="px-4 py-3 font-semibold text-[#64748B]">Example</th>
                              </tr>
                            </thead>
                            <tbody className="text-[#64748B]">
                              {section.examples.map((row) => (
                                <tr key={row.label} className="border-b border-gray-50 last:border-0">
                                  <td className="px-4 py-3 font-semibold text-[#0F172A]">
                                    {row.label}
                                  </td>
                                  <td className="px-4 py-3">
                                    <code className="resources-mono rounded-md bg-gray-100 px-1.5 py-0.5 text-[12px] text-[#64748B]">
                                      {row.value}
                                    </code>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      {section.steps && section.steps.length > 0 ? (
                        <ol className="mt-5 space-y-3.5" data-testid="resources-section-steps">
                          {section.steps.map((step, stepIndex) => (
                            <li
                              key={`${selected.id}-step-${stepIndex}`}
                              className="flex gap-3.5"
                            >
                              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[#F59E0B] text-[13px] font-bold text-white">
                                {stepIndex + 1}
                              </span>
                              <span className="pt-0.5">{step}</span>
                            </li>
                          ))}
                        </ol>
                      ) : null}
                    </section>
                  ))}
                </section>

                {selected.proTips && selected.proTips.length > 0 ? (
                  <section
                    id="section-pro-tips"
                    data-section
                    className="mt-12 rounded-xl border border-amber-100 bg-amber-50 p-5 shadow-sm"
                    data-testid="resources-pro-tips"
                  >
                    <h3 className="resources-h3 text-amber-900">Pro tips</h3>
                    <ul className="resources-small mt-3 space-y-2.5 text-amber-900/90">
                      {selected.proTips.map((tip) => (
                        <li key={tip} className="flex gap-2.5">
                          <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#F59E0B]" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {related.length > 0 && (
                  <section id="section-related" data-section className="mt-12" data-testid="resources-related">
                    <h2 className="resources-h2">Related articles</h2>
                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      {related.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => selectResource(item.slug)}
                          className="group flex items-center justify-between rounded-xl border border-[#E5E7EB] bg-white p-5 text-left shadow-sm transition hover:border-amber-300 hover:shadow-md"
                        >
                          <span className="resources-small pr-2 font-semibold text-[#334155] group-hover:text-[#0F172A]">
                            {sidebarTopicName(item.title, mode === "architect" ? 26 : 34)}
                          </span>
                          <svg
                            className="h-4 w-4 shrink-0 text-[#94A3B8] transition group-hover:translate-x-0.5 group-hover:text-[#F59E0B]"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth={2}
                            strokeLinecap="round"
                            aria-hidden="true"
                          >
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <nav
                  className="mt-12 flex flex-col gap-3 sm:flex-row"
                  aria-label="Previous and next articles"
                  data-testid="resources-prev-next"
                >
                  {prevResource ? (
                    <button
                      type="button"
                      onClick={() => selectResource(prevResource.slug)}
                      className="group flex flex-1 items-center gap-3 rounded-xl border border-[#E5E7EB] p-5 text-left shadow-sm transition hover:border-amber-300"
                    >
                      <svg className="h-5 w-5 text-[#94A3B8] transition group-hover:text-[#F59E0B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>
                        <span className="resources-caption block text-[#94A3B8]">Previous</span>
                        <span className="resources-small font-semibold text-[#334155]">
                          {sidebarTopicName(prevResource.title, 36)}
                        </span>
                      </span>
                    </button>
                  ) : (
                    <div className="hidden flex-1 sm:block" />
                  )}
                  {nextResource ? (
                    <button
                      type="button"
                      onClick={() => selectResource(nextResource.slug)}
                      className="group flex flex-1 items-center justify-end gap-3 rounded-xl border border-[#E5E7EB] p-5 text-right shadow-sm transition hover:border-amber-300"
                    >
                      <span>
                        <span className="resources-caption block text-[#94A3B8]">Next</span>
                        <span className="resources-small font-semibold text-[#334155]">
                          {sidebarTopicName(nextResource.title, 36)}
                        </span>
                      </span>
                      <svg className="h-5 w-5 text-[#94A3B8] transition group-hover:text-[#F59E0B]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path d="M5 12h14M12 5l7 7-7 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ) : null}
                </nav>

                <section
                  className="mt-12 rounded-xl border border-amber-100 bg-amber-50 p-5 shadow-sm"
                  data-testid="resources-help"
                >
                  <h2 className="resources-h2">Need help?</h2>
                  <p className="resources-body mt-3 text-[#64748B]">
                    Browse the Help Center or search more questions here.
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openSearch}
                      className="resources-small inline-flex items-center rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-2 font-semibold text-[#334155] transition hover:border-amber-300 hover:text-amber-800"
                      data-testid="resources-search-cta"
                    >
                      Search questions
                    </button>
                    <Link
                      href={HELP_CENTER_ROUTE}
                      className="resources-small inline-flex items-center rounded-[10px] bg-[#F59E0B] px-3.5 py-2 font-semibold text-white shadow-sm transition hover:bg-amber-600"
                      data-testid="resources-contact-link"
                    >
                      Back to Help Center
                    </Link>
                  </div>
                </section>
              </article>

              <aside
                className="thin-scroll sticky top-[var(--resources-header-h)] hidden h-fit w-52 shrink-0 overflow-y-auto py-8 pr-2 xl:block"
                style={{ maxHeight: "calc(100vh - var(--resources-header-h) - 2rem)" }}
                data-testid="resources-toc"
                aria-label="On this page"
              >
                <p className="resources-tiny mb-3 uppercase tracking-wider text-[#94A3B8]">
                  On this page
                </p>
                <nav className="space-y-0.5">
                  {jumpSections.map((section) => {
                    const active = activeSectionId === section.id;
                    return (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        aria-current={active ? "location" : undefined}
                        className={`resources-small block border-l-2 py-1 pl-3 transition ${
                          active
                            ? "border-[#F59E0B] font-semibold text-[#F59E0B]"
                            : "border-transparent text-[#64748B] hover:border-amber-200 hover:text-[#F59E0B]"
                        }`}
                      >
                        {section.label}
                      </a>
                    );
                  })}
                </nav>
              </aside>
            </div>
          ) : (
            <p className="resources-small px-6 py-8 text-[#64748B]">No resource selected.</p>
          )}
        </main>
      </div>
    </div>
  );
}
