"use client";

import Image from "next/image";
import { Menu } from "lucide-react";
import { useState, type ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";

const TRIVEN_MARK = encodeURI("/triven.ai word logo transparent bg.PNG");

export function AdminShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

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

      <AdminSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="min-h-screen lg:pl-64">
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

        {/* ONE WHITE SHEET, NOT CARDS SCATTERED ON GREY.
            Every admin page sits on a single white surface. Boxes floating
            individually on the grey made the workspace read as a pile of
            fragments rather than one screen — and it had to be said page by
            page. Said once, here, and every admin page after this inherits it. */}
        <main className="admin-workspace w-full max-w-full px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="min-h-[calc(100vh-8rem)] rounded-2xl border border-gray-200 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.05)]">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
