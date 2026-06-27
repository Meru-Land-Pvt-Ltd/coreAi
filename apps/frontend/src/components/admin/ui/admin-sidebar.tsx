"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/auth";

const LINKS: { label: string; href: Route }[] = [
  { label: "Dashboard", href: "/admin/dashboard" as Route },
  { label: "Businesses", href: "/admin/businesses" as Route },
  { label: "Architects", href: "/admin/architects" as Route },
  { label: "Agents", href: "/admin/agents" as Route }
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside
      data-testid="admin-sidebar"
      className="flex shrink-0 flex-col gap-6 border-b border-orange-100 bg-white p-4 md:h-screen md:w-60 md:border-b-0 md:border-r"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500">
          <span className="h-3 w-3 rounded-full bg-white" />
        </span>
        <span className="text-lg font-extrabold tracking-tight text-slate-900" data-testid="admin-sidebar-brand">
          CORE Admin
        </span>
      </div>

      <nav className="flex flex-1 flex-row flex-wrap gap-2 md:flex-col">
        {LINKS.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              data-testid={`admin-sidebar-${link.label.toLowerCase()}`}
              className={
                active
                  ? "rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white"
                  : "rounded-xl border border-orange-100 px-4 py-2 text-sm font-semibold text-orange-900 transition hover:border-orange-300 hover:bg-orange-50"
              }
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        data-testid="admin-sidebar-logout"
        onClick={logout}
        className="rounded-xl border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-800 transition hover:border-orange-400 hover:bg-orange-50"
      >
        Logout
      </button>
    </aside>
  );
}
