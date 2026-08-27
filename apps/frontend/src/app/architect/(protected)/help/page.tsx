import { redirect } from "next/navigation";
import type { Route } from "next";

/**
 * Help was a "coming soon" placeholder — the one promise this platform must
 * never make. The real thing lives at /architect/docs now (the founder's
 * ruling, 2026-08-27), generated from every node's own row.
 */
export default function ArchitectHelpPage() {
  redirect("/architect/docs" as Route);
}
