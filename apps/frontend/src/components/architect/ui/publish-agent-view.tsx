"use client";

import type { Route } from "next";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArchitectCard, ArchitectPageHeader, ArchitectPrimaryButton } from "@/components/architect/ui/architect-ui";

export function PublishAgentView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const workflowId = searchParams.get("workflowId")?.trim() ?? "";
  const destination = (workflowId
    ? `/architect/workflows/${encodeURIComponent(workflowId)}/builder?tab=configure`
    : "/architect/workflows") as Route;

  useEffect(() => {
    router.replace(destination);
  }, [destination, router]);

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Publish Agent"
        title="Publish from Workflow Configure"
        description="Triven uses one production publishing flow so Industry, Subindustry, buyer setup, integrations, pricing, and marketplace metadata stay aligned."
      />
      <ArchitectCard title="Redirecting to the workflow publishing flow">
        <p className="text-sm text-slate-600">
          Complete Configure on your workflow, test it, then submit it for review from the Publish tab.
        </p>
        <div className="mt-4">
          <ArchitectPrimaryButton onClick={() => router.replace(destination)}>
            Continue to Workflows
          </ArchitectPrimaryButton>
        </div>
      </ArchitectCard>
    </div>
  );
}
