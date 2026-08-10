import { redirect } from "next/navigation";

export default async function ArchitectPublishAgentPage({
  searchParams
}: {
  searchParams: Promise<{ workflowId?: string }>
}) {
  const params = await searchParams;
  const workflowId = params.workflowId?.trim();
  if (workflowId) {
    redirect(`/architect/workflows/${encodeURIComponent(workflowId)}/builder?tab=configure`);
  }
  redirect("/architect/workflows/new");
}
