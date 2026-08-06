import type { ReactNode } from "react";
import type { Metadata } from "next";
import { sectionMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = sectionMetadata({
  section: "Business",
  description: "Discover, install, and manage AI agents for your business on Triven.ai.",
  path: "/business"
});

export default function BusinessSectionLayout({ children }: { children: ReactNode }) {
  return children;
}
