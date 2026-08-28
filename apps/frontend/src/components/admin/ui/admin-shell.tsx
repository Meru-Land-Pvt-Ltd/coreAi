"use client";

import Image from "next/image";
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";
import { SidebarCollapseButton, useSidebarCollapsed } from "@/lib/sidebar-collapse";

const TRIVEN_MARK = encodeURI("/triven.ai word logo transparent bg.PNG");

export function AdminShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* THE MENU FOLDS AWAY. A fixed 256 pixels of navigation an admin is not
     reading, on every screen. One shared control, three shells — see
     lib/sidebar-collapse. */
  const { collapsed, toggle } = useSidebarCollapsed("admin");

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      {sidebarOpen ? (
        <button
          type="button"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-40 bg-slate-950/35 backdrop-blur-[1px] lg:hidden"
        />
      ) : null}

      <div className={collapsed ? "lg:hidden" : undefined}>
        <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      </div>

      <div className={`min-h-screen transition-[padding] duration-200 ${collapsed ? "lg:pl-0" : "lg:pl-64"}`}>
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-4 backdrop-blur lg:hidden">
          <button
            type="button"
            aria-label="Open navigation"
            onClick={() => setSidebarOpen(true)}
            className="grid h-10 w-10 place-items-center rounded-lg text-slate-500 transition hover:bg-gray-100 hover:text-slate-900"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <Image src={TRIVEN_MARK} alt="Triven" width={32} height={32} className="h-8 w-8 object-contain" />
            <span className="text-sm font-bold text-slate-900">Triven Admin</span>
          </div>
          <span className="h-10 w-10" aria-hidden="true" />
        </header>

        <main className="admin-workspace w-full max-w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-4 hidden lg:block">
            <SidebarCollapseButton collapsed={collapsed} onToggle={toggle} shell="admin" />
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}
