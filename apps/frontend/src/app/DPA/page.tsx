import type { Metadata } from "next";
import BusinessDPA from "@/components/business/businessDPA";

export const metadata: Metadata = {
  title: "Data Processing Agreement | Triven.ai",
  description: "Review and download Triven.ai's pre-signed Data Processing Agreement."
};

export default function DpaPage() {
  return <BusinessDPA />;
}
