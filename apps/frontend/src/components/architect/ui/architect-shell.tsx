"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { CoreMark, cn } from "@/components/architect/ui/architect-ui";
import { getAuthUser, logout, type AuthUser } from "@/lib/auth";

type IconName =
  | "agents"
  | "published"
  | "builder"
  | "plus"
  | "profile";

type NavItem = {
  label: string;
  href: Route;
  icon: IconName;
  matchPrefix?: string;
  excludePrefixes?: string[];
};

const navItems: NavItem[] = [
  {
    label: "My Agents",
    href: "/architect/agents" as Route,
    icon: "agents",
    matchPrefix: "/architect/agents",
    excludePrefixes: ["/architect/agents/published", "/architect/agents/publish"]
  },
  {
    label: "Published",
    href: "/architect/agents/published" as Route,
    icon: "published"
  },
  {
    label: "Agent",
    href: "/architect/workflows/new" as Route,
    icon: "plus"
  },
  {
    label: "Builder",
    href: "/architect/workflows" as Route,
    icon: "builder",
    matchPrefix: "/architect/workflows",
    excludePrefixes: ["/architect/workflows/new"]
  }
];

function isActive(pathname: string, item: NavItem) {
  if (pathname === String(item.href)) return true;
  if (!item.matchPrefix) return false;
  const isExcluded = item.excludePrefixes?.some((prefix) => pathname.startsWith(prefix));
  if (isExcluded) return false;
  return pathname.startsWith(item.matchPrefix);
}

function getInitial(user: AuthUser | null) {
  const source = user?.fullName || user?.email || "A";
  return source.charAt(0).toUpperCase();
}

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = cn("h-5 w-5 shrink-0", className);

  if (name === "agents") {
    return (
      <svg data-testid="components-architect-ui-architect-shell-svg-1" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect data-testid="components-architect-ui-architect-shell-rect-1" x="4" y="8" width="16" height="12" rx="2.5" />
        <path data-testid="components-architect-ui-architect-shell-path-1" d="M12 8V4.5" />
        <circle data-testid="components-architect-ui-architect-shell-circle-1" cx="9" cy="14" r="1.1" />
        <circle data-testid="components-architect-ui-architect-shell-circle-2" cx="15" cy="14" r="1.1" />
        <path data-testid="components-architect-ui-architect-shell-path-2" d="M4 13.5H2.5M21.5 13.5H20" />
      </svg>
    );
  }

  if (name === "published") {
    return (
      <svg data-testid="components-architect-ui-architect-shell-svg-2" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path data-testid="components-architect-ui-architect-shell-path-3" d="M6 2 3 6.5V20a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5L18 2Z" />
        <path data-testid="components-architect-ui-architect-shell-path-4" d="M3 6.5h18" />
        <path data-testid="components-architect-ui-architect-shell-path-5" d="M16 10.5a4 4 0 0 1-8 0" />
      </svg>
    );
  }

  if (name === "builder") {
    return (
      <svg data-testid="components-architect-ui-architect-shell-svg-3" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect data-testid="components-architect-ui-architect-shell-rect-2" x="3" y="3" width="6" height="6" rx="1.6" />
        <rect data-testid="components-architect-ui-architect-shell-rect-3" x="15" y="15" width="6" height="6" rx="1.6" />
        <path data-testid="components-architect-ui-architect-shell-path-6" d="M9 6h3.5A2.5 2.5 0 0 1 15 8.5V15" />
      </svg>
    );
  }

  if (name === "plus") {
    return (
      <svg data-testid="components-architect-ui-architect-shell-svg-4" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <path data-testid="components-architect-ui-architect-shell-path-7" d="M12 5v14M5 12h14" />
      </svg>
    );
  }

  if (name === "profile") {
    return (
      <svg data-testid="components-architect-ui-architect-shell-svg-5" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path data-testid="components-architect-ui-architect-shell-path-8" d="M20 21a8 8 0 0 0-16 0" />
        <circle data-testid="components-architect-ui-architect-shell-circle-3" cx="12" cy="8" r="4" />
      </svg>
    );
  }

  return (
    <svg data-testid="components-architect-ui-architect-shell-svg-6" viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle data-testid="components-architect-ui-architect-shell-circle-4" cx="12" cy="12" r="3" />
      <path data-testid="components-architect-ui-architect-shell-path-9" d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  );
}

