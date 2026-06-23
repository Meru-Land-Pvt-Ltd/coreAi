import { redirect } from "next/navigation";

export default function LegacyAdminDashboardRedirect() {
  redirect("/asmin/dashboard");
}
