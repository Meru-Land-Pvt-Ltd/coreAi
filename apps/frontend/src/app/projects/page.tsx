import Link from "next/link";
import type { Route } from "next";

const projects = [
  {
    title: "Customer support email automation",
    budget: "₹15,000 - ₹25,000",
    status: "Open",
    connectors: ["Gmail", "Sheets", "OpenAI"]
  },
  {
    title: "Lead qualification workflow",
    budget: "₹20,000 - ₹35,000",
    status: "Proposal Review",
    connectors: ["Webhook", "CRM", "Claude"]
  },
  {
    title: "Invoice reminder agent",
    budget: "₹10,000 - ₹18,000",
    status: "In Progress",
    connectors: ["Sheets", "Email", "Gemini"]
  }
];

export default function ProjectsPage() {
  return (
    <main className="min-h-screen bg-[#fff8ef] p-6 text-orange-950">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-orange-700" data-testid="projects-projects-text">Projects</p>
            <h1 className="text-3xl font-bold" data-testid="projects-custom-agent-requirements-heading">Custom Agent Requirements</h1>
          </div>

          <Link data-testid="projects-home-link" href={"/" as Route} className="rounded-full border border-orange-300 px-4 py-2 text-sm">
            Home
          </Link>
        </div>

        <div className="space-y-4">
          {projects.map((project) => (
            <article key={project.title} className="rounded-3xl soft-card p-5">
              <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div>
                  <h2 className="text-xl font-semibold" data-testid="projects-project-title-heading">{project.title}</h2>
                  <p className="mt-1 text-sm text-orange-700" data-testid="projects-project-budget-text">{project.budget}</p>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {project.connectors.map((connector) => (
                      <span
                        key={connector}
                        className="rounded-full bg-orange-100 px-3 py-1 text-xs text-orange-800"
                       data-testid="projects-connector-text">
                        {connector}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="text-left md:text-right">
                  <p className="text-sm font-semibold text-orange-700" data-testid="projects-project-status-text">{project.status}</p>
                  <button data-testid="projects-send-proposal-button" className="mt-3 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white">
                    Send Proposal
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      </div>
    </main>
  );
}