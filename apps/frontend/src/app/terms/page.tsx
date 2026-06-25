import Link from "next/link";

const termsSections = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: [
      `By accessing or using the CORE AI Agent Platform ("CORE," "we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Platform. You must be at least 18 years old to create an account or use CORE in any capacity.`
    ]
  },
  {
    id: "description",
    title: "2. Description of Service",
    body: [
      "CORE is a marketplace that connects Business Owners with AI agents built by independent AI Architects. Business Owners can browse, install, and use AI agents to automate tasks such as lead capture and follow-up. AI Architects can build, publish, and sell AI agents to businesses through the marketplace. CORE provides the underlying infrastructure, connectors, and marketplace through which these agents are built, distributed, and run."
    ]
  },
  {
    id: "account-terms",
    title: "3. Account Terms",
    list: [
      { text: "You must provide accurate, current information when creating an account." },
      { text: "Each person may maintain only one account on the Platform." },
      { text: "You are responsible for maintaining the security of your account and any activity that occurs under it." },
      { text: "Accounts are authenticated by email and a one-time passcode (OTP); you are responsible for keeping access to your email secure." }
    ]
  },
  {
    id: "business-owner-terms",
    title: "4. Business Owner Terms",
    list: [
      { text: "Subscriptions to agents are billed monthly." },
      { text: "Installed agents operate on your behalf using the third-party accounts you connect to them (such as email, calendar, or SMS)." },
      { text: "You are responsible for how your installed agents interact with your customers and end-users." },
      { text: "We offer a 30-day money-back guarantee on your first installed agent." },
      { text: "Cancellations take effect at the end of the current billing period; you will retain access until then." }
    ]
  },
  {
    id: "architect-terms",
    title: "5. AI Architect Terms",
    list: [
      { text: "Revenue is shared 70% to the Architect and 30% to CORE on each subscription sale." },
      { text: "Agents must pass our quality review process before being listed on the marketplace." },
      { text: "Agents may not be malicious, deceptive, or otherwise designed to cause harm." },
      { text: "Architects retain intellectual property ownership of their original agent logic and configurations." },
      { text: "CORE reserves the right to remove any agent that violates these Terms or our marketplace guidelines." },
      { text: "Payouts are issued monthly, subject to a minimum balance of $50; balances below this threshold roll over to the following month." }
    ]
  },
  {
    id: "acceptable-use",
    title: "6. Acceptable Use",
    list: [
      { text: "You may not use agents to send spam, harass others, or engage in illegal activity." },
      { text: "You may not scrape, reverse engineer, or attempt to extract the underlying code of the Platform." },
      { text: "You may not resell access to the Platform or its agents without our prior written authorization." },
      { text: "Agents must comply with applicable laws, including the Telephone Consumer Protection Act (TCPA) for SMS communications and the CAN-SPAM Act for email communications." }
    ]
  },
  {
    id: "intellectual-property",
    title: "7. Intellectual Property",
    list: [
      { text: "CORE owns the Platform, the CORE brand, and all underlying infrastructure." },
      { text: "AI Architects own their original agent configurations and logic." },
      { text: "Business Owners own the customer data generated through their installed agents." },
      { text: "Any content you submit to the Platform remains your property." }
    ]
  },
  {
    id: "payment-terms",
    title: "8. Payment Terms",
    list: [
      { text: "All prices on the Platform are listed in U.S. Dollars (USD)." },
      { text: "Subscriptions automatically renew unless cancelled before the next billing date." },
      { text: "If a payment fails, you will have a 3-day grace period to update your payment method before your account is suspended." },
      { text: "Refunds are issued in accordance with our refund policy, including the 30-day money-back guarantee on your first agent." }
    ]
  },
  {
    id: "liability",
    title: "9. Limitation of Liability",
    body: [
      `The Platform is provided "as is" without warranties of any kind. CORE is not liable for agent errors, missed messages, or lost revenue resulting from the use of agents on the Platform. Our maximum aggregate liability to you for any claim arising out of these Terms is limited to the fees you paid to CORE in the 12 months preceding the claim. We are not responsible for outages or failures of third-party connectors integrated into the Platform.`
    ]
  },
  {
    id: "termination",
    title: "10. Termination",
    list: [
      { text: "Either party may terminate this agreement with 30 days' written notice." },
      { text: "CORE may terminate your account immediately in the event of a violation of these Terms." },
      { text: "Following termination, you will have 30 days to export your data before it is permanently deleted." }
    ]
  },
  {
    id: "disputes",
    title: "11. Dispute Resolution",
    body: [
      "These Terms are governed by the laws of the State of Delaware, USA, without regard to its conflict of law principles. Before initiating a formal claim, both parties agree to attempt informal resolution for a period of 30 days. If a dispute is not resolved informally, the parties agree to resolve it through binding arbitration rather than in court, except where prohibited by law."
    ]
  },
  {
    id: "changes",
    title: "12. Changes to Terms",
    body: [
      "We may update these Terms from time to time. We will provide at least 30 days' notice before any material change takes effect. Your continued use of the Platform after a change becomes effective constitutes your acceptance of the revised Terms."
    ]
  },
  {
    id: "contact",
    title: "13. Contact",
    body: ["If you have questions about these Terms, reach out to us at:"],
    afterNode: (
      <>
        Email:{" "}
        <a href="mailto:legal@trycore.ai" className="font-medium text-amber-600 hover:text-amber-700">
          legal@trycore.ai
        </a>
        <br />
        Mail: CORE AI Agent Platform, 123 Market Street, Suite 400, San Francisco, CA 94103
      </>
    )
  }
];

const tocItems = termsSections.map((section) => ({
  href: `#${section.id}`,
  label: section.title.replace(/^\d+\.\s*/, "")
}));

export default function TermsPage() {
  return (
    <LegalPageShell>
      <LegalHero title="Terms of Service" />

      <LegalToc items={tocItems} />

      <main className="mx-auto max-w-3xl px-6 pb-20">
        {termsSections.map((section, index) => (
          <LegalSection key={section.id} section={section} isLast={index === termsSections.length - 1} />
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
            <Link href="/business/marketplace" className="transition hover:text-amber-600">Marketplace</Link>
            <Link href="/business/checkout" className="transition hover:text-amber-600">Pricing</Link>
            <Link href="/#about" className="transition hover:text-amber-600">About</Link>
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