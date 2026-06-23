"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getAuthUser, logout, type AuthUser } from "@/lib/auth";

type NavItem = {
  label: string;
  href: Route;
  matchPrefix?: string;
  excludePrefixes?: string[];
};

type NavSection = {
  title: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    title: "Workspace",
    items: [
      {
        label: "Dashboard",
        href: "/architect/dashboard"
      },
      {
        label: "Profile",
        href: "/architect/profile"
      }
    ]
  },
  {
    title: "Workflows",
    items: [
      {
        label: "All Workflows",
        href: "/architect/workflows",
        matchPrefix: "/architect/workflows",
        excludePrefixes: ["/architect/workflows/new"]
      },
      {
        label: "Create Workflow",
        href: "/architect/workflows/new"
      }
    ]
  },
  {
    title: "Marketplace",
    items: [
      {
        label: "Listings",
        href: "/architect/listings",
        matchPrefix: "/architect/listings",
        excludePrefixes: ["/architect/listings/new"]
      },
      {
        label: "Create Listing",
        href: "/architect/listings/new"
      }
    ]
  },
  {
    title: "Projects",
    items: [
      {
        label: "Open Projects",
        href: "/architect/projects"
      },
      {
        label: "My Proposals",
        href: "/architect/proposals"
      }
    ]
  }
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
  for (const section of navSections) {
    for (const item of section.items) {
      if (isActive(pathname, item)) {
        return item.label;
      }
    }
  }

  return "Architect";
}

export function ArchitectShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  const mobileItems = navSections.flatMap((section) => section.items);
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

  if (!ready) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] text-orange-950">
        <div className="rounded-3xl border border-orange-100 bg-white px-6 py-4 text-sm font-bold shadow-sm">
          Checking architect session...
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#fff8ef] text-orange-950">
      <aside className="fixed left-0 top-0 hidden h-screen w-72 border-r border-orange-100 bg-white p-5 shadow-sm lg:block">
        <Link href="/architect/dashboard" className="flex items-center gap-3">
          <div className="brand-ring" />
          <div>
            <h1 className="text-lg font-black leading-5">CoreAI</h1>
            <p className="text-xs font-semibold text-orange-700/70">Architect Panel</p>
          </div>
        </Link>

        <nav className="mt-8 space-y-6">
          {navSections.map((section) => (
            <div key={section.title}>
              <p className="mb-2 px-3 text-xs font-black uppercase tracking-[0.18em] text-orange-500">
                {section.title}
              </p>

              <div className="space-y-1">
                {section.items.map((item) => {
                  const active = isActive(pathname, item);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`block rounded-2xl px-4 py-3 text-sm font-black transition ${
                        active
                          ? "bg-orange-500 text-white shadow-md shadow-orange-200"
                          : "text-orange-900 hover:bg-orange-50"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="absolute bottom-5 left-5 right-5 rounded-3xl border border-orange-100 bg-orange-50 p-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-600">
            Account
          </p>

          <p className="mt-2 truncate text-sm font-black">{user?.fullName ?? "Architect"}</p>
          <p className="mt-1 truncate text-xs font-semibold text-orange-700/70">{user?.email}</p>

          <button
            onClick={logout}
            className="mt-4 w-full rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800 hover:border-orange-400"
          >
            Logout
          </button>
        </div>
      </aside>

      <section className="lg:pl-72">
        <header className="sticky top-0 z-30 border-b border-orange-100 bg-[#fff8ef]/90 px-5 py-4 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.22em] text-orange-600">
                AI Architect
              </p>
              <h2 className="text-xl font-black text-orange-950 md:text-2xl">
                {currentPage}
              </h2>
            </div>

            <button
              onClick={logout}
              className="rounded-full border border-orange-200 bg-white px-4 py-2 text-sm font-black text-orange-800 lg:hidden"
            >
              Logout
            </button>
          </div>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            {mobileItems.map((item) => {
              const active = isActive(pathname, item);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-black ${
                    active ? "bg-orange-500 text-white" : "bg-white text-orange-800"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </header>

        <div className="mx-auto max-w-7xl px-5 py-6">{children}</div>
      </section>
    </main>
  );
}