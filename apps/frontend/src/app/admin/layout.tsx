import type { ReactNode } from "react";
import type { Metadata } from "next";
import { sectionMetadata } from "@/lib/site-metadata";

export const metadata: Metadata = {
  ...sectionMetadata({
    section: "Admin",
    description: "Triven.ai platform administration.",
    path: "/admin"
  }),
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true
    }
  }
};

export default function AdminSectionLayout({ children }: { children: ReactNode }) {
  return children;
}
