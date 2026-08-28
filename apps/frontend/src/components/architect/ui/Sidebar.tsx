"use client";

import Image from "next/image";
import { SidebarCollapseButton, useSidebarCollapsed } from "@/lib/sidebar-collapse";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/components/architect/ui/architect-ui";
import { ProfileAvatar } from "@/components/architect/ui/profile-avatar";
import {
  AUTH_USER_UPDATED_EVENT,
  getAuthUser,
  hasAuthRole,
  logout,
  setActiveWorkspace,
  type AuthUser
} from "@/lib/auth";
import { ARCHITECT_SETTINGS_PATH } from "@/lib/routes";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

type IconName = "dashboard" | "agents" | "builder" | "templates" | "payouts" | "settings" | "docs";

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
  },
  {
    label: "Payouts",
    href: "/architect/payouts" as Route,
    icon: "payouts",
    matchPrefix: "/architect/payouts"
  },
  {
    /* THE DOCUMENTATION (the founder's ruling, 2026-08-27): most architects
       build by hand, and until today the platform had no reference at all. */
    label: "Docs",
    href: "/architect/docs" as Route,
    icon: "docs",
    matchPrefix: "/architect/docs"
  },
  {
    label: "Settings",
    href: ARCHITECT_SETTINGS_PATH,
    icon: "settings",
    matchPrefix: "/architect/settings"
  }
];

function isActive(pathname: string, item: NavItem) {
  if (pathname === String(item.href)) return true;
  return pathname.startsWith(`${item.matchPrefix}/`) || pathname.startsWith(item.matchPrefix);
}

