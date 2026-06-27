import type { ReactNode } from "react";
import { AdminSidebar } from "./admin-sidebar";

export function AdminShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fffaf3] md:flex-row">
      <AdminSidebar />
      <main className="flex-1 p-5 sm:p-8">{children}</main>
    </div>
  );
}
