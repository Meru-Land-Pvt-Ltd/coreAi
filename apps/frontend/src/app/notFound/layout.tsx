import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageTitle } from "@/lib/site-metadata";

export const metadata: Metadata = pageTitle("Page not found");

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
