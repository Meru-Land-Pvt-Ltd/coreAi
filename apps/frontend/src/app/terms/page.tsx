"use client";
import { useState } from "react";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";

const termsSections = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: [
      `By accessing or using the Triven AI Agent Platform ("Triven," "we," "us," or "our"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Platform. You must be at least 18 years old to create an account or use Triven in any capacity.`
    ]
  },
  {
    id: "description",
    title: "2. Description of Service",
    body: [
      "Triven is a marketplace that connects Business Owners with AI agents built by independent AI Architects. Business Owners can browse, install, and use AI agents to automate tasks such as lead capture and follow-up. AI Architects can build, publish, and sell AI agents to businesses through the marketplace. Triven provides the underlying infrastructure, connectors, and marketplace through which these agents are built, distributed, and run."
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
      { text: "Revenue is shared 70% to the Architect and 30% to Triven on each subscription sale." },
      { text: "Agents must pass our quality review process before being listed on the marketplace." },
      { text: "Agents may not be malicious, deceptive, or otherwise designed to cause harm." },
      { text: "Architects retain intellectual property ownership of their original agent logic and configurations." },
      { text: "Triven reserves the right to remove any agent that violates these Terms or our marketplace guidelines." },
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
      { text: "Triven owns the Platform, the Triven brand, and all underlying infrastructure." },
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
      `The Platform is provided "as is" without warranties of any kind. Triven is not liable for agent errors, missed messages, or lost revenue resulting from the use of agents on the Platform. Our maximum aggregate liability to you for any claim arising out of these Terms is limited to the fees you paid to Triven in the 12 months preceding the claim. We are not responsible for outages or failures of third-party connectors integrated into the Platform.`
    ]
  },
  {
    id: "termination",
    title: "10. Termination",
    list: [
      { text: "Either party may terminate this agreement with 30 days' written notice." },
      { text: "Triven may terminate your account immediately in the event of a violation of these Terms." },
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
        <a data-testid="terms-legal-trycore-ai-link" href="mailto:info@triven.ai" className="font-medium text-amber-600 hover:text-amber-700">
          info@triven.ai
        </a>
        <br />
        Mail: Triven AI Agent Platform, 123 Market Street, Suite 400, San Francisco, CA 94103
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
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <style
        dangerouslySetInnerHTML={{
          __html: `
            html { scroll-behavior: smooth; }
            section[id] { scroll-margin-top: 6rem; }
          `
        }}
      />

      <CoreHeader navTop={0} navScrolled={false} menuOpen={false} onToggleMenu={function (): void {
        throw new Error("Function not implemented.");
      }} onCloseMenu={function (): void {
        throw new Error("Function not implemented.");
      }} />

      {children}

      <CoreFooter />
    </div>
  );
}

function LegalHero({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-8 pt-32 md:pt-36">
      <h1 className="text-4xl font-extrabold tracking-tight text-slate-900" data-testid="terms-title-heading">{title}</h1>
      <p className="mt-4 text-sm text-slate-500" data-testid="terms-last-updated-june-2025-text">Last updated: June 2025</p>
      <p className="mt-1 text-sm text-slate-500" data-testid="terms-effective-date-june-2025-text">Effective date: June 2025</p>
    </section>
  );
}

function LegalToc({ items }: { items: { href: string; label: string }[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-10">
      <div className="rounded-xl border border-gray-100 px-6 py-5">
        <p className="mb-3 text-sm font-semibold text-slate-900" data-testid="terms-on-this-page-text">On this page</p>
        <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href} data-testid="terms-label-item">
              <a data-testid="terms-link" href={item.href} className="transition hover:text-amber-600">
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
      <h2 className="mt-10 text-xl font-bold text-slate-900" data-testid="terms-section-title-heading">{section.title}</h2>

      {section.body?.map((paragraph) => (
        <p key={paragraph} className="mt-4 text-base leading-relaxed text-slate-600" data-testid="terms-paragraph-text">
          {paragraph}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-inside list-disc space-y-3 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="terms-label-item-2">
              {item.label ? <span className="font-medium text-slate-800" data-testid="terms-label-text">{item.label} </span> : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}

      {section.after ? (
        <p className="mt-4 text-base leading-relaxed text-slate-600" data-testid="terms-section-after-text">{section.after}</p>
      ) : null}

      {section.afterNode ? (
        <p className="mt-4 text-base leading-relaxed text-slate-600" data-testid="terms-section-after-node-text">{section.afterNode}</p>
      ) : null}
    </section>
  );
}
