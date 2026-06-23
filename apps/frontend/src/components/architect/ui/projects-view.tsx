"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectTextarea,
  formatMoney
} from "./architect-ui";
import { getArchitectProjects, submitProjectProposal } from "../features/api";
import type { ArchitectProject } from "../features/types";

export function ArchitectProjectsView() {
  const [projects, setProjects] = useState<ArchitectProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadProjects() {
    const result = await getArchitectProjects();

    if (result.success && result.data) {
      setProjects(result.data.projects);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadProjects();
  }, []);

  async function handleProposal(projectId: string, event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const bidAmount = String(formData.get("bidAmount") ?? "");
    const etaDays = String(formData.get("etaDays") ?? "");

    const result = await submitProjectProposal(projectId, {
      coverLetter: String(formData.get("coverLetter") ?? ""),
      bidAmountCents: bidAmount ? Number(bidAmount) * 100 : undefined,
      etaDays: etaDays ? Number(etaDays) : undefined
    });

    if (!result.success) {
      setMessage(result.error ?? "Proposal submission failed");
      return;
    }

    setMessage("Proposal submitted successfully");
    await loadProjects();
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Business Opportunities"
        title="Open Projects"
        description="Browse business requirements and submit real proposals."
      />

      {message ? (
        <div className="mb-5 rounded-[24px] border border-orange-100 bg-white px-5 py-4 text-sm font-black text-orange-700">
          {message}
        </div>
      ) : null}

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-orange-700">Loading projects...</p>
        ) : projects.length ? (
          <div className="grid gap-5">
            {projects.map((project) => (
              <article key={project.id} className="rounded-[30px] bg-orange-50 p-5">
                <h2 className="text-2xl font-black">{project.title}</h2>
                <p className="mt-2 text-sm leading-6 text-orange-900/70">
                  {project.requirementBrief}
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {project.requiredConnectors.map((connector) => (
                    <ArchitectBadge key={connector}>{connector}</ArchitectBadge>
                  ))}
                </div>

                <p className="mt-4 text-sm font-black text-orange-900">
                  Budget: {formatMoney(project.budgetMinCents)} -{" "}
                  {formatMoney(project.budgetMaxCents)}
                </p>

                <form
                  onSubmit={(event) => handleProposal(project.id, event)}
                  className="mt-5 grid gap-4 rounded-[28px] bg-white p-4"
                >
                  <ArchitectTextarea
                    name="coverLetter"
                    label="Proposal Message"
                    placeholder="Explain how you will solve this business problem."
                    required
                    minLength={20}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    <ArchitectField name="bidAmount" label="Bid Amount INR" type="number" min={0} />
                    <ArchitectField name="etaDays" label="ETA Days" type="number" min={1} />
                  </div>

                  <ArchitectPrimaryButton>Send Proposal</ArchitectPrimaryButton>
                </form>
              </article>
            ))}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No open projects"
            text="There are no available business projects right now. Once businesses post requirements, they will appear here."
          />
        )}
      </ArchitectCard>
    </div>
  );
}