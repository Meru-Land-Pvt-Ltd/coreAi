import Link from "next/link";
import { LandingWorkflowPreview } from "@/components/landing/workflow-preview";

const features = [
  {
    title: "Marketplace Agents",
    description: "Install ready-made agents for sales, support, reporting, and operations in minutes.",
  },
  {
    title: "Hire AI Architects",
    description: "Post custom requirements and hire verified architects for business-specific automation.",
  },
  {
    title: "Custom Workflow Engine",
    description: "Run JSON workflows with retries, logs, approvals, queue workers, and live status updates.",
  },
  {
    title: "Multi-LLM Gateway",
    description: "Use OpenAI, Claude, Gemini, OpenRouter, Groq, Mistral, and DeepSeek from one control layer.",
  },
];

const stats = [
  { label: "Roles", value: "3" },
  { label: "MVP Connectors", value: "5+" },
  { label: "Core Modules", value: "15+" },
  { label: "Workflow Runtime", value: "BullMQ + Redis" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#fffaf2] text-[#2f1c06]">
      <header className="sticky top-0 z-40 border-b border-orange-100 bg-[#fffaf2]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full brand-gradient" />
            <span className="text-lg font-bold text-orange-900">CoreAI</span>
          </div>

          <nav className="hidden items-center gap-6 text-sm font-medium text-orange-900 md:flex">
            <a href="#about">About Us</a>
            <a href="#features">Features</a>
            <a href="#workflow">Workflow Engine</a>
            <a href="#contact">Contact Us</a>
          </nav>

          <div className="flex gap-2">
            <Link href="/business/login" className="rounded-lg border border-orange-300 px-3 py-2 text-sm font-semibold text-orange-800">
              Login
            </Link>
            <Link href="/business/login" className="rounded-lg bg-orange-600 px-3 py-2 text-sm font-semibold text-white">
              Get Started
            </Link>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-8 px-6 py-14 md:grid-cols-2 md:px-10">
        <div className="space-y-6">
          <p className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-orange-800">
            AI Agent Marketplace for Businesses
          </p>
          <h1 className="text-4xl font-black leading-tight text-orange-950 md:text-5xl">
            Build, Buy, and Run AI Agents with Your Own Workflow Engine
          </h1>
          <p className="max-w-xl text-orange-900/85">
            Launch automation workflows, hire AI Architects, install marketplace templates, and run human-approved AI operations securely across your business.
          </p>

          <div className="flex flex-wrap gap-3">
            <Link href="/business/login" className="rounded-xl bg-orange-600 px-5 py-3 font-semibold text-white">
              Business Login
            </Link>
            <Link href="/architect/login" className="rounded-xl border border-orange-300 px-5 py-3 font-semibold text-orange-800">
              Architect Login
            </Link>
            <Link href="/admin/login" className="rounded-xl border border-orange-300 px-5 py-3 font-semibold text-orange-800">
              Admin Login
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {stats.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-orange-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-orange-700">{stat.label}</p>
                <p className="text-sm font-bold text-orange-900">{stat.value}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="landing-3d-card rounded-3xl border border-orange-200 p-6">
          <div className="mx-auto orb-3d mb-4" />
          <h2 className="text-xl font-bold text-orange-900">Automation That Stays in Your Control</h2>
          <p className="mt-2 text-sm text-orange-800">
            No external workflow SaaS dependency. Build and execute your own workflow runtime using PostgreSQL, Redis, BullMQ workers, and live logs.
          </p>
          <div className="mt-5 rounded-xl bg-white p-4 text-sm text-orange-900">
            <p className="font-semibold">Includes</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-orange-800">
              <li>Role-based workspaces</li>
              <li>Marketplace installation pipeline</li>
              <li>Human approval for risky actions</li>
              <li>Cost and run monitoring</li>
            </ul>
          </div>
        </div>
      </section>

      <section id="about" className="mx-auto max-w-7xl px-6 pb-10 md:px-10">
        <div className="rounded-3xl border border-orange-200 bg-white p-8">
          <h2 className="text-2xl font-bold text-orange-900">About Us</h2>
          <p className="mt-3 text-orange-800">
            CoreAI is built for modern businesses that want production-grade AI automation with full ownership. We connect businesses with AI Architects and provide a structured way to launch secure, testable, and auditable AI workflows.
          </p>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-6 pb-10 md:px-10">
        <h2 className="mb-5 text-2xl font-bold text-orange-900">Platform Features</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {features.map((feature) => (
            <article key={feature.title} className="rounded-2xl border border-orange-200 bg-white p-5">
              <h3 className="text-lg font-bold text-orange-900">{feature.title}</h3>
              <p className="mt-2 text-sm text-orange-800">{feature.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="workflow" className="mx-auto max-w-7xl px-6 pb-10 md:px-10">
        <h2 className="mb-5 text-2xl font-bold text-orange-900">Workflow Engine Visual (React Flow)</h2>
        <LandingWorkflowPreview />
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-6 pb-12 md:px-10">
        <div className="rounded-3xl border border-orange-200 bg-white p-8">
          <h2 className="text-2xl font-bold text-orange-900">Contact Us</h2>
          <p className="mt-2 text-orange-800">Need enterprise onboarding or custom architecture support?</p>
          <div className="mt-4 space-y-1 text-sm text-orange-900">
            <p>Email: contact@coreai.app</p>
            <p>Sales: sales@coreai.app</p>
            <p>Support: support@coreai.app</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-orange-200 bg-orange-50 py-8">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-4 px-6 text-sm text-orange-800 md:flex-row md:px-10">
          <p>© {new Date().getFullYear()} CoreAI Marketplace. All rights reserved.</p>
          <div className="flex gap-4">
            <a href="#about">About</a>
            <a href="#features">Features</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
