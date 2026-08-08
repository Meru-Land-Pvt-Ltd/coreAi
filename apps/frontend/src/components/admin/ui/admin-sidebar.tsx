"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import {
  Bot,
  Building2,
  CircleDollarSign,
  FileInput,
  Gauge,
  LifeBuoy,
  LogOut,
  KeyRound,
  Mail,
  MessageSquareText,
  Phone,
  ShieldCheck,
  Tags,
  UserRoundCog,
  X,
  type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { getAuthUser, logout, type AuthUser } from "@/lib/auth";

const TRIVERN_MARK = encodeURI("/triven.ai word logo transparent bg.PNG");

type AdminNavItem = {
  label: string;
  href: Route;
  icon: LucideIcon;
};

const NAV_GROUPS: Array<{ label: string; items: AdminNavItem[] }> = [
  {
    label: "Overview",
    items: [{ label: "Dashboard", href: "/admin/dashboard" as Route, icon: Gauge }]
  },
  {
    label: "Marketplace",
    items: [
      { label: "Businesses", href: "/admin/businesses" as Route, icon: Building2 },
      { label: "Architects", href: "/admin/architects" as Route, icon: UserRoundCog },
      { label: "Agent listings", href: "/admin/agents" as Route, icon: Bot },
      { label: "Payouts", href: "/admin/payout" as Route, icon: CircleDollarSign }
    ]
  },
  {
    label: "Operations",
    items: [
      { label: "Pricing", href: "/admin/pricing" as Route, icon: Tags },
      { label: "Phone numbers", href: "/admin/phone-numbers" as Route, icon: Phone },
      { label: "Mail", href: "/admin/mail" as Route, icon: Mail },
      { label: "Manage API", href: "/admin/manage-api" as Route, icon: KeyRound }
    ]
  },
  {
    label: "Requests",
    items: [
      { label: "Template requests", href: "/admin/templetrequests" as Route, icon: FileInput },
      { label: "Contact messages", href: "/admin/contactus" as Route, icon: MessageSquareText },
      { label: "Need help", href: "/admin/needhelp" as Route, icon: LifeBuoy }
    ]
  }
];

function isActive(pathname: string, href: Route) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function initials(user: AuthUser | null) {
  const value = user?.fullName || user?.email || "Admin";
  return value
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export function AdminSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    setUser(getAuthUser());
  }, []);

  return (
    <aside
      data-testid="admin-sidebar"
      aria-label="Admin navigation"
      className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-gray-200 bg-white transition-transform duration-200 lg:translate-x-0 ${
        open ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      <div className="flex h-20 items-center border-b border-gray-100 px-5">
        <Link href={"/admin/dashboard" as Route} onClick={onClose} className="flex min-w-0 items-center gap-3" aria-label="Trivern admin dashboard">
          <Image src={TRIVERN_MARK} alt="Trivern" width={38} height={38} priority className="h-10 w-10 shrink-0 object-contain" />
          <div className="min-w-0">
            <span className="block truncate text-lg font-extrabold text-slate-950" data-testid="admin-sidebar-brand">Triven.ai</span>
            <span className="block text-[10px] font-bold uppercase tracking-normal text-slate-400">Administration</span>
          </div>
        </Link>
        <button type="button" onClick={onClose} aria-label="Close navigation" className="ml-auto grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-gray-100 lg:hidden">
          <X className="h-5 w-5" />
        </button>
      </div>

      <nav className="nav-scroll flex-1 overflow-y-auto px-3 py-5">
        {NAV_GROUPS.map((group, index) => (
          <div key={group.label} className={index === 0 ? "" : "mt-6"}>
            <p className="mb-2 px-3 text-[11px] font-bold uppercase tracking-normal text-slate-400">{group.label}</p>
            <ul className="space-y-1">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href);
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={active ? "page" : undefined}
                      data-testid={`admin-sidebar-${item.label.toLowerCase().replaceAll(" ", "-")}`}
                      className={`group relative flex items-center gap-3 rounded-r-lg border-l-[3px] px-3 py-2.5 text-sm transition ${
                        active
                          ? "border-amber-500 bg-amber-50 font-semibold text-amber-800"
                          : "border-transparent font-medium text-slate-600 hover:bg-gray-50 hover:text-slate-950"
                      }`}
                    >
                      <Icon className={`h-[18px] w-[18px] ${active ? "text-amber-600" : "text-slate-400 group-hover:text-slate-600"}`} />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-gray-100 p-4">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-900 text-xs font-bold text-white">{initials(user)}</div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-900">{user?.fullName || "Administrator"}</p>
            <p className="truncate text-xs text-slate-500">{user?.email || "Trivern admin"}</p>
          </div>
          <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" aria-label="Administrator" />
        </div>
        <button
          type="button"
          data-testid="admin-sidebar-logout"
          onClick={logout}
          className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="h-4 w-4" />
          Logout
        </button>
      </div>
    </aside>
  );
}
