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

const POPPINS_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');

.resources-root {
  font-family: 'Poppins', ui-sans-serif, system-ui, sans-serif;
  font-size: 13px;
  line-height: 1.45;
  -webkit-font-smoothing: antialiased;
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
    <CloseIcon className="h-4 w-4" />
  ) : (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function categoryTitle(categoryId: string) {
  return resourceCategories.find((c) => c.id === categoryId)?.title ?? "Guides";
}

function AudienceBadges({ audience }: { audience?: ("business" | "architect" | "both")[] }) {
  const labels =
    !audience?.length || audience.includes("both")
      ? (["Business", "Architect"] as const)
      : audience.map((a) => (a === "business" ? "Business" : "Architect"));

  return (
    <div className="flex flex-wrap gap-1" data-testid="resources-audience-badges">
      {labels.map((label) => (
        <span
          key={label}
          className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${
            label === "Business"
              ? "bg-sky-50 text-sky-700 ring-1 ring-sky-100"
              : "bg-violet-50 text-violet-700 ring-1 ring-violet-100"
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
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-3 pt-[12vh] backdrop-blur-[2px] sm:px-4"
      data-testid="resources-search-popup"
      role="dialog"
      aria-modal="true"
      aria-label="Search resources"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-2.5">
          <SearchIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="Search guides & articles…"
            data-testid="resources-search-popup-input"
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-slate-900 placeholder:text-slate-400 outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-50 hover:text-slate-700"
            aria-label="Close search"
            data-testid="resources-search-popup-close"
          >
            <CloseIcon />
          </button>
        </div>

        <div className="max-h-[min(420px,55vh)] overflow-y-auto py-2" data-testid="resources-search-suggestions">
          <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
            {query.trim() ? "Related articles" : "Suggested articles"}
          </p>

          {empty ? (
            <p className="px-3 py-6 text-center text-[12px] text-slate-400" data-testid="resources-search-empty">
              No articles match “{query}”.
            </p>
          ) : (
            <ul className="px-1.5">
              {showList.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    data-testid={`resources-search-result-${item.slug}`}
                    onClick={() => onSelect(item.slug)}
                    className="flex w-full flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition hover:bg-amber-50"
                  >
                    <span className="text-[12px] font-semibold text-slate-900">{item.title}</span>
                    <span className="line-clamp-1 text-[11px] font-normal text-slate-500">
                      {item.description}
                    </span>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-medium text-amber-600">
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

        <div className="border-t border-slate-100 px-3 py-2 text-[10px] text-slate-400">
          Esc to close · Enter a keyword to refine
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

  const jumpSections =
    selected?.sections?.map((section, index) => ({
      id: `section-${index + 1}`,
      label: section.title,
    })) ?? [];

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
      if (e.key !== "/" || searchOpen) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  const hubLabel = mode === "architect" ? "Architect Docs" : "Business Docs";

  return (
    <div
      className="resources-root min-h-screen bg-white text-slate-900"
      data-testid={mode === "architect" ? "resources-architect-page" : "resources-page"}
    >
      <style>{POPPINS_STYLES}</style>

      <header
        className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md"
        data-testid="resources-header"
      >
        <div className="mx-auto flex h-12 max-w-[1440px] items-center gap-2.5 px-3 sm:px-5">
          <button
            type="button"
            className="inline-flex items-center justify-center rounded-md p-1.5 text-slate-600 hover:bg-amber-50 hover:text-amber-700 lg:hidden"
            aria-label={sidebarOpen ? "Close navigation" : "Open navigation"}
            data-testid="resources-mobile-nav-toggle"
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <MenuIcon open={sidebarOpen} />
          </button>

          <Link
            href={HOME_ROUTE}
            className="flex shrink-0 items-center gap-1.5"
            data-testid="resources-logo-link"
          >
            <Image
              src={TRIVEN_LOGO_SRC}
              alt="Triven logo"
              width={24}
              height={24}
              className="h-6 w-6 object-contain"
              priority
            />
            <span className="hidden text-[13px] font-extrabold tracking-tight text-amber-500 sm:inline">
              Triven.ai
            </span>
            <span className="hidden text-[12px] font-medium text-slate-300 sm:inline">/</span>
            <span className="text-[12px] font-semibold text-slate-800">{hubLabel}</span>
          </Link>

          <Link
            href={HELP_CENTER_ROUTE}
            className="hidden text-[11px] font-semibold text-slate-500 transition hover:text-amber-700 sm:inline"
            data-testid="resources-help-center-link"
          >
            Help Center
          </Link>

          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2 sm:max-w-xs lg:max-w-sm">
            <button
              type="button"
              onClick={openSearch}
              data-testid="resources-search-trigger"
              className="flex w-full items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left transition hover:border-amber-300 hover:bg-white"
            >
              <SearchIcon className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-slate-400">
                Search questions…
              </span>
              <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-400 sm:inline">
                /
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

      <div className="mx-auto flex max-w-[1440px]">
        <aside
          data-testid="resources-sidebar"
          className={`fixed inset-y-0 left-0 z-30 flex w-[260px] shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white pt-12 transition-transform lg:sticky lg:top-12 lg:z-0 lg:h-[calc(100vh-3rem)] lg:translate-x-0 lg:self-start lg:pt-0 ${
            sidebarOpen ? "translate-x-0 shadow-xl" : "-translate-x-full"
          }`}
        >
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-4">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
              {mode === "architect" ? "Architect guides" : "Topics"}
            </p>

            <div className="space-y-3" data-testid="resources-category-nav">
              {hubCategories.map((category) => {
                const items = hubResources.filter((r) => r.category === category.id);
                if (!items.length) return null;
                const open = expandedCategories[category.id] !== false;
                return (
                  <div key={category.id} data-testid={`resources-category-${category.id}`}>
                    <button
                      type="button"
                      onClick={() => toggleCategory(category.id)}
                      className="mb-1 flex w-full items-center gap-1.5 px-1 text-left text-[12px] font-bold tracking-tight text-slate-800 hover:text-amber-700"
                    >
                      <ChevronIcon open={open} />
                      {category.title}
                      <span className="ml-auto text-[10px] font-semibold tabular-nums text-slate-400">
                        {items.length}
                      </span>
                    </button>
                    {open && (
                      <ul className="space-y-0.5 border-l border-slate-200 pl-2">
                        {items.map((item) => {
                          const active = selected?.slug === item.slug;
                          return (
                            <li key={item.id}>
                              <button
                                type="button"
                                data-testid={`resources-nav-${item.slug}`}
                                onClick={() => selectResource(item.slug)}
                                className={`w-full rounded-md px-2 py-1 text-left text-[9px] leading-snug transition ${
                                  active
                                    ? "bg-amber-50 font-semibold text-amber-900 ring-1 ring-amber-200"
                                    : "font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-800"
                                }`}
                              >
                                {item.title}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
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
            className="fixed inset-0 z-20 bg-slate-900/30 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        <main className="min-w-0 flex-1 px-3 py-6 sm:px-6 lg:px-8" data-testid="resources-main">
          {selected ? (
            <div className="flex gap-8">
              <article className="mx-auto min-w-0 max-w-2xl flex-1" data-testid="resources-article">
                <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-semibold text-amber-600">
                    {categoryTitle(selected.category)}
                  </span>
                  <span className="text-slate-300">·</span>
                  <AudienceBadges audience={selected.audience} />
                </div>

                <h1
                  className="text-[22px] font-extrabold leading-snug tracking-tight text-slate-900 sm:text-[26px]"
                  data-testid="resources-article-title"
                >
                  {selected.title}
                </h1>
                <p
                  className="mt-2 text-[13px] font-medium leading-relaxed text-slate-500"
                  data-testid="resources-article-description"
                >
                  {selected.description}
                </p>

                {selected.image?.endsWith(".svg") ? (
                  <ResourceArticleBanner image={selected.image} alt={selected.imageAlt || selected.title} />
                ) : selected.image ? (
                  <div
                    className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
                    data-testid="resources-article-image"
                  >
                    <ResourceCoverImage
                      src={selected.image}
                      alt={selected.imageAlt || selected.title}
                    />
                  </div>
                ) : null}

                <div className="mt-3 flex flex-wrap gap-1" data-testid="resources-article-keywords">
                  {selected.keywords.map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => {
                        setQuery(kw);
                        setSearchOpen(true);
                      }}
                      className="rounded-md bg-slate-50 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-slate-200 transition hover:bg-amber-50 hover:text-amber-800 hover:ring-amber-200"
                      data-testid={`resources-keyword-${kw.replace(/\s+/g, "-")}`}
                    >
                      {kw}
                    </button>
                  ))}
                </div>

                <hr className="my-5 border-slate-100" />

                <section data-testid="resources-article-content">
                  <p className="text-[12px] font-medium leading-relaxed text-slate-600">
                    {selected.intro}
                  </p>

                  <div className="mt-6 space-y-8">
                    {selected.sections.map((section, index) => (
                      <div
                        key={`${selected.id}-${index}`}
                        id={`section-${index + 1}`}
                        className="scroll-mt-24"
                      >
                        <h2 className="text-[15px] font-bold tracking-tight text-slate-900">
                          {section.title}
                        </h2>
                        <p className="mt-2 text-[12px] font-medium leading-relaxed text-slate-600">
                          {section.body}
                        </p>

                        {section.examples && section.examples.length > 0 ? (
                          <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                            <table className="w-full text-left text-[11px]">
                              <thead className="bg-slate-50 text-slate-500">
                                <tr>
                                  <th className="px-3 py-2 font-semibold">Type</th>
                                  <th className="px-3 py-2 font-semibold">Example</th>
                                </tr>
                              </thead>
                              <tbody className="text-slate-600">
                                {section.examples.map((row) => (
                                  <tr key={row.label} className="border-t border-slate-100">
                                    <td className="px-3 py-2 font-semibold text-slate-800">
                                      {row.label}
                                    </td>
                                    <td className="px-3 py-2 font-mono text-[10px] text-slate-500">
                                      {row.value}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ) : null}

                        {section.steps && section.steps.length > 0 ? (
                          <ol
                            className="mt-4 space-y-2"
                            data-testid="resources-section-steps"
                          >
                            {section.steps.map((step, stepIndex) => (
                              <li
                                key={`${selected.id}-step-${stepIndex}`}
                                className="flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5 shadow-sm"
                              >
                                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[11px] font-bold text-white">
                                  {stepIndex + 1}
                                </span>
                                <span className="pt-0.5 text-[12px] font-medium leading-relaxed text-slate-700">
                                  {step}
                                </span>
                              </li>
                            ))}
                          </ol>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>

                {selected.proTips && selected.proTips.length > 0 ? (
                  <section
                    className="mt-8 rounded-lg border border-amber-100 bg-amber-50/50 p-4"
                    data-testid="resources-pro-tips"
                  >
                    <h2 className="text-[14px] font-bold text-slate-900">Pro tips</h2>
                    <ul className="mt-2 space-y-2">
                      {selected.proTips.map((tip) => (
                        <li
                          key={tip}
                          className="flex gap-2 text-[12px] font-medium leading-relaxed text-slate-600"
                        >
                          <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                          <span>{tip}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {related.length > 0 && (
                  <section className="mt-8" data-testid="resources-related">
                    <h2 className="text-[15px] font-bold text-slate-900">Related questions</h2>
                    <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                      {related.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => selectResource(item.slug)}
                            className="group flex h-full w-full flex-col rounded-lg border border-slate-200 bg-gradient-to-br from-white to-amber-50/50 p-3 text-left transition hover:border-amber-300 hover:shadow-sm"
                          >
                            <span className="text-[12px] font-semibold text-slate-900 group-hover:text-amber-800">
                              {item.title}
                            </span>
                            <span className="mt-0.5 line-clamp-2 text-[11px] font-medium text-slate-500">
                              {item.description}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section
                  className="mt-8 rounded-lg border border-amber-200 bg-amber-50/60 p-4"
                  data-testid="resources-help"
                >
                  <h2 className="text-[14px] font-bold text-slate-900">Need help?</h2>
                  <p className="mt-1 text-[12px] font-medium text-slate-600">
                    Browse the Help Center or search more questions here.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={openSearch}
                      className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-slate-700 transition hover:border-amber-300 hover:text-amber-800"
                      data-testid="resources-search-cta"
                    >
                      Search questions
                    </button>
                    <Link
                      href={HELP_CENTER_ROUTE}
                      className="inline-flex items-center rounded-md bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm transition hover:bg-amber-600"
                      data-testid="resources-contact-link"
                    >
                      Back to Help Center
                    </Link>
                  </div>
                </section>
              </article>

              <nav
                className="sticky top-16 hidden h-fit w-48 shrink-0 xl:block"
                data-testid="resources-toc"
                aria-label="On this page"
              >
                <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                  On this page
                </p>
                <ul className="space-y-0.5 border-l border-slate-200">
                  {jumpSections.map((section, index) => (
                    <li key={section.id}>
                      <a
                        href={`#${section.id}`}
                        className="block border-l-2 border-transparent py-1 pl-2.5 text-[10px] font-medium leading-snug text-slate-500 transition hover:border-amber-400 hover:text-amber-800"
                      >
                        {index + 1}. {section.label}
                      </a>
                    </li>
                  ))}
                </ul>
              </nav>
            </div>
          ) : (
            <p className="text-[12px] text-slate-500">No resource selected.</p>
          )}
        </main>
      </div>
    </div>
  );
}
