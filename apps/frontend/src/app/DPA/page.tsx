import type { Metadata } from "next";
import BusinessDPA from "@/components/business/businessDPA";
import { pageTitle } from "@/lib/site-metadata";

export const metadata: Metadata = {
  ...pageTitle("Data Processing Agreement"),
  description: "Review and download Triven.ai's pre-signed Data Processing Agreement."
};

export default function DpaPage() {
  return <BusinessDPA />;
}
