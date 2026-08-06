import type { ReactNode } from "react";
import type { Metadata } from "next";
import { sectionMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = sectionMetadata({
  section: "Architect",
  description: "Build, test, and publish AI agents on Triven.ai.",
  path: "/architect"
});

export default function ArchitectSectionLayout({ children }: { children: ReactNode }) {
  return children;
}
