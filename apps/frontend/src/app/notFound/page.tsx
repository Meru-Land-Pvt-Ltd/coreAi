"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

const destinations = [
  {
    title: "Marketplace",
    subtitle: "Browse AI agents",
    href: "/marketplace",
    icon: "grid"
  },
  {
    title: "Help Center",
    subtitle: "Get support",
    href: "/help",
    icon: "help"
  },
  {
    title: "Dashboard",
    subtitle: "Return to your account",
    href: "/business/dashboard",
    icon: "dashboard"
  }
] as const;

export default function NotFoundPage() {
  const [toastOpen, setToastOpen] = useState(false);

  function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    setToastOpen(true);

    window.setTimeout(() => {
      setToastOpen(false);
    }, 2800);
  }

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-white font-sans text-slate-900 antialiased selection:bg-amber-100 selection:text-amber-900">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 -z-10 flex justify-center overflow-hidden"
      >
        <div className="absolute -top-32 h-[36rem] w-[56rem] max-w-[120vw] rounded-full bg-[radial-gradient(closest-side,rgba(245,158,11,0.10),rgba(245,158,11,0)_70%)]" />
      </div>

      <nav className="flex h-16 shrink-0 items-center justify-between border-b border-gray-100 bg-white px-6">
        <Link
          href="/"
          aria-label="CORE home"
          className="flex items-center gap-2.5 rounded-lg px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
        >
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-300 to-amber-600">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M12 4v2.5M12 17.5V20M4 12h2.5M17.5 12H20" />
            </svg>
          </span>

          <span className="text-[15px] font-bold tracking-tight text-slate-900">
            CORE
          </span>
        </Link>

        <Link
          href="/"
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-slate-600 transition hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          Back to home
        </Link>
      </nav>

      <main className="flex flex-1 items-center justify-center px-6 py-12">
        <div className="w-full max-w-2xl text-center">
          <div className="flex flex-col items-center">
            <span className="select-none bg-gradient-to-b from-amber-300 to-amber-600 bg-clip-text text-[80px] font-extrabold leading-none tracking-tighter text-transparent drop-shadow-[0_16px_30px_rgba(217,119,6,0.18)] md:text-[120px]">
              404
            </span>

            <div className="relative mt-5 flex h-3 items-center justify-center" aria-hidden="true">
              <span className="absolute h-2.5 w-2.5 animate-ping rounded-full bg-amber-400 opacity-60" />
              <span className="relative h-2.5 w-2.5 animate-pulse rounded-full bg-amber-500" />
            </div>
          </div>

          <h1 className="mt-6 text-2xl font-bold text-slate-900">
            This page doesn&apos;t exist
          </h1>

          <p className="mx-auto mt-3 max-w-md text-base leading-relaxed text-slate-500">
            The page you&apos;re looking for may have been moved, deleted, or never existed.
            Let&apos;s get you back on track.
          </p>

          <div className="mt-8 flex flex-col items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:-translate-y-px hover:bg-amber-600 hover:shadow-md active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
            >
              <HomeIcon />
              Go to homepage
            </Link>

            <span className="text-sm text-slate-400">or</span>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {destinations.map((item) => (
              <Link
                key={item.title}
                href={item.href as any}
                className="group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3.5 text-left transition hover:-translate-y-0.5 hover:border-amber-200 hover:bg-amber-50/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600 transition group-hover:bg-amber-100">
                  <DestinationIcon name={item.icon} />
                </span>

                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-slate-800">
                    {item.title}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {item.subtitle}
                  </span>
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-8">
            <label htmlFor="search-input" className="mb-2 block text-sm text-slate-500">
              Or search for what you need
            </label>

            <form onSubmit={handleSearch} role="search" className="relative mx-auto max-w-sm">
              <span
                className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-400"
                aria-hidden="true"
              >
                <SearchIcon />
              </span>

              <input
                id="search-input"
                name="q"
                type="text"
                autoComplete="off"
                aria-label="Search CORE"
                placeholder="Search CORE…"
                className="w-full rounded-xl border border-gray-200 bg-white py-3 pl-10 pr-12 text-sm text-slate-900 placeholder:text-slate-400 transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/60"
              />

              <button
                type="submit"
                aria-label="Search"
                data-testid="notfound-search-submit"
                className="absolute inset-y-0 right-1 flex w-11 items-center justify-center rounded-lg text-slate-400 transition hover:bg-amber-50 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
              >
                <ArrowRightIcon />
              </button>
            </form>
          </div>

          <p className="mt-12 text-xs text-slate-400">
            If you believe this is an error, contact{" "}
            <a
              href="mailto:support@coreplatform.ai"
              className="rounded font-medium text-slate-500 underline-offset-2 transition hover:text-amber-600 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
            >
              support@coreplatform.ai
            </a>
          </p>
        </div>
      </main>

      <div
        role="status"
        aria-live="polite"
        className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 transition-all duration-300 ${
          toastOpen
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-3 opacity-0"
        }`}
      >
        <div className="flex items-center gap-2.5 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white shadow-lg shadow-slate-900/20">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="h-4 w-4 text-amber-400"
            aria-hidden="true"
          >
            <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
          </svg>
          Search is coming soon
        </div>
      </div>
    </div>
  );
}

function HomeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M3 9.5 12 3l9 6.5" />
      <path d="M5 10v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V10" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m13 5 7 7-7 7" />
    </svg>
  );
}

function DestinationIcon({
  name
}: {
  name: "grid" | "help" | "dashboard";
}) {
  if (name === "help") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="9" />
        <path d="M9.2 9.2a2.8 2.8 0 0 1 5.4 1c0 1.8-2.6 2.2-2.6 4" />
        <path d="M12 17h.01" />
      </svg>
    );
  }

  if (name === "dashboard") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-[18px] w-[18px]"
        aria-hidden="true"
      >
        <rect x="3" y="3" width="7" height="9" rx="1.5" />
        <rect x="14" y="3" width="7" height="5" rx="1.5" />
        <rect x="14" y="12" width="7" height="9" rx="1.5" />
        <rect x="3" y="16" width="7" height="5" rx="1.5" />
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-[18px] w-[18px]"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}