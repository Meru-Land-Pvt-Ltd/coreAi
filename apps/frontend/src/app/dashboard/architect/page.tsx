import { redirect } from "next/navigation";

export default function LegacyArchitectDashboardRedirect() {
  redirect("/architect/dashboard");
}
