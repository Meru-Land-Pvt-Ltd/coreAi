import type { Route } from "next";
import { redirect } from "next/navigation";

export default async function ArchitectWorkflowDetailPage({
  params
}: {
  params: Promise<{
    workflowId: string;
  }>;
}) {
  const { workflowId } = await params;

  redirect(`/architect/workflows/${workflowId}/builder` as Route);
}