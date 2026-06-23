import Link from "next/link";
import type { Route } from "next";

type LoginCard = {
  title: string;
  text: string;
  loginHref: Route;
  signupHref: Route;
};

const loginCards: LoginCard[] = [
  {
    title: "AI Architect",
    text: "Create AI agents, design workflows, and submit automation systems for businesses.",
    loginHref: "/architect/login",
    signupHref: "/architect/signup"
  },
  {
    title: "Business",
    text: "Hire AI Architects, install AI agents, and automate your business workflows.",
    loginHref: "/business/login",
    signupHref: "/business/signup"
  },
  {
    title: "Admin",
    text: "Manage users, approvals, platform trust, agents, projects, and marketplace quality.",
    loginHref: "/admin/login",
    signupHref: "/admin/signup"
  }
];

export default function HomePage() {
  return (
    <main className="min-h-screen hero-bg text-orange-950">
      <header className="border-b border-orange-200 bg-white/70 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <Link href="/" className="flex items-center gap-3">
            <div className="brand-ring" />
            <span className="text-lg font-bold">CoreAI Marketplace</span>
          </Link>

          <nav className="hidden gap-6 text-sm text-orange-800 md:flex">
            <a href="#roles">Roles</a>
            <a href="#platform">Platform</a>
            <Link href="/marketplace">Marketplace</Link>
            <Link href="/projects">Projects</Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-10 px-6 py-16 md:grid-cols-[1.1fr_0.9fr]">
        <div>
          <p className="inline-flex rounded-full border border-orange-300 bg-orange-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-orange-700">
            AI Agent Marketplace
          </p>

          <h1 className="mt-6 text-4xl font-bold leading-tight md:text-6xl">
            Build, Hire, and Run
            <br />
            AI Agents for Any Business
          </h1>

          <p className="mt-5 max-w-2xl text-base leading-7 text-orange-900/75">
            CoreAI is a marketplace where businesses can hire AI Architects or install ready-made
            agents. AI Architects can build automation workflows with minimal coding knowledge.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/business/signup"
              className="rounded-full bg-orange-500 px-6 py-3 text-sm font-semibold text-white hover:bg-orange-600"
            >
              Start as Business
            </Link>

            <Link
              href="/architect/signup"
              className="rounded-full border border-orange-300 bg-white px-6 py-3 text-sm font-semibold text-orange-900 hover:border-orange-500"
            >
              Become AI Architect
            </Link>
          </div>
        </div>

        <div className="rounded-3xl soft-card p-6">
          <h2 className="text-xl font-bold">Prototype Flow</h2>

          <div className="mt-5 space-y-3">
            {[
              "Business posts AI agent requirement",
              "AI Architect creates custom workflow",
              "Admin approves architect and marketplace listing",
              "Business installs and runs the AI agent"
            ].map((item, index) => (
              <div key={item} className="flex items-center gap-3 rounded-2xl bg-orange-50 p-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-sm font-bold text-white">
                  {index + 1}
                </div>
                <p className="text-sm font-medium text-orange-900">{item}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="roles" className="mx-auto max-w-7xl px-6 pb-16">
        <h2 className="text-2xl font-bold">Choose Your Login</h2>
        <p className="mt-2 text-sm text-orange-800/75">
          Each role has a separate login and signup page.
        </p>

        <div className="mt-6 grid gap-5 md:grid-cols-3">
          {loginCards.map((card) => (
            <article key={card.title} className="rounded-3xl soft-card p-6">
              <h3 className="text-xl font-bold">{card.title}</h3>
              <p className="mt-2 min-h-16 text-sm text-orange-800/75">{card.text}</p>

              <div className="mt-5 flex gap-3">
                <Link
                  href={card.loginHref}
                  className="rounded-full bg-orange-500 px-4 py-2 text-sm font-semibold text-white"
                >
                  Login
                </Link>

                <Link
                  href={card.signupHref}
                  className="rounded-full border border-orange-300 px-4 py-2 text-sm font-semibold text-orange-900"
                >
                  Signup
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section id="platform" className="mx-auto max-w-7xl px-6 pb-16">
        <div className="rounded-3xl soft-card p-6">
          <h2 className="text-2xl font-bold">Platform Modules</h2>

          <div className="mt-5 grid gap-3 text-sm text-orange-900 md:grid-cols-3">
            <p>Marketplace for ready-made AI agents</p>
            <p>Hiring flow for custom AI agents</p>
            <p>Workflow builder for AI Architects</p>
            <p>Business dashboard for installed agents</p>
            <p>Admin approval and moderation system</p>
            <p>Multi-LLM and connector-ready architecture</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-orange-200 py-6">
        <div className="mx-auto max-w-7xl px-6 text-sm text-orange-700">
          © {new Date().getFullYear()} CoreAI Agent Marketplace
        </div>
      </footer>
    </main>
  );
}