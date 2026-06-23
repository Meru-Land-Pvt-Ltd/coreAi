import { redirect } from "next/navigation";

export default function LegacyAdminLoginRedirect() {
  redirect("/asmin/login");
}
