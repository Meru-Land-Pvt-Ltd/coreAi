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
    <main data-testid="app-projects-page-main-1" className="min-h-screen bg-[#fff8ef] p-6 text-orange-950">
      <div data-testid="app-projects-page-div-1" className="mx-auto max-w-7xl">
        <div data-testid="app-projects-page-div-2" className="mb-6 flex items-center justify-between">
          <div data-testid="app-projects-page-div-3">
            <p data-testid="app-projects-page-p-1" className="text-sm uppercase tracking-[0.2em] text-orange-700">Projects</p>
            <h1 data-testid="app-projects-page-h1-1" className="text-3xl font-bold">Custom Agent Requirements</h1>
          </div>

          <Link data-testid="app-projects-page-link-1" href={"/" as Route} className="rounded-full border border-orange-300 px-4 py-2 text-sm">
            Home
          </Link>
        </div>

        <div data-testid="app-projects-page-div-4" className="space-y-4">
          {projects.map((project) => (
            <article data-testid="app-projects-page-article-1" key={project.title} className="rounded-3xl soft-card p-5">
              <div data-testid="app-projects-page-div-5" className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
                <div data-testid="app-projects-page-div-6">
                  <h2 data-testid="app-projects-page-h2-1" className="text-xl font-semibold">{project.title}</h2>
                  <p data-testid="app-projects-page-p-2" className="mt-1 text-sm text-orange-700">{project.budget}</p>

                  <div data-testid="app-projects-page-div-7" className="mt-3 flex flex-wrap gap-2">
                    {project.connectors.map((connector) => (
                      <span data-testid="app-projects-page-span-1"
                        key={connector}
                        className="rounded-full bg-orange-100 px-3 py-1 text-xs text-orange-800"
                      >
                        {connector}
                      </span>
                    ))}
                  </div>
                </div>

                <div data-testid="app-projects-page-div-8" className="text-left md:text-right">
                  <p data-testid="app-projects-page-p-3" className="text-sm font-semibold text-orange-700">{project.status}</p>
                  <button data-testid="app-projects-page-button-1" className="mt-3 rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white">
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