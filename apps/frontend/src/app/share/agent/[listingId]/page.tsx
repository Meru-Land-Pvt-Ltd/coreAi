import type { Route } from "next";
import { redirect } from "next/navigation";
import { publicAgentPath } from "@/lib/routes";

type ShareAgentPageProps = {
  params: Promise<{ listingId: string }>;
};

/** Short share alias — canonical public agent page is /agent/[listingId]. */
export default async function ShareAgentPage({ params }: ShareAgentPageProps) {
  const { listingId } = await params;
  redirect(publicAgentPath(listingId) as Route);
}