function getInitials(user: AuthUser | null) {
  const source = user?.fullName || user?.email || "A";
  return source
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";
}

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const common = cn("h-5 w-5 shrink-0", className);

  if (name === "docs") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    );
  }

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

  if (name === "payouts") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        <path d="M21 12a2 2 0 0 0-2-2h-4a2 2 0 0 0 0 4h4a2 2 0 0 0 2-2Z" />
      </svg>
    );
  }

  if (name === "settings") {
    return (
      <svg viewBox="0 0 24 24" className={common} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
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
  onNavigate,
  showMobileClose,
  onMobileClose,
  rail = false
}: {
  user: AuthUser | null;
  pathname: string;
  onNavigate?: () => void;
  showMobileClose?: boolean;
  onMobileClose?: () => void;
  /** Collapsed to the icon rail: same menu, 64px wide, names on hover. */
  rail?: boolean;
}) {
  return (
    <>
      <div className={cn("flex min-w-0 items-center border-b border-gray-100 py-5", rail ? "justify-center px-0" : "gap-0.5 px-5")}>
        <Image
          src={TRIVEN_LOGO_SRC}
          alt="Triven"
          width={36}
          height={36}
          priority
          className="h-9 w-9 shrink-0 object-contain"
        />
        {rail ? null : (
          <span className="truncate text-lg font-extrabold tracking-tight text-amber-500" data-testid="architect-sidebar-brand-text">
            Triven.ai
          </span>
        )}

        {showMobileClose ? (
          <button
            type="button"
            onClick={onMobileClose}
            data-testid="architect-sidebar-mobile-close-button"
            className="ml-auto shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-gray-50 lg:hidden"
            aria-label="Close menu"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M18 6 6 18" />
              <path d="M6 6l12 12" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* COLLAPSED IS A RAIL, NOT A DISAPPEARANCE. Hiding the menu takes the
          navigation away with the width; a rail keeps every destination one
          click from the eye and gives back 192 of the 256 pixels. The label
          rides on the title attribute so a name is always a hover away. */}
      <nav className={cn("flex-1 overflow-y-auto py-4", rail ? "px-2" : "px-3")}>
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
                  title={rail ? item.label : undefined}
                  className={cn(
                    "group relative flex items-center rounded-lg text-sm transition",
                    rail ? "justify-center px-0 py-2.5" : "gap-3 px-3 py-2.5",
                    active
                      ? "bg-amber-50 font-semibold text-amber-700"
                      : "font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  {active ? (
                    <span className="absolute inset-y-1.5 left-0 w-1 rounded-r-full bg-amber-500" />
                  ) : null}
                  <Icon name={item.icon} className={active ? "text-amber-600" : "text-slate-400 group-hover:text-slate-600"} />
                  {rail ? null : (
                    <span className="min-w-0 flex-1 truncate" data-testid="architect-sidebar-nav-label-text">{item.label}</span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="border-t border-gray-100 p-3">
        <div className="relative flex items-center gap-3 rounded-xl p-2">
          <ProfileAvatar
            photoUrl={user?.profilePhotoUrl}
            initials={getInitials(user)}
            className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-amber-500 text-sm font-bold text-white"
            imageClassName="h-full w-full object-cover"
            testId="architect-sidebar-profile-avatar"
          />

          <span className="min-w-0 flex-1">
            <span
              className="block truncate text-sm font-semibold text-slate-900"
              data-testid="architect-sidebar-user-name-text"
            >
              {user?.fullName ?? "Architect"}
            </span>
          </span>

          <button
            data-testid="architect-sidebar-logout"
            type="button"
            aria-label="Logout"
            title="Logout"
            onClick={logout}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
          >
            <svg
              viewBox="0 0 24 24"
              className="h-5 w-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
          </button>
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
  const { collapsed, toggle } = useSidebarCollapsed("architect");
  // The workflow builder is fullscreen (fixed inset-0). Treat the unsaved builder
  // at /architect/workflows and every /architect/workflows/* route as builder so
  // the sidebar shell doesn't wrap/overlap it.
  const isBuilder =
    pathname === "/architect/workflows" || pathname.startsWith("/architect/workflows/");

  useEffect(() => {
    const authUser = getAuthUser();
    // Capability check: a dual-role account (ARCHITECT + BUSINESS) keeps
    // architect access no matter which legacy role its row carries.
    if (!authUser || !hasAuthRole(authUser, "ARCHITECT")) {
      router.replace("/architect/login" as Route);
      return;
    }
    setActiveWorkspace("ARCHITECT");
    setUser(authUser);
    setReady(true);
  }, [router]);

  useEffect(() => {
    function refreshUser() {
      setUser(getAuthUser());
    }

    window.addEventListener(AUTH_USER_UPDATED_EVENT, refreshUser);
    window.addEventListener("storage", refreshUser);
    return () => {
      window.removeEventListener(AUTH_USER_UPDATED_EVENT, refreshUser);
      window.removeEventListener("storage", refreshUser);
    };
  }, []);

  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

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
      {/* THE MENU FOLDS AWAY. On the builder canvas 256 pixels of navigation
          is 256 pixels of working space. One shared control, three shells —
          see lib/sidebar-collapse. */}
      {/* COLLAPSED IS A RAIL, NOT A DISAPPEARANCE. Hiding the menu took the
          navigation away along with the width. A rail keeps every destination
          one click from the eye and still gives back 192 of the 256 pixels —
          which on a builder canvas is the whole point. */}
      <aside
        data-testid="architect-sidebar"
        className={cn(
          "fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-gray-100 bg-white shadow-sm transition-[width] duration-200 lg:flex",
          collapsed ? "w-16" : "w-64"
        )}
      >
        <SidebarContent user={user} pathname={pathname} rail={collapsed} />

        {/* On the sidebar's own edge, half on and half off — so it is never
            buried under a page's top strip, which is exactly where the first
            attempt put it on the builder. */}
        <button
          type="button"
          onClick={toggle}
          data-testid="architect-sidebar-toggle"
          aria-label={collapsed ? "Show the menu" : "Hide the menu"}
          aria-pressed={collapsed}
          title={collapsed ? "Show the menu" : "Hide the menu"}
          className="absolute -right-3 top-20 z-50 hidden h-6 w-6 place-items-center rounded-full border border-gray-200 bg-white text-slate-400 shadow-sm transition hover:text-slate-700 lg:grid"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
            <polyline points={collapsed ? "9,6 15,12 9,18" : "15,6 9,12 15,18"} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>

      {mobileNavOpen ? (
        <button
          type="button"
          aria-label="Close menu overlay"
          data-testid="architect-sidebar-overlay"
          className="fixed inset-0 z-40 bg-slate-900/50 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}

      {mobileNavOpen ? (
        <aside className="fixed inset-y-0 left-0 z-50 flex h-screen w-72 max-w-[84vw] flex-col border-r border-gray-100 bg-white shadow-2xl transition-transform duration-300 ease-out will-change-transform lg:hidden">
          <SidebarContent
            user={user}
            pathname={pathname}
            onNavigate={() => setMobileNavOpen(false)}
            showMobileClose
            onMobileClose={() => setMobileNavOpen(false)}
          />
        </aside>
      ) : null}

      {/* Avoid z-index here — it traps fixed modals under the sidebar. */}
      <div className={`relative min-h-screen transition-[padding] duration-200 ${collapsed ? "lg:pl-16" : "lg:pl-64"}`}>
        <div className="fixed left-0 right-0 top-0 z-30 flex h-14 items-center justify-between border-b border-gray-100 bg-gray-50 px-5 lg:hidden">
          {!mobileNavOpen ? (
            <button
              type="button"
              onClick={() => setMobileNavOpen(true)}
              data-testid="architect-sidebar-mobile-open"
              className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
              aria-label="Open menu"
            >
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          ) : (
            <span className="h-10 w-10" aria-hidden="true" />
          )}

          <div className="flex min-w-0 items-center gap-0.5" data-testid="architect-sidebar-mobile-brand">
            <Image
              src={TRIVEN_LOGO_SRC}
              alt="Triven"
              width={36}
              height={36}
              priority
              className="h-9 w-9 shrink-0 object-contain"
            />
            <span className="truncate text-xl font-extrabold tracking-tight text-amber-500" data-testid="architect-sidebar-mobile-brand-text">
              Triven.ai
            </span>
          </div>
        </div>

        <div className="pt-14 lg:pt-0">{children}</div>
      </div>
    </div>
  );
}