function ProfileMenu({ user, open, onToggle }: { user: AuthUser | null; open: boolean; onToggle: () => void }) {
  return (
    <div data-testid="components-architect-ui-architect-shell-div-1" className="relative">
      <button data-testid="components-architect-ui-architect-shell-button-1"
        type="button"
        onClick={onToggle}
        className="grid h-10 w-10 place-items-center rounded-full bg-amber-500 text-sm font-black text-white shadow-sm ring-2 ring-white transition hover:scale-[1.03]"
        aria-label="Open profile menu"
      >
        {getInitial(user)}
      </button>

      {open ? (
        <div data-testid="components-architect-ui-architect-shell-div-2" className="absolute bottom-12 left-0 z-50 w-64 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl shadow-slate-900/10 lg:bottom-auto lg:left-auto lg:right-0 lg:top-12">
          <div data-testid="components-architect-ui-architect-shell-div-3" className="border-b border-slate-100 px-3 py-3">
            <p data-testid="components-architect-ui-architect-shell-p-1" className="truncate text-sm font-black text-slate-950">{user?.fullName ?? "Architect"}</p>
            <p data-testid="components-architect-ui-architect-shell-p-2" className="truncate text-xs font-semibold text-slate-500">{user?.email}</p>
            <span data-testid="components-architect-ui-architect-shell-span-1" className="mt-2 inline-flex rounded-full bg-amber-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-amber-700">
              Architect Studio
            </span>
          </div>
          <Link data-testid="components-architect-ui-architect-shell-link-1" href={"/architect/profile" as Route} className="mt-2 flex rounded-xl px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-amber-50 hover:text-amber-700">
            Profile
          </Link>
          <button data-testid="components-architect-ui-architect-shell-button-2"
            type="button"
            onClick={logout}
            className="flex w-full rounded-xl px-3 py-2 text-left text-sm font-bold text-red-600 transition hover:bg-red-50"
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SidebarContent({
  user,
  pathname,
  profileMenuOpen,
  onProfileToggle,
  onNavigate
}: {
  user: AuthUser | null;
  pathname: string;
  profileMenuOpen: boolean;
  onProfileToggle: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div data-testid="components-architect-ui-architect-shell-div-4" className="flex items-center gap-2.5 px-5 py-5">
        <CoreMark />
        <div data-testid="components-architect-ui-architect-shell-div-5">
          <span data-testid="components-architect-ui-architect-shell-span-2" className="block text-lg font-black tracking-tight text-slate-950">CORE</span>
          <span data-testid="components-architect-ui-architect-shell-span-3" className="block text-[10px] font-extrabold uppercase tracking-[0.22em] text-slate-400">Architect Studio</span>
        </div>
      </div>

      <nav data-testid="components-architect-ui-architect-shell-nav-1" className="flex-1 overflow-y-auto px-3 py-3">
        <p data-testid="components-architect-ui-architect-shell-p-3" className="mb-2 px-3 text-xs font-extrabold uppercase tracking-wider text-slate-400">
          Studio
        </p>
        <ul data-testid="components-architect-ui-architect-shell-ul-1" className="space-y-1">
          {navItems.map((item) => {
            const active = isActive(pathname, item);
            return (
              <li data-testid="components-architect-ui-architect-shell-li-1" key={`${item.label}-${item.href}`}>
                <Link data-testid="components-architect-ui-architect-shell-link-2"
                  href={item.href}
                  onClick={onNavigate}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition",
                    active
                      ? "bg-amber-50 font-extrabold text-amber-700"
                      : "font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  )}
                >
                  {active ? <span data-testid="components-architect-ui-architect-shell-span-4" className="absolute -left-3 top-1/2 h-6 w-1 -translate-y-1/2 rounded-r-full bg-amber-500" /> : null}
                  <Icon name={item.icon} className={active ? "text-amber-600" : "text-slate-400 group-hover:text-slate-600"} />
                  <span data-testid="components-architect-ui-architect-shell-span-5" className="min-w-0 flex-1 truncate">{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div data-testid="components-architect-ui-architect-shell-div-6" className="border-t border-slate-100 p-4">
        <div data-testid="components-architect-ui-architect-shell-div-7" className="mb-3 rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 p-3">
          <p data-testid="components-architect-ui-architect-shell-p-4" className="text-sm font-black text-amber-800">First build</p>
          <p data-testid="components-architect-ui-architect-shell-p-5" className="mt-1 text-[11px] font-semibold leading-5 text-amber-700/75">
            Missed Call Text-Back agent for Twilio + SMS.
          </p>
        </div>
        <div data-testid="components-architect-ui-architect-shell-div-8" className="flex items-center justify-between gap-3">
          <ProfileMenu user={user} open={profileMenuOpen} onToggle={onProfileToggle} />
          <button data-testid="components-architect-ui-architect-shell-button-3"
            type="button"
            onClick={logout}
            className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-black text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
          >
            Logout
          </button>
        </div>
      </div>
    </>
  );
}

export function ArchitectShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const isBuilder = pathname.includes("/builder");

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
    setProfileMenuOpen(false);
    setMobileNavOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <main data-testid="components-architect-ui-architect-shell-main-1" className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-900">
        <div data-testid="components-architect-ui-architect-shell-div-9" className="rounded-2xl border border-slate-200 bg-white px-6 py-4 text-sm font-bold shadow-sm">
          Checking architect session...
        </div>
      </main>
    );
  }

  if (isBuilder) {
    return <main data-testid="components-architect-ui-architect-shell-main-2" className="min-h-screen bg-slate-50 text-slate-900">{children}</main>;
  }

  return (
    <main data-testid="components-architect-ui-architect-shell-main-3" className="min-h-screen bg-slate-50 text-slate-900">
      <aside data-testid="components-architect-ui-architect-shell-aside-1" className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r border-slate-200 bg-white shadow-sm lg:flex">
        <SidebarContent
          user={user}
          pathname={pathname}
          profileMenuOpen={profileMenuOpen}
          onProfileToggle={() => setProfileMenuOpen((current) => !current)}
        />
      </aside>

      {mobileNavOpen ? (
        <div data-testid="components-architect-ui-architect-shell-div-10" className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true">
          <button data-testid="components-architect-ui-architect-shell-button-4"
            type="button"
            aria-label="Close navigation"
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm"
            onClick={() => setMobileNavOpen(false)}
          />
          <aside data-testid="components-architect-ui-architect-shell-aside-2" className="relative flex h-full w-72 max-w-[84vw] flex-col bg-white shadow-2xl">
            <SidebarContent
              user={user}
              pathname={pathname}
              profileMenuOpen={profileMenuOpen}
              onProfileToggle={() => setProfileMenuOpen((current) => !current)}
              onNavigate={() => setMobileNavOpen(false)}
            />
          </aside>
        </div>
      ) : null}

      <button data-testid="components-architect-ui-architect-shell-button-5"
        type="button"
        onClick={() => setMobileNavOpen(true)}
        className="fixed bottom-4 left-4 z-30 grid h-12 w-12 place-items-center rounded-2xl border border-slate-200 bg-white text-slate-700 shadow-xl shadow-slate-900/10 lg:hidden"
        aria-label="Open navigation"
      >
        <svg data-testid="components-architect-ui-architect-shell-svg-7" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path data-testid="components-architect-ui-architect-shell-path-10" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      <section data-testid="components-architect-ui-architect-shell-section-1" className="min-h-screen lg:pl-64">
        <div data-testid="components-architect-ui-architect-shell-div-11" className="w-full px-4 py-4 sm:px-6 sm:py-6 lg:px-8 xl:px-10">{children}</div>
      </section>
    </main>
  );
}
