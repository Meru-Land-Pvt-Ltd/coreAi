"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/architect/ui/architect-ui";
import { getAuthUser, logout, type AuthUser } from "@/lib/auth";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

type IconName = "dashboard" | "agents" | "builder" | "templates";

type NavItem = {
  label: string;
  href: Route;
  icon: IconName;
  matchPrefix: string;
};

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/architect/dashboard" as Route,
    icon: "dashboard",
    matchPrefix: "/architect/dashboard"
  },
  {
    label: "My Agents",
    href: "/architect/agents" as Route,
    icon: "agents",
    matchPrefix: "/architect/agents"
  },
  {
    label: "Agent Builder",
    href: "/architect/workflows" as Route,
    icon: "builder",
    matchPrefix: "/architect/workflows"
  },
  {
    label: "Template Gallery",
    href: "/architect/templets" as Route,
    icon: "templates",
    matchPrefix: "/architect/templets"
  }
];

function isActive(pathname: string, item: NavItem) {
  if (pathname === String(item.href)) return true;
  return pathname.startsWith(`${item.matchPrefix}/`) || pathname.startsWith(item.matchPrefix);
}

function getInitial(user: AuthUser | null) {
  const source = user?.fullName || user?.email || "A";
  return source.charAt(0).toUpperCase();
}

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = cn("h-5 w-5 shrink-0", className);

  if (name === "dashboard") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
      </svg>
    );
  }

  if (name === "agents") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="8" width="16" height="12" rx="2.5" />
        <path d="M12 8V4.5" />
        <circle cx="9" cy="14" r="1.1" />
        <circle cx="15" cy="14" r="1.1" />
        <path d="M4 13.5H2.5M21.5 13.5H20" />
      </svg>
    );
  }

  if (name === "builder") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2.5" />
        <path d="M12 8v8M8 12h8" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="7" rx="1.5" />
      <rect x="3" y="14" width="9" height="7" rx="1.5" />
      <rect x="16" y="14" width="5" height="7" rx="1.5" />
    </svg>
  );
}




function SidebarContent({
  user,
  pathname,
  onNavigate
}: {
  user: AuthUser | null;
  pathname: string;
  onNavigate?: () => void;


}) {

  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [pathname]);
  return (
    <>
      <div className="flex items-center gap-2.5 border-b border-gray-100 px-5 py-5">
        <Image
          src={TRIVEN_LOGO_SRC}
          alt="Triven"
          width={140}
          height={40}
          priority
          className="h-9 w-auto object-contain"
        />
        <span className="text-lg font-extrabold tracking-tight text-amber-500" data-testid="architect-sidebar-brand-text">
          Triven.ai
        </span>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li key={`${item.label}-${item.href}`}>
                <Link
                  data-testid={`architect-sidebar-nav-${item.icon}-link`}
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-amber-50 font-semibold text-amber-700"
                      : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-amber-500" />
                  ) : null}
                  <Icon name={item.icon} className={active ? "text-amber-600" : "text-slate-400 group-hover:text-slate-600"} />
                  <span className="min-w-0 flex-1 truncate" data-testid="architect-sidebar-nav-label-text">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-gray-100 p-3">
        <div className="relative flex items-center gap-3 rounded-xl p-2">
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-500 text-sm font-bold text-white"
            data-testid="architect-sidebar-initial-text"
          >
            {getInitial(user)}
          </span>

          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-semibold text-slate-900"
              data-testid="architect-sidebar-user-name-text"
            >
              {user?.fullName ?? "Architect"}
            </span>
          </span>

          <button
            data-testid="architect-sidebar-user-menu-trigger"
            type="button"
            aria-label="Open user menu"
            aria-expanded={profileMenuOpen}
            onClick={() => setProfileMenuOpen((open) => !open)}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="currentColor"
              aria-hidden="true"
            >
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>

          {profileMenuOpen ? (
            <div className="absolute bottom-full right-2 mb-2 w-36 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10">
              <button
                data-testid="architect-sidebar-logout"
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  logout();
                }}
                className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-slate-600 transition hover:bg-red-50 hover:text-red-600"
              >
                Logout
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

export function ArchitectSidebarShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // The workflow builder is fullscreen (fixed inset-0). Treat the unsaved builder
  // at /architect/workflows and every /architect/workflows/* route as builder so
  // the sidebar shell doesn't wrap/overlap it.
  const isBuilder =
    pathname === "/architect/workflows" || pathname.startsWith("/architect/workflows/");

  useEffect(() => {
    const authUser = getAuthUser();
    if (!authUser || authUser.role !== "ARCHITECT") {
      router.replace("/architect/login" as Route);
      return;
    }
    setUser(authUser);
    setReady(true);
  }, [router]);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-gray-50 text-slate-900">
        <div className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-bold shadow-sm">
          Checking architect session...
        </div>
      </main>
    );
  }

  if (isBuilder) {
    return <main className="min-h-screen bg-gray-50 text-slate-900">{children}</main>;
  }

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-gray-100 bg-white shadow-sm lg:flex">
        <SidebarContent user={user} pathname={pathname} />
      </aside>

      {mobileNavOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button
            data-testid="architect-sidebar-mobile-close"
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[84vw] flex-col bg-white shadow-2xl">
            <SidebarContent user={user} pathname={pathname} onNavigate={() => setMobileNavOpen(false)} />
          </aside>
        </div>
      ) : null}

      <button
        data-testid="architect-sidebar-mobile-open"
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="fixed bottom-4 left-4 z-30 grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-xl shadow-slate-900/10 lg:hidden"
        aria-label="Open navigation"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <div className="min-h-screen lg:pl-64">{children}</div>
    </div>
  );
}
