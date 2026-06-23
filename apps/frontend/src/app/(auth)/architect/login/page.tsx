import { redirect } from "next/navigation";

export default function LegacyArchitectLoginRedirect() {
  redirect("/login");
}
