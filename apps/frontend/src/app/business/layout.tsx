import type { ReactNode } from "react";
import { BusinessSidebarLayout } from "@/components/business/sidebar";

export default function BusinessLayout({ children }: { children: ReactNode }) {
  return <BusinessSidebarLayout>{children}</BusinessSidebarLayout>;
}