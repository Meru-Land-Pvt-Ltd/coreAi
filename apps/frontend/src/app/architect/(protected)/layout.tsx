import type { ReactNode } from "react";
import { ArchitectShell } from "@/components/architect/ui/architect-shell";

export default function ArchitectProtectedLayout({
  children
}: {
  children: ReactNode;
}) {
  return <ArchitectShell>{children}</ArchitectShell>;
}
