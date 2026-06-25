import Link from "next/link";

const privacySections = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: [
      `CORE AI Agent Platform ("CORE," "we," "us," or "our") operates a marketplace that connects businesses with AI agents built by independent AI Architects. This Privacy Policy explains how we collect, use, share, and protect information when you visit our website, create an account, install or build an agent, or otherwise use our services (collectively, the "Platform"). It applies to Business Owners, AI Architects, and visitors to the Platform. By using CORE, you agree to the practices described in this policy.`
    ]
  },
  {
    id: "information-we-collect",
    title: "2. Information We Collect",
    body: ["We collect the following categories of information:"],
    list: [
      {
        label: "Account information:",
        text: "your name, email address, and phone number when you create an account or contact us."
      },
      {
        label: "Usage data:",
        text: "pages you visit, agents you install or publish, and how you interact with the Platform."
      },
      {
        label: "Payment information:",
        text: "processed by our third-party payment processors. CORE does not store your full card numbers."
      },
      {
        label: "Agent interaction data:",
        text: "conversations and interactions between AI agents and end-users, where an agent is installed for a business."
      }
    ]
  },
  {
    id: "how-we-use",
    title: "3. How We Use Your Information",
    body: ["We use the information we collect to:"],
    list: [
      { text: "Provide, maintain, and improve the Platform and the services available through it." },
      { text: "Process transactions, including subscriptions and payouts to AI Architects." },
      { text: "Send service communications, such as account, billing, and security notices." },
      { text: "Personalize agent recommendations for Business Owners based on industry and usage patterns." },
      { text: "Perform analytics to understand how the Platform is used and to guide future development." }
    ]
  },
  {
    id: "data-sharing",
    title: "4. Data Sharing",
    body: [
      "We do not sell your personal data. We share information only in the following limited circumstances:"
    ],
    list: [
      { text: "With payment processors, to complete transactions and payouts." },
      { text: "With AI model providers, on an anonymized basis, to power agent conversations and outputs." },
      { text: "With analytics tools, to help us understand and improve the Platform." }
    ],
    after:
      "AI Architects who build agents can see aggregated, anonymized analytics about how their agents are performing — such as install counts and usage trends — but never the individual identity or data of an end-user."
  },
  {
    id: "ai-agent-data",
    title: "5. AI Agent Data Processing",
    body: [
      `When an end-user interacts with an AI agent installed by a business, that conversation may be processed by third-party large language model ("LLM") providers in order to generate the agent's responses. We require these providers to handle data in line with our security and confidentiality standards.`,
      "Conversation logs are retained for 90 days for quality, support, and troubleshooting purposes, after which they are automatically deleted. Business Owners retain ownership of their own customer data collected through their installed agents."
    ]
  },
  {
    id: "data-security",
    title: "6. Data Security",
    body: [
      "We use 256-bit encryption to protect data both in transit and at rest. CORE maintains SOC 2 compliance and undergoes regular independent security audits to identify and address potential vulnerabilities. While no system can be guaranteed to be 100% secure, we are committed to protecting the information you entrust to us."
    ]
  },
  {
    id: "your-rights",
    title: "7. Your Rights",
    body: ["Depending on your location, you have the right to:"],
    list: [
      { text: "Access, correct, or delete the personal data we hold about you." },
      { text: "Opt out of marketing communications at any time." },
      { text: "Request an export of your data in a portable format." }
    ],
    afterNode: (
      <>
        To exercise any of these rights, contact us at{" "}
        <a href="mailto:privacy@trycore.ai" className="font-medium text-amber-600 hover:text-amber-700">
          privacy@trycore.ai
        </a>
        .
      </>
    )
  },
  {
    id: "cookies",
    title: "8. Cookies",
    body: ["We use a limited set of cookies:"],
    list: [
      {
        label: "Essential cookies:",
        text: "required to keep you logged in and maintain your session."
      },
      {
        label: "Analytics cookies:",
        text: "help us understand Platform usage; you may opt out at any time."
      }
    ],
    after: "We do not use advertising cookies."
  },
  {
    id: "childrens-privacy",
    title: "9. Children's Privacy",
    body: [
      "CORE is not intended for, and should not be used by, individuals under the age of 18. We do not knowingly collect personal data from anyone under 18. If you believe a minor has provided us with personal data, please contact us so we can take appropriate action."
    ]
  },
  {
    id: "changes",
    title: "10. Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. If we make material changes, we will notify you by email before the changes take effect. Continued use of the Platform after a change becomes effective constitutes acceptance of the revised policy."
    ]
  },
  {
    id: "contact-us",
    title: "11. Contact Us",
    body: ["If you have questions about this Privacy Policy or how we handle your data, reach out to us at:"],
    afterNode: (
      <>
        Email:{" "}
        <a href="mailto:privacy@trycore.ai" className="font-medium text-amber-600 hover:text-amber-700">
          privacy@trycore.ai
        </a>
        <br />
        Mail: CORE AI Agent Platform, 123 Market Street, Suite 400, San Francisco, CA 94103
      </>
    )
  }
];

const tocItems = privacySections.map((section) => ({
  href: `#${section.id}`,
  label: section.title.replace(/^\d+\.\s*/, "")
}));

export default function PrivacyPage() {
  return (
    <LegalPageShell>
      <LegalHero title="Privacy Policy" />

      <LegalToc items={tocItems} />

      <main className="mx-auto max-w-3xl px-6 pb-20">
        {privacySections.map((section, index) => (
          <LegalSection key={section.id} section={section} isLast={index === privacySections.length - 1} />
        ))}
      </main>
    </LegalPageShell>
  );
}

function LegalPageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html { scroll-behavior: smooth; }
            section[id] { scroll-margin-top: 5rem; }
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
            .nav-link:hover::after { transform: scaleX(1); }
          `
        }}
      />

      <LegalHeader />
      {children}
      <LegalFooter />
    </div>
  );
}

function LegalHeader() {
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
            <Link href="/" className="nav-link hover:text-slate-900">Home</Link>
            <Link href="/business/marketplace" className="nav-link hover:text-slate-900">Marketplace</Link>
            <Link href="/business/checkout" className="nav-link hover:text-slate-900">Pricing</Link>
            <Link href="/#about" className="nav-link hover:text-slate-900">About</Link>
            <Link href="/#contact" className="nav-link hover:text-slate-900">Contact</Link>
          </nav>

          <Link
            href="/business/login"
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:bg-amber-600 hover:shadow-lg hover:shadow-amber-500/30"
          >
            Get Started
          </Link>
        </div>
      </div>
    </header>
  );
}

function LegalHero({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-8 pt-16">
      <h1 className="text-4xl font-extrabold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-4 text-sm text-slate-500">Last updated: June 2025</p>
      <p className="mt-1 text-sm text-slate-500">Effective date: June 2025</p>
    </section>
  );
}

function LegalToc({ items }: { items: { href: string; label: string }[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-10">
      <div className="rounded-xl border border-gray-100 px-6 py-5">
        <p className="mb-3 text-sm font-semibold text-slate-900">On this page</p>
        <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href}>
              <a href={item.href} className="transition hover:text-amber-600">
                {item.label}
              </a>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function LegalSection({
  section,
  isLast
}: {
  section: {
    id: string;
    title: string;
    body?: string[];
    list?: { label?: string; text: string }[];
    after?: string;
    afterNode?: React.ReactNode;
  };
  isLast: boolean;
}) {
  return (
    <section id={section.id} className={`pb-8 ${isLast ? "" : "border-b border-gray-100"}`}>
      <h2 className="mt-10 text-xl font-bold text-slate-900">{section.title}</h2>

      {section.body?.map((paragraph) => (
        <p key={paragraph} className="mt-4 text-base leading-relaxed text-slate-600">
          {paragraph}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-inside list-disc space-y-3 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`}>
              {item.label ? <span className="font-medium text-slate-800">{item.label} </span> : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}

      {section.after ? (
        <p className="mt-4 text-base leading-relaxed text-slate-600">{section.after}</p>
      ) : null}

      {section.afterNode ? (
        <p className="mt-4 text-base leading-relaxed text-slate-600">{section.afterNode}</p>
      ) : null}
    </section>
  );
}

function LegalFooter() {
  return (
    <footer className="border-t border-gray-100 bg-gray-50 py-12">
      <div className="mx-auto max-w-6xl px-6">
        <div className="flex flex-col items-center justify-between gap-6 md:flex-row">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500">
              <span className="h-2.5 w-2.5 rounded-full bg-white" />
            </span>
            <div>
              <p className="text-base font-extrabold leading-none text-slate-900">CORE</p>
              <p className="mt-1 text-xs text-slate-400">AI agents that work for you, 24/7.</p>
            </div>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-slate-500">
            <Link href="/" className="transition hover:text-amber-600">Home</Link>
            <Link href="/marketplace" className="transition hover:text-amber-600">Marketplace</Link>
            <Link href="/business/checkout" className="transition hover:text-amber-600">Pricing</Link>
            <Link href="/about" className="transition hover:text-amber-600">About</Link>
            <Link href="/#contact" className="transition hover:text-amber-600">Contact</Link>
            <Link href="/privacy" className="transition hover:text-amber-600">Privacy</Link>
            <Link href="/terms" className="transition hover:text-amber-600">Terms</Link>
          </nav>
        </div>

        <p className="mt-8 text-center text-xs text-slate-400">© 2025 CORE AI Agent Platform</p>
      </div>
    </footer>
  );
}