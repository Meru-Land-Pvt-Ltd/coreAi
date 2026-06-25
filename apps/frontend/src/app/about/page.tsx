import Link from "next/link";

const howItWorks = [
  {
    step: "1",
    title: "AI Architects Build",
    description:
      "Certified builders create specialized agents using our drag-and-drop workflow builder with 180+ connectors."
  },
  {
    step: "2",
    title: "Businesses Install",
    description:
      "Browse the marketplace, pick an agent that fits your industry, and activate it with one click."
  },
  {
    step: "3",
    title: "Results Happen",
    description:
      "Agents handle missed calls, follow-ups, scheduling, and lead capture 24/7 — automatically."
  }
];

const stats = [
  { value: "180+", label: "Connectors" },
  { value: "6", label: "Agent Types" },
  { value: "24/7", label: "Automation" },
  { value: "2-Minute", label: "Setup" }
];

const serveCards = [
  {
    tag: "For Business Owners",
    description:
      "Dentists, HVAC companies, real estate agents, med spas, law firms — if you're losing leads to missed calls and slow follow-ups, CORE fixes that."
  },
  {
    tag: "For AI Architects",
    description:
      "Build once, sell forever. Create agents on our platform, publish to the marketplace, and earn recurring revenue from every install."
  }
];

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-white text-slate-900 antialiased">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .nav-link { position: relative; }
            .nav-link::after {
              content: "";
              position: absolute;
              left: 0;
              right: 0;
              bottom: -4px;
              height: 2px;
              background: #f59e0b;
              transform: scaleX(0);
              transition: transform 200ms ease;
            }
            .nav-link:hover::after,
            .nav-link.active::after {
              transform: scaleX(1);
            }
            .card-hover {
              transition: transform 200ms ease, box-shadow 200ms ease, border-color 200ms ease;
            }
            .card-hover:hover {
              transform: translateY(-3px);
              box-shadow: 0 10px 25px -8px rgba(15, 23, 42, 0.1);
              border-color: #fde68a;
            }
            .btn-amber {
              transition: background-color 200ms ease, transform 200ms ease, box-shadow 200ms ease;
            }
            .btn-amber:hover {
              transform: translateY(-1px);
              box-shadow: 0 8px 20px -6px rgba(245, 158, 11, 0.5);
            }
          `
        }}
      />

      <Header />

      <section className="py-20 md:py-28">
        <div className="mx-auto max-w-6xl px-6 text-center">
          <h1 className="mx-auto max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-slate-900 md:text-5xl">
            AI Agents That Actually Work for Your Business
          </h1>

          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            CORE is the marketplace where certified AI Architects build, test, and deploy
            intelligent agents that handle your busywork — so you can focus on growth.
          </p>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-extrabold text-slate-900">Our Mission</h2>

          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            We believe every small business deserves enterprise-level AI — without the
            enterprise-level complexity or cost. CORE connects businesses with pre-built,
            plug-and-play AI agents that start working in minutes, not months.
          </p>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-extrabold text-slate-900">
            How It Works
          </h2>

          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {howItWorks.map((item) => (
              <div
                key={item.step}
                className="card-hover rounded-xl border border-gray-100 bg-white p-8 shadow-sm"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-50 font-bold text-amber-600">
                  {item.step}
                </div>

                <h3 className="mt-5 text-lg font-bold text-slate-900">{item.title}</h3>

                <p className="mt-3 leading-relaxed text-slate-600">{item.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 py-16">
        <div className="mx-auto max-w-6xl px-6">
          <div className="grid grid-cols-2 gap-8 text-center md:grid-cols-4">
            {stats.map((item) => (
              <div key={item.label}>
                <p className="text-3xl font-extrabold text-amber-500 md:text-4xl">
                  {item.value}
                </p>
                <p className="mt-2 text-sm text-slate-500">{item.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-3xl font-extrabold text-slate-900">
            Who We Serve
          </h2>

          <div className="mt-14 grid gap-6 md:grid-cols-2">
            {serveCards.map((card) => (
              <div
                key={card.tag}
                className="card-hover rounded-xl border border-gray-100 bg-white p-8 shadow-sm"
              >
                <span className="inline-block rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-600">
                  {card.tag}
                </span>

                <p className="mt-5 leading-relaxed text-slate-600">{card.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-y border-gray-100 bg-gray-50 py-20">
        <div className="mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-3xl font-extrabold text-slate-900">
            Built by Operators, Not Just Engineers
          </h2>

          <p className="mt-5 text-lg leading-relaxed text-slate-600">
            Our team combines deep AI expertise with real-world business operations
            experience. We&apos;ve run the businesses we&apos;re building for — we know
            what&apos;s broken and how to fix it.
          </p>
        </div>
      </section>

      <section className="py-20 md:py-24">
        <div className="mx-auto max-w-2xl px-6 text-center">
          <h2 className="text-3xl font-extrabold text-slate-900 md:text-4xl">
            Ready to Stop Losing Leads?
          </h2>

          <p className="mt-4 text-lg text-slate-600">
            Take the free 2-minute assessment and discover which AI agent fits your business.
          </p>

          <Link
            href="/assignment"
            className="btn-amber mt-8 inline-flex rounded-xl bg-amber-500 px-8 py-3.5 font-semibold text-white hover:bg-amber-600"
          >
            Start Free Assessment
          </Link>
        </div>
      </section>

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="border-b border-gray-100">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex h-16 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-500">
              <span className="h-3 w-3 rounded-full bg-white" />
            </span>
            <span className="text-xl font-extrabold tracking-tight">CORE</span>
          </Link>

          <nav className="hidden items-center gap-9 text-sm font-medium text-slate-600 md:flex">
            <Link href="/" className="nav-link hover:text-slate-900">
              Home
            </Link>
            <Link href="/business/marketplace" className="nav-link hover:text-slate-900">
              Marketplace
            </Link>
            <Link href="/business/checkout" className="nav-link hover:text-slate-900">
              Pricing
            </Link>
            <Link href="/about" className="nav-link active text-amber-600">
              About
            </Link>
            <Link href="/#contact" className="nav-link hover:text-slate-900">
              Contact
            </Link>
          </nav>

          <Link
            href="/business/login"
            className="btn-amber rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-100 py-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <Link href="/" className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500">
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
            </span>

            <div>
              <p className="text-base font-extrabold leading-none text-slate-900">CORE</p>
              <p className="mt-1 text-xs text-slate-400">AI agents that work for you, 24/7.</p>
            </div>
          </Link>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <Link href="/" className="transition-colors duration-200 hover:text-amber-600">
              Home
            </Link>
            <Link href="/business/marketplace" className="transition-colors duration-200 hover:text-amber-600">
              Marketplace
            </Link>
            <Link href="/business/checkout" className="transition-colors duration-200 hover:text-amber-600">
              Pricing
            </Link>
            <Link href="/about" className="transition-colors duration-200 hover:text-amber-600">
              About
            </Link>
            <Link href="/#contact" className="transition-colors duration-200 hover:text-amber-600">
              Contact
            </Link>
            <Link href="/privacy" className="transition-colors duration-200 hover:text-amber-600">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors duration-200 hover:text-amber-600">
              Terms
            </Link>
          </nav>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">
          © 2025 CORE AI Agent Platform
        </p>
      </div>
    </footer>
  );
}