import type { ReactNode } from "react";
import { ArchitectSidebarShell } from "@/components/architect/ui/Sidebar";

export default function ArchitectProtectedLayout({
  children
}: {
  children: ReactNode;
}) {
  return <ArchitectSidebarShell>{children}</ArchitectSidebarShell>;
}
