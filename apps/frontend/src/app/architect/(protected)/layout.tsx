import { ArchitectShell } from "@/components/architect/ui/architect-shell";

export default function ArchitectProtectedLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return <ArchitectShell>{children}</ArchitectShell>;
}