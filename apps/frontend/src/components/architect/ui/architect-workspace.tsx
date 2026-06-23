"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createArchitectListing,
  createArchitectWorkflow,
  getArchitectListings,
  getArchitectProjects,
  getArchitectSummary,
  getArchitectWorkflows,
  saveArchitectProfile,
  submitProjectProposal }
  from "../features/api"
import type {
  ArchitectListing,
  ArchitectProject,
  ArchitectSummary,
  ArchitectWorkflow
} from "../features/types";

type Tab = "overview" | "profile" | "workflows" | "marketplace" | "projects";

const emptyWorkflowJson = {
  nodes: [
    {
      id: "trigger",
      type: "manual_trigger",
      label: "Manual Trigger"
    },
    {
      id: "ai",
      type: "llm_node",
      label: "AI Prompt"
    },
    {
      id: "approval",
      type: "human_approval",
      label: "Human Approval"
    }
  ],
  edges: [
    {
      id: "trigger-ai",
      source: "trigger",
      target: "ai"
    },
    {
      id: "ai-approval",
      source: "ai",
      target: "approval"
    }
  ]
};

function currency(cents: number | null | undefined) {
  if (!cents) return "Not set";
  return `₹${Math.round(cents / 100).toLocaleString("en-IN")}`;
}

function csvToArray(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function ArchitectWorkspace() {
  const [tab, setTab] = useState<Tab>("overview");
  const [summary, setSummary] = useState<ArchitectSummary | null>(null);
  const [workflows, setWorkflows] = useState<ArchitectWorkflow[]>([]);
  const [listings, setListings] = useState<ArchitectListing[]>([]);
  const [projects, setProjects] = useState<ArchitectProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const profile = summary?.profile;

  const profileCompletion = useMemo(() => {
    if (!profile) return 0;

    const fields = [
      profile.title,
      profile.bio,
      profile.portfolioUrl,
      profile.skills.length > 0,
      profile.hourlyRateCents
    ];

    const completed = fields.filter(Boolean).length;
    return Math.round((completed / fields.length) * 100);
  }, [profile]);

  async function loadAll() {
    setLoading(true);

    const [summaryResult, workflowsResult, listingsResult, projectsResult] = await Promise.all([
      getArchitectSummary(),
      getArchitectWorkflows(),
      getArchitectListings(),
      getArchitectProjects()
    ]);

    if (summaryResult.success && summaryResult.data) {
      setSummary(summaryResult.data);
    }

    if (workflowsResult.success && workflowsResult.data) {
      setWorkflows(workflowsResult.data.workflows);
    }

    if (listingsResult.success && listingsResult.data) {
      setListings(listingsResult.data.listings);
    }

    if (projectsResult.success && projectsResult.data) {
      setProjects(projectsResult.data.projects);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  async function handleProfileSubmit(formData: FormData) {
    setMessage("");

    const result = await saveArchitectProfile({
      title: String(formData.get("title") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      portfolioUrl: String(formData.get("portfolioUrl") ?? ""),
      skills: csvToArray(String(formData.get("skills") ?? "")),
      hourlyRateCents: Number(formData.get("hourlyRate")) * 100
    });

    if (!result.success) {
      setMessage(result.error ?? "Profile save failed");
      return;
    }

    setMessage("Profile saved successfully");
    await loadAll();
  }

  async function handleWorkflowSubmit(formData: FormData) {
    setMessage("");

    const result = await createArchitectWorkflow({
      name: String(formData.get("name") ?? ""),
      description: String(formData.get("description") ?? ""),
      isTemplate: formData.get("isTemplate") === "on",
      workflowJson: emptyWorkflowJson
    });

    if (!result.success) {
      setMessage(result.error ?? "Workflow creation failed");
      return;
    }

    setMessage("Workflow created successfully");
    await loadAll();
  }

  async function handleListingSubmit(formData: FormData) {
    setMessage("");

    const result = await createArchitectListing({
      workflowId: String(formData.get("workflowId") ?? "") || undefined,
      name: String(formData.get("name") ?? ""),
      shortDescription: String(formData.get("shortDescription") ?? ""),
      description: String(formData.get("description") ?? ""),
      priceCents: Number(formData.get("price")) * 100,
      tags: csvToArray(String(formData.get("tags") ?? "")),
      requiredConnectors: csvToArray(String(formData.get("connectors") ?? "")),
      supportedLlms: csvToArray(String(formData.get("llms") ?? ""))
    });

    if (!result.success) {
      setMessage(result.error ?? "Listing creation failed");
      return;
    }

    setMessage("Agent listing submitted for review");
    await loadAll();
  }

  async function handleProposalSubmit(projectId: string, formData: FormData) {
    setMessage("");

    const result = await submitProjectProposal(projectId, {
      coverLetter: String(formData.get("coverLetter") ?? ""),
      bidAmountCents: Number(formData.get("bidAmount")) * 100,
      etaDays: Number(formData.get("etaDays"))
    });

    if (!result.success) {
      setMessage(result.error ?? "Proposal submission failed");
      return;
    }

    setMessage("Proposal submitted successfully");
    await loadAll();
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#f7f3ff] text-slate-900">
        <div className="rounded-3xl bg-white px-6 py-4 shadow-sm">Loading architect workspace...</div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#f7f3ff] text-slate-950">
      <aside className="fixed left-0 top-0 hidden h-screen w-72 border-r border-violet-100 bg-white/90 p-5 backdrop-blur-xl lg:block">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-2xl bg-gradient-to-br from-violet-600 to-orange-400" />
          <div>
            <h1 className="font-bold">CoreAI Studio</h1>
            <p className="text-xs text-slate-500">Architect Workspace</p>
          </div>
        </div>

        <nav className="mt-8 space-y-2">
          {[
            ["overview", "Overview"],
            ["profile", "Profile"],
            ["workflows", "Workflow Studio"],
            ["marketplace", "Marketplace Listing"],
            ["projects", "Open Projects"]
          ].map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key as Tab)}
              className={`w-full rounded-2xl px-4 py-3 text-left text-sm font-semibold transition ${
                tab === key
                  ? "bg-violet-600 text-white shadow-lg shadow-violet-200"
                  : "text-slate-600 hover:bg-violet-50"
              }`}
            >
              {label}
            </button>
          ))}
        </nav>
      </aside>

      <section className="lg:pl-72">
        <header className="sticky top-0 z-20 border-b border-violet-100 bg-[#f7f3ff]/80 px-5 py-4 backdrop-blur-xl">
          <div className="mx-auto flex max-w-7xl items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-violet-600">
                AI Architect
              </p>
              <h2 className="text-2xl font-black">
                {summary?.user.fullName ?? summary?.user.email}
              </h2>
            </div>

            <div className="rounded-full bg-white px-4 py-2 text-sm font-semibold text-slate-600 shadow-sm">
              Profile {profileCompletion}% complete
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-7xl p-5">
          {message ? (
            <div className="mb-5 rounded-3xl border border-violet-100 bg-white px-5 py-4 text-sm font-semibold text-violet-700 shadow-sm">
              {message}
            </div>
          ) : null}

          <div className="mb-5 flex gap-2 overflow-x-auto lg:hidden">
            {[
              ["overview", "Overview"],
              ["profile", "Profile"],
              ["workflows", "Workflows"],
              ["marketplace", "Marketplace"],
              ["projects", "Projects"]
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key as Tab)}
                className={`rounded-full px-4 py-2 text-sm font-semibold ${
                  tab === key ? "bg-violet-600 text-white" : "bg-white text-slate-700"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "overview" ? (
            <section>
              <div className="grid gap-4 md:grid-cols-4">
                <Stat label="Workflows" value={summary?.stats.workflows ?? 0} />
                <Stat label="Listings" value={summary?.stats.listings ?? 0} />
                <Stat label="Proposals" value={summary?.stats.proposals ?? 0} />
                <Stat label="Open Projects" value={summary?.stats.openProjects ?? 0} />
              </div>

              <div className="mt-5 grid gap-5 lg:grid-cols-[1.2fr_0.8fr]">
                <Panel title="Profile Snapshot">
                  {profile ? (
                    <div>
                      <h3 className="text-xl font-black">{profile.title ?? "Untitled Architect"}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{profile.bio}</p>
                      <div className="mt-4 flex flex-wrap gap-2">
                        {profile.skills.map((skill) => (
                          <Badge key={skill}>{skill}</Badge>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <Empty text="Create your architect profile to start getting project opportunities." />
                  )}
                </Panel>

                <Panel title="Next Best Action">
                  {!profile ? (
                    <ActionButton onClick={() => setTab("profile")}>Complete Profile</ActionButton>
                  ) : workflows.length === 0 ? (
                    <ActionButton onClick={() => setTab("workflows")}>Create Workflow</ActionButton>
                  ) : listings.length === 0 ? (
                    <ActionButton onClick={() => setTab("marketplace")}>Submit Listing</ActionButton>
                  ) : (
                    <ActionButton onClick={() => setTab("projects")}>Find Projects</ActionButton>
                  )}
                </Panel>
              </div>
            </section>
          ) : null}

          {tab === "profile" ? (
            <Panel title="Architect Profile">
              <form action={handleProfileSubmit} className="grid gap-4">
                <Input name="title" label="Professional Title" defaultValue={profile?.title ?? ""} placeholder="AI Workflow Architect" />
                <Textarea name="bio" label="Bio" defaultValue={profile?.bio ?? ""} placeholder="Tell businesses what you build and how you help." />
                <Input name="portfolioUrl" label="Portfolio URL" defaultValue={profile?.portfolioUrl ?? ""} placeholder="https://yourportfolio.com" />
                <Input name="skills" label="Skills comma separated" defaultValue={profile?.skills.join(", ") ?? ""} placeholder="OpenAI, Automations, CRM, Slack" />
                <Input name="hourlyRate" label="Hourly Rate in INR" defaultValue={profile?.hourlyRateCents ? String(profile.hourlyRateCents / 100) : ""} placeholder="1500" type="number" />
                <SubmitButton>Save Profile</SubmitButton>
              </form>
            </Panel>
          ) : null}

          {tab === "workflows" ? (
            <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
              <Panel title="Create Workflow">
                <form action={handleWorkflowSubmit} className="grid gap-4">
                  <Input name="name" label="Workflow Name" placeholder="Customer Support AI Workflow" />
                  <Textarea name="description" label="Description" placeholder="What does this workflow automate?" />
                  <label className="flex items-center gap-2 text-sm font-semibold">
                    <input name="isTemplate" type="checkbox" />
                    Save as reusable template
                  </label>
                  <SubmitButton>Create Workflow</SubmitButton>
                </form>
              </Panel>

              <Panel title="Your Workflows">
                {workflows.length ? (
                  <div className="grid gap-3">
                    {workflows.map((workflow) => (
                      <Card key={workflow.id}>
                        <h3 className="font-black">{workflow.name}</h3>
                        <p className="mt-1 text-sm text-slate-600">{workflow.description}</p>
                        <p className="mt-3 text-xs font-semibold text-violet-600">
                          {workflow.isTemplate ? "Template" : "Private workflow"}
                        </p>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Empty text="No workflows created yet." />
                )}
              </Panel>
            </section>
          ) : null}

          {tab === "marketplace" ? (
            <section className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
              <Panel title="Submit Agent Listing">
                <form action={handleListingSubmit} className="grid gap-4">
                  <label className="grid gap-1 text-sm font-semibold text-slate-700">
                    Select Workflow
                    <select name="workflowId" className="rounded-2xl border border-slate-200 px-4 py-3 outline-none">
                      <option value="">No workflow selected</option>
                      {workflows.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Input name="name" label="Agent Name" placeholder="Customer Support Agent" />
                  <Input name="shortDescription" label="Short Description" placeholder="AI agent that drafts and routes support replies." />
                  <Textarea name="description" label="Full Description" placeholder="Explain the agent in detail." />
                  <Input name="price" label="Price in INR" type="number" placeholder="999" />
                  <Input name="tags" label="Tags comma separated" placeholder="support, gmail, automation" />
                  <Input name="connectors" label="Required Connectors" placeholder="Gmail, Google Sheets" />
                  <Input name="llms" label="Supported LLMs" placeholder="OpenAI, Claude, Gemini" />
                  <SubmitButton>Submit for Review</SubmitButton>
                </form>
              </Panel>

              <Panel title="Your Listings">
                {listings.length ? (
                  <div className="grid gap-3">
                    {listings.map((listing) => (
                      <Card key={listing.id}>
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <h3 className="font-black">{listing.name}</h3>
                            <p className="mt-1 text-sm text-slate-600">{listing.shortDescription}</p>
                          </div>
                          <Badge>{listing.status}</Badge>
                        </div>
                        <p className="mt-3 text-sm font-bold">{currency(listing.priceCents)}</p>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <Empty text="No marketplace listings submitted yet." />
                )}
              </Panel>
            </section>
          ) : null}

          {tab === "projects" ? (
            <Panel title="Open Business Projects">
              {projects.length ? (
                <div className="grid gap-4">
                  {projects.map((project) => (
                    <Card key={project.id}>
                      <h3 className="text-lg font-black">{project.title}</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{project.requirementBrief}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {project.requiredConnectors.map((connector) => (
                          <Badge key={connector}>{connector}</Badge>
                        ))}
                      </div>
                      <p className="mt-3 text-sm font-bold">
                        Budget: {currency(project.budgetMinCents)} - {currency(project.budgetMaxCents)}
                      </p>

                      <form
                        action={(formData) => handleProposalSubmit(project.id, formData)}
                        className="mt-4 grid gap-3 rounded-3xl bg-slate-50 p-4"
                      >
                        <Textarea name="coverLetter" label="Proposal Message" placeholder="Explain how you will solve this project." />
                        <div className="grid gap-3 md:grid-cols-2">
                          <Input name="bidAmount" label="Bid Amount INR" type="number" placeholder="15000" />
                          <Input name="etaDays" label="ETA Days" type="number" placeholder="7" />
                        </div>
                        <SubmitButton>Send Proposal</SubmitButton>
                      </form>
                    </Card>
                  ))}
                </div>
              ) : (
                <Empty text="No open projects available right now." />
              )}
            </Panel>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[28px] bg-white p-5 shadow-sm">
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <h3 className="mt-2 text-4xl font-black">{value}</h3>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[32px] bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-xl font-black">{title}</h2>
      {children}
    </section>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[26px] border border-slate-100 bg-white p-4 shadow-sm">{children}</div>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{children}</span>;
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-[26px] bg-slate-50 p-5 text-sm font-semibold text-slate-500">{text}</div>;
}

function ActionButton({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="rounded-full bg-violet-600 px-5 py-3 text-sm font-bold text-white">
      {children}
    </button>
  );
}

function Input(props: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-700">
      {props.label}
      <input
        name={props.name}
        type={props.type ?? "text"}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        className="rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500"
      />
    </label>
  );
}

function Textarea(props: {
  name: string;
  label: string;
  placeholder?: string;
  defaultValue?: string;
}) {
  return (
    <label className="grid gap-1 text-sm font-semibold text-slate-700">
      {props.label}
      <textarea
        name={props.name}
        defaultValue={props.defaultValue}
        placeholder={props.placeholder}
        className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3 outline-none focus:border-violet-500"
      />
    </label>
  );
}

function SubmitButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="rounded-full bg-violet-600 px-5 py-3 text-sm font-bold text-white" type="submit">
      {children}
    </button>
  );
}