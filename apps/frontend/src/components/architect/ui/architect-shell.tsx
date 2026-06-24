"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { getAuthUser, logout, type AuthUser } from "@/lib/auth";

type IconName = "agents" | "published" | "plus" | "builder";

type NavItem = {
  label: string;
  pageTitle: string;
  href: Route;
  icon: IconName;
  matchPrefix?: string;
  excludePrefixes?: string[];
};

const navItems: NavItem[] = [

  {
    label: "Agent",
    pageTitle: "New Agent",
    href: "/architect/workflows/new",
    icon: "plus"
  },
  {
    label: "My Agents",
    pageTitle: "My Agents",
    href: "/architect/agents",
    icon: "agents",
    matchPrefix: "/architect/agents",
    excludePrefixes: ["/architect/agents/published", "/architect/agents/publish"]
  },
  {
    label: "Published",
    pageTitle: "Published Agents",
    href: "/architect/agents/published",
    icon: "published"
  },
  {
    label: "Builder",
    pageTitle: "Workflow Builder",
    href: "/architect/workflows",
    icon: "builder",
    matchPrefix: "/architect/workflows",
    excludePrefixes: ["/architect/workflows/new"]
  },
  // {
  //   label: "Projects",
  //   pageTitle: "Open Projects",
  //   href: "/architect/projects",
  //   icon: "projects"
  // }
];

function isActive(pathname: string, item: NavItem) {
  if (pathname === String(item.href)) {
    return true;
  }

  if (!item.matchPrefix) {
    return false;
  }

  const isExcluded = item.excludePrefixes?.some((prefix) => pathname.startsWith(prefix));

  if (isExcluded) {
    return false;
  }

  return pathname.startsWith(item.matchPrefix);
}

function getCurrentPage(pathname: string) {
  if (pathname === "/architect/profile") return "Profile";
  if (pathname === "/architect/agents/publish") return "Publish Agent";

  const activeItem = navItems.find((item) => isActive(pathname, item));
  return activeItem?.pageTitle ?? "My Agents";
}

function getInitial(user: AuthUser | null) {
  const source = user?.fullName || user?.email || "A";
  return source.charAt(0).toUpperCase();
}

function IconBox({
  active,
  isCreate,
  children
}: {
  active: boolean;
  isCreate?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex h-10 w-10 items-center justify-center rounded-2xl transition ${isCreate
        ? "bg-gradient-to-br from-orange-500 to-yellow-400 text-white shadow-sm shadow-orange-200"
        : active
          ? "bg-orange-100 text-orange-700"
          : "text-orange-700 group-hover:bg-yellow-50"
        }`}
    >
      {children}
    </span>
  );
}

function NavIcon({ name, active }: { name: IconName; active: boolean }) {
  const common = "h-5 w-5";

  if (name === "agents") {
    return (
      <IconBox active={active}>
        <svg className={common} viewBox="0 0 24 24" fill="none">
          <path
            d="M7.2 9.8h9.6A3.2 3.2 0 0 1 20 13v3.4a3.2 3.2 0 0 1-3.2 3.2H7.2A3.2 3.2 0 0 1 4 16.4V13a3.2 3.2 0 0 1 3.2-3.2Z"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M8.5 9.8V7.9a3.5 3.5 0 0 1 7 0v1.9"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M9 15h.01M15 15h.01"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </svg>
      </IconBox>
    );
  }

  if (name === "published") {
    return (
      <IconBox active={active}>
        <svg className={common} viewBox="0 0 24 24" fill="none">
          <path
            d="M5 12.2 10.2 17 19 7"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M12 21a9 9 0 1 1 7.8-4.5"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </IconBox>
    );
  }

  if (name === "plus") {
    return (
      <IconBox active={active} isCreate>
        <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none">
          <path
            d="M12 5v14M5 12h14"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </IconBox>
    );
  }

  if (name === "builder") {
    return (
      <IconBox active={active}>
        <svg className={common} viewBox="0 0 24 24" fill="none">
          <rect
            x="4"
            y="5"
            width="6"
            height="6"
            rx="1.6"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <rect
            x="14"
            y="13"
            width="6"
            height="6"
            rx="1.6"
            stroke="currentColor"
            strokeWidth="1.7"
          />
          <path
            d="M10 8h2.5A3.5 3.5 0 0 1 16 11.5V13"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </IconBox>
    );
  }

  return (
    <IconBox active={active}>
      <svg className={common} viewBox="0 0 24 24" fill="none">
        <path
          d="M4 7.8A2.2 2.2 0 0 1 6.2 5.6h3.1l1.5 1.8h7A2.2 2.2 0 0 1 20 9.6v7.8a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 17.4V7.8Z"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinejoin="round"
        />
      </svg>
    </IconBox>
  );
}

function ProfileMenu({
  user,
  open,
  onToggle
}: {
  user: AuthUser | null;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-orange-500 to-yellow-400 text-sm font-black text-white shadow-sm shadow-orange-200 transition hover:scale-[1.03]"
        aria-label="Open profile menu"
      >
        {getInitial(user)}
      </button>

      {open ? (
        <div className="absolute bottom-14 left-1/2 z-50 w-52 -translate-x-1/2 rounded-2xl border border-orange-100 bg-white p-2 shadow-xl shadow-orange-950/10 lg:left-full lg:bottom-0 lg:ml-3 lg:translate-x-0">
          <div className="border-b border-orange-100 px-3 py-2">
            <p className="truncate text-sm font-black text-orange-950">
              {user?.fullName ?? "Architect"}
            </p>
            <p className="truncate text-xs font-semibold text-orange-800/60">
              {user?.email}
            </p>
          </div>

          <Link
            href="/architect/profile"
            className="mt-2 flex rounded-xl px-3 py-2 text-sm font-black text-orange-900 transition hover:bg-yellow-50"
          >
            Profile
          </Link>

          <button
            type="button"
            onClick={logout}
            className="flex w-full rounded-xl px-3 py-2 text-left text-sm font-black text-red-600 transition hover:bg-red-50"
          >
            Logout
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function ArchitectShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  const currentPage = getCurrentPage(pathname);

  useEffect(() => {
    const authUser = getAuthUser();

    if (!authUser || authUser.role !== "ARCHITECT") {
      router.replace("/architect/login");
      return;
    }

    setUser(authUser);
    setReady(true);
  }, [router]);

  useEffect(() => {
    setProfileMenuOpen(false);
  }, [pathname]);

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] text-orange-950">
        <div className="rounded-2xl border border-orange-100 bg-white px-6 py-4 text-sm font-bold shadow-sm">
          Checking architect session...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff8ef] text-orange-950">
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-20 border-r border-orange-100 bg-white shadow-sm lg:flex lg:flex-col lg:items-center lg:py-4">
        <nav className="flex w-full flex-1 flex-col items-center gap-2 overflow-y-auto px-2">
          {navItems.map((item) => {
            const active = isActive(pathname, item);

            return (
              <Link
                key={`${item.label}-${item.href}`}
                href={item.href}
                className="group flex w-full flex-col items-center justify-center rounded-2xl px-1 py-2 text-center transition hover:bg-yellow-50"
              >
                <NavIcon name={item.icon} active={active} />

                <span
                  className={`mt-1 text-[10px] font-semibold leading-4 ${active ? "text-orange-700" : "text-orange-900"
                    }`}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="relative mb-2">
          <ProfileMenu
            user={user}
            open={profileMenuOpen}
            onToggle={() => setProfileMenuOpen((current) => !current)}
          />
        </div>
      </aside>

      <section className="min-h-screen lg:pl-20">
        <header className="sticky top-0 z-30 border-b border-orange-100 bg-white px-5 py-3 shadow-sm">
          <div className="flex w-full items-center justify-between gap-4">
            <div>
              <p className="text-[11px] font-black uppercase tracking-[0.22em] text-orange-500">
                AI Architect
              </p>
              <h2 className="text-xl font-black text-orange-950 md:text-2xl">
                {currentPage}
              </h2>
            </div>

            <div className="lg:hidden">
              <ProfileMenu
                user={user}
                open={profileMenuOpen}
                onToggle={() => setProfileMenuOpen((current) => !current)}
              />
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {navItems.map((item) => {
              const active = isActive(pathname, item);

              return (
                <Link
                  key={`${item.label}-mobile-${item.href}`}
                  href={item.href}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-black ${active
                    ? "bg-orange-500 text-white"
                    : "bg-yellow-50 text-orange-700"
                    }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>

        <div className="w-full px-5 py-6">{children}</div>
      </section>
    </main>
  );
}