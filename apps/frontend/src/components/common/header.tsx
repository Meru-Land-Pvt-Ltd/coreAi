"use client";

import type { Route } from "next";
import Link from "next/link";

type CoreHeaderProps = {
  navTop: number;
  navScrolled: boolean;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onCloseMenu: () => void;
};

export function CoreHeader({
  navTop,
  navScrolled,
  menuOpen,
  onToggleMenu,
  onCloseMenu
}: CoreHeaderProps) {
  return (
    <header
      id="navbar"
      style={{ top: navTop }}
      className={`fixed inset-x-0 z-50 border-b backdrop-blur-md transition ${
        navScrolled
          ? "border-gray-200 bg-white/90 shadow-[0_1px_3px_0_rgba(0,0,0,0.08),0_1px_2px_-1px_rgba(0,0,0,0.06)]"
          : "border-transparent"
      }`}
    >
      <nav className="mx-auto flex w-full max-w-none items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2.5" aria-label="CORE home">
          <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
            <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
            <circle cx="14" cy="14" r="4" fill="#fbbf24" />
          </svg>
          <span className="text-xl font-extrabold tracking-tight text-amber-500">
            CORE
          </span>
        </a>

        <div className="hidden min-w-0 flex-1 items-center justify-center gap-4 md:flex lg:gap-7 xl:gap-8">
          
          <Link href="/marketplace" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
            Marketplace
          </Link>

          <a href="/pricing" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
            Pricing
          </a>

          <Link href="/about" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
            About
          </Link>
          <Link href="/contactus" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
            Contact US
          </Link>

          <a href="#footer" className="text-sm font-medium text-slate-600 transition hover:text-slate-900">
            Docs
          </a>
        </div>

        <div className="hidden shrink-0 items-center gap-2 md:flex lg:gap-3">
          <Link
            href="/business/login"
            className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900"
          >
            Login
          </Link>

          <Link
            href="/assignment"
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 shadow-glow-sm transition hover:scale-[1.03] hover:bg-amber-400 hover:shadow-glow"
          >
            Get Started Free
          </Link>
        </div>

        <button
          type="button"
          onClick={onToggleMenu}
          data-testid="header-menu-toggle"
          className="inline-flex items-center justify-center rounded-lg p-2 text-slate-600 transition hover:bg-gray-100 hover:text-slate-900 md:hidden"
          aria-label="Toggle menu"
          aria-controls="mobile-menu"
          aria-expanded={menuOpen}
        >
          <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
          </svg>
        </button>
      </nav>

      {menuOpen ? (
        <div id="mobile-menu" className="border-t border-gray-200 bg-white/95 backdrop-blur-md md:hidden">
          <div className="mx-auto flex w-full max-w-none flex-col gap-1 px-4 py-4 sm:px-6 lg:px-8">
            <a
              href="#architects"
              onClick={onCloseMenu}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
            >
              For Architects
            </a>

            <a
              href="#businesses"
              onClick={onCloseMenu}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
            >
              For Businesses
            </a>

            <Link
              href="/marketplace"
              onClick={onCloseMenu}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
            >
              Marketplace
            </Link>

            <a
              href="#assessment"
              onClick={onCloseMenu}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
            >
              Pricing
            </a>

            <Link
              href="/about"
              onClick={onCloseMenu}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
            >
              About
            </Link>

            <a
              href="#footer"
              onClick={onCloseMenu}
              className="rounded-lg px-3 py-2.5 text-base font-medium text-slate-600 transition hover:bg-gray-100 hover:text-slate-900"
            >
              Docs
            </a>

            <div className="mt-3 flex flex-col gap-2 border-t border-gray-200 pt-4">
              <Link
                href="/business/login"
                onClick={onCloseMenu}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition hover:text-slate-900 lg:px-4"
              >
                Login
              </Link>

              <Link
                href="/assignment"
                onClick={onCloseMenu}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950 shadow-glow-sm transition hover:scale-[1.03] hover:bg-amber-400 hover:shadow-glow lg:px-4"
              >
                Get Started Free
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}