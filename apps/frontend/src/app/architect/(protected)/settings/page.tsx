import type { Route } from "next";
import { redirect } from "next/navigation";

export default function ArchitectSettingsRedirectPage() {
  redirect("/architect/profile" as Route);
}
