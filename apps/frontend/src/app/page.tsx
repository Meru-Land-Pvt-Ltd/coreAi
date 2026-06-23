import Link from "next/link";
import { LandingWorkflowPreview } from "@/components/landing/workflow-preview";

const highlights = [
  "Custom workflow engine with queue workers",
  "Marketplace + custom architect hiring",
  "Business approvals for risky actions",
  "Multi-LLM routing and usage visibility",
];

const cards: {
  title: string;
  text: string;
  link: "/login" | "/businedd/login" | "/asmin/login";
  action: string;
}[] = [
  {
    title: "For Architects",
    text: "Design and test workflows visually, package templates, and ship reusable automation products.",
    link: "/login",
    action: "Architect Login",
  },
  {
    title: "For Business",
    text: "Install prebuilt agents or hire architects to deliver custom automations tied to your workflows.",
    link: "/businedd/login",
    action: "Business Login",
  },
  {
    title: "For Admin",
    text: "Moderate users, approve listings, monitor logs, and protect platform security and trust.",
    link: "/asmin/login",
    action: "Admin Login",
  },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#fff8ef] text-[#4a2400]">
      <div className="hero-noise" />
      <div className="hero-spotlight" />

      <header className="sticky top-0 z-30 border-b border-orange-200/70 bg-[#fff8ef]/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-7xl items-center justify-between px-6 py-4 md:px-10">
          <div className="flex items-center gap-3">
            <div className="brand-ring" />
            <span className="text-base font-semibold tracking-wide text-orange-900">CoreAI Marketplace</span>
          </div>

          <nav className="hidden items-center gap-6 text-sm text-orange-800 md:flex">
            <a href="#about" className="transition hover:text-orange-900">About</a>
            <a href="#flow" className="transition hover:text-orange-900">Flow</a>
            <a href="#roles" className="transition hover:text-orange-900">Roles</a>
            <a href="#contact" className="transition hover:text-orange-900">Contact</a>
          </nav>

          <Link href="/businedd/login" className="rounded-full border border-orange-300 px-4 py-2 text-sm font-medium text-orange-900 transition hover:border-orange-500">
            Start Now
          </Link>
        </div>
      </header>

      <section className="relative mx-auto grid max-w-7xl gap-10 px-6 pb-16 pt-14 md:grid-cols-[1.1fr_1fr] md:px-10">
        <div>
          <p className="inline-flex rounded-full border border-orange-300 bg-orange-100/70 px-3 py-1 text-xs uppercase tracking-[0.2em] text-orange-800">
            AI Automation Platform
          </p>
          <h1 className="mt-5 text-4xl font-semibold leading-tight text-orange-950 md:text-6xl">
            Build AI Agents
            <br />
            and Workflow Systems
            <br />
            with Full Control
          </h1>
          <p className="mt-5 max-w-xl text-base text-orange-900/80">
            A simple and aesthetic AI agent marketplace where businesses install ready agents or hire architects to create custom workflows powered by your own execution engine.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/login" className="rounded-full bg-[#ff9f1c] px-5 py-3 text-sm font-semibold text-[#1c1204] transition hover:bg-[#ffb347]">
              Architect Login
            </Link>
            <Link href="/businedd/login" className="rounded-full border border-orange-300 bg-white px-5 py-3 text-sm font-semibold text-orange-800 transition hover:border-orange-500">
              Business Login
            </Link>
            <Link href="/asmin/login" className="rounded-full border border-orange-300 bg-white px-5 py-3 text-sm font-semibold text-orange-800 transition hover:border-orange-500">
              Admin Login
            </Link>
          </div>

          <ul className="mt-7 grid gap-2 text-sm text-orange-900/80">
            {highlights.map((item) => (
              <li key={item} className="flex items-start gap-2">
                <span className="mt-1 h-2 w-2 rounded-full bg-[#ff9f1c]" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="landing-panel-3d">
          <div className="floating-chip chip-one">Live Runs + Costs</div>
          <div className="floating-chip chip-two">Human Approval Gate</div>
          <div className="floating-chip chip-three">LLM Router</div>
          <div className="orb-3d mx-auto" />
          <p className="mt-6 text-center text-sm text-orange-950/80">
            Clean cinematic layout with your yellow-orange brand palette and subtle 3D motion.
          </p>
        </div>
      </section>

      <section id="flow" className="mx-auto max-w-7xl px-6 pb-14 md:px-10">
        <h2 className="mb-4 text-2xl font-semibold text-orange-950">Workflow Engine Preview</h2>
        <p className="mb-5 max-w-3xl text-sm text-orange-900/75">
          React Flow visualization for trigger, routing, approval, and connector execution path with extended flow controls and viewport settings.
        </p>
        <LandingWorkflowPreview />
      </section>

      <section id="roles" className="mx-auto max-w-7xl px-6 pb-14 md:px-10">
        <div className="grid gap-4 md:grid-cols-3">
          {cards.map((card) => (
            <article key={card.title} className="rounded-2xl border border-orange-200 bg-white/85 p-5 backdrop-blur">
              <h3 className="text-lg font-semibold text-orange-950">{card.title}</h3>
              <p className="mt-2 text-sm text-orange-900/75">{card.text}</p>
              <Link href={card.link} className="mt-4 inline-block rounded-full bg-orange-100 px-4 py-2 text-sm font-semibold text-orange-900 transition hover:bg-orange-200">
                {card.action}
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section id="about" className="mx-auto max-w-7xl px-6 pb-14 md:px-10">
        <div className="rounded-3xl border border-orange-200 bg-white/85 p-7 backdrop-blur">
          <h2 className="text-2xl font-semibold text-orange-950">About CoreAI</h2>
          <p className="mt-3 max-w-4xl text-sm text-orange-900/75">
            CoreAI connects businesses and AI architects in one marketplace while keeping workflow runtime in your own product architecture. You get traceable execution, role-specific governance, and scalable automation delivery.
          </p>
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-6 pb-16 md:px-10">
        <div className="rounded-3xl border border-orange-200 bg-white/85 p-7 backdrop-blur">
          <h2 className="text-2xl font-semibold text-orange-950">Contact</h2>
          <p className="mt-2 text-sm text-orange-900/75">For partnerships, implementation support, or enterprise onboarding:</p>
          <div className="mt-4 text-sm text-orange-900/85">
            <p>support@coreai.app</p>
            <p>sales@coreai.app</p>
            <p>security@coreai.app</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-orange-200 py-7">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-3 px-6 text-xs text-orange-900/60 md:flex-row md:items-center md:px-10">
          <p>© {new Date().getFullYear()} CoreAI Agent Marketplace</p>
          <div className="flex gap-4">
            <a href="#about">About</a>
            <a href="#roles">Roles</a>
            <a href="#contact">Contact</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
