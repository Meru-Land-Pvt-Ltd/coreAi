"use client";

import { useEffect, useState, type ReactNode } from "react";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";

type LegalListItem = {
  label?: string;
  text: string;
};

type LegalSectionData = {
  id: string;
  title: string;
  body?: string[];
  list?: LegalListItem[];
  after?: string;
  afterNode?: ReactNode;
};

const LAST_UPDATED = "July 2026";
const EFFECTIVE_DATE = "July 2026";

const BRAND_NAME_CLASS = "font-semibold";
const KEYWORD_CLASS = "font-semibold text-black";
const LINK_CLASS = "font-medium text-amber-600 hover:text-amber-700";
const RICH_TEXT_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|Data Deletion Instructions(?:\s*\(https:\/\/triven\.ai\/data-deletion\))?|Security page(?:\s*\(https:\/\/triven\.ai\/security\))?|Data Processing Addendum \(DPA\)(?:\s*\(https:\/\/triven\.ai\/DPA\))?|Privacy Policy(?:\s*\(https:\/\/triven\.ai\/privacy\))?|\bTriven\.ai\b|\bCollabGlam LLC\b|\bCollabGlam\b|\bWhatsApp Business Platform\b|\bWhatsApp Business Account\b|\bWhatsApp Business\b|\bWhatsApp\b|\bTriven\b|\bMeta\b|\bSTOP\b/g;

function isEmailAddress(value: string): boolean {
  return value.includes("@");
}

function isKeyword(value: string): boolean {
  return value === "STOP";
}

function getPolicyRoute(matchedText: string): { href: string; label: string } | null {
  if (matchedText.startsWith("Data Deletion Instructions")) {
    return { href: "/data-deletion", label: "Data Deletion Instructions" };
  }
  if (matchedText.startsWith("Security page")) {
    return { href: "/security", label: "Security page" };
  }
  if (matchedText.startsWith("Terms of Service")) {
    return { href: "/terms", label: "Terms of Service" };
  }
  if (matchedText.startsWith("Data Processing Addendum")) {
    return { href: "/DPA", label: "Data Processing Addendum (DPA)" };
  }
  if (matchedText.startsWith("Privacy Policy")) {
    return { href: "/privacy", label: "Privacy Policy" };
  }
  return null;
}

function highlightBrands(text: string): ReactNode {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(RICH_TEXT_PATTERN)) {
    const matchedText = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      nodes.push(text.slice(lastIndex, matchIndex));
    }

    if (isEmailAddress(matchedText)) {
      const mailtoHref =
        matchedText.toLowerCase() === "info@triven.ai"
          ? `mailto:${matchedText}?subject=Terms%20Inquiry`
          : `mailto:${matchedText}`;

      nodes.push(
        <a
          key={`${matchIndex}-${matchedText}`}
          href={mailtoHref}
          className={LINK_CLASS}
          data-testid="terms-email-link"
        >
          {matchedText}
        </a>
      );
    } else if (isKeyword(matchedText)) {
      nodes.push(
        <span
          key={`${matchIndex}-${matchedText}`}
          className={KEYWORD_CLASS}
          data-testid="terms-keyword"
        >
          {matchedText}
        </span>
      );
    } else {
      const policyRoute = getPolicyRoute(matchedText);

      if (policyRoute) {
        nodes.push(
          <a
            key={`${matchIndex}-${matchedText}`}
            href={policyRoute.href}
            className={LINK_CLASS}
            data-testid="terms-route-link"
          >
            {policyRoute.label}
          </a>
        );
      } else {
        nodes.push(
          <span
            key={`${matchIndex}-${matchedText}`}
            className={BRAND_NAME_CLASS}
            data-testid="terms-brand-name"
          >
            {matchedText}
          </span>
        );
      }
    }
    lastIndex = matchIndex + matchedText.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? <>{nodes}</> : text;
}

const termsSections: LegalSectionData[] = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: [
      "These Terms of Service (Terms) are a legal agreement between you and CollabGlam LLC, doing business as Triven.ai (Triven.ai, Triven, we, us, or our), governing your access to and use of our websites, applications, marketplace, AI-agent builder, communications infrastructure, integrations, and related services (collectively, the Platform).",
      "By accessing or using the Platform, creating an account, purchasing or installing an agent, publishing an agent, or otherwise indicating acceptance, you agree to these Terms and our Privacy Policy. If you do not agree, do not access or use the Platform.",
      "You must be at least 18 years old and legally capable of entering into a binding agreement to use the Platform. If you use the Platform on behalf of a company or other organization, you represent that you have authority to bind that organization, and references to you include that organization."
    ]
  },
  {
    id: "service",
    title: "2. Description of the Platform",
    body: [
      "Triven.ai operates a marketplace and infrastructure platform through which AI Architects may build and publish reusable AI-agent templates and Business Owners may browse, purchase, install, configure, deploy, and operate agents.",
      "The Platform may support telephone calls, SMS messages, email, calendars, voice synthesis, speech recognition, AI-model processing, workflow automation, billing, analytics, and third-party integrations, including the Meta WhatsApp Business Platform.",
      "Features, availability, providers, limits, supported countries, pricing, and functionality may change over time. Some features may be identified as beta, preview, experimental, or subject to third-party approval."
    ]
  },
  {
    id: "accounts",
    title: "3. Accounts and Security",
    list: [
      { text: "You must provide accurate, complete, and current account information." },
      { text: "You must use the correct account role and may not misrepresent your identity, authority, business, or affiliation." },
      { text: "You are responsible for protecting your login credentials, email account, authentication methods, API keys, and connected-service credentials." },
      { text: "You must promptly notify Triven.ai if you suspect unauthorized access, credential compromise, or misuse of your account." },
      { text: "You are responsible for activity performed through your account unless caused solely by Triven.ai's breach of these Terms." },
      { text: "We may require identity, business, payment, tax, or compliance verification before enabling certain features." }
    ]
  },
  {
    id: "business-owners",
    title: "4. Business Owner Terms",
    body: ["Business Owners control the live configuration and use of agents installed for their businesses. This may include business instructions, services, FAQs, telephone numbers, voice settings, communications, calendars, consent flows, testing, deployment, and customer-data handling."],
    list: [
      { text: "You are responsible for reviewing an agent before deployment and confirming that its configuration is appropriate for your business and use case." },
      { text: "You are responsible for the acts and omissions of installed agents operating on your behalf." },
      { text: "You must provide accurate business information and keep customer-facing disclosures, contact details, and connected services current." },
      { text: "You must obtain all rights, permissions, and consents necessary to process customer and end-user information." },
      { text: "You must provide legally required privacy notices, call-recording notices, AI disclosures, and messaging disclosures." },
      { text: "You must supervise agent performance and provide a reasonable method for escalation to a human when appropriate." },
      { text: "You may not access, use, or attempt to control another Business Owner's installed agent, customer data, telephone number, recordings, or connected accounts." },
      { text: "If you connect a Meta product, including the WhatsApp Business Platform, you must comply with Meta's applicable terms and policies — including the Meta Platform Terms and the WhatsApp Business Messaging Policy — in addition to these Terms. Triven.ai may suspend or disable a Meta integration where required to comply with Meta's own policies or a request from Meta." }
    ]
  },
  {
    id: "architects",
    title: "5. AI Architect Terms",
    body: ["AI Architects may create and submit agent templates for review and distribution through the marketplace. Publishing access does not guarantee approval, listing, sales, or continued availability."],
    list: [
      { text: "You must have all rights necessary to publish your agent logic, prompts, descriptions, media, workflows, and other submitted materials." },
      { text: "Agents must be accurate in their descriptions and may not be malicious, deceptive, unlawful, unsafe, or designed to circumvent security or consent requirements." },
      { text: "You must not include secrets, production credentials, personal data, or customerspecific confidential information in a reusable template." },
      { text: "Triven.ai may review, test, reject, suspend, unpublish, or remove an agent for quality, security, legal, operational, or marketplace reasons." },
      { text: "Commission percentages, payout thresholds, payout schedules, supported payout methods, taxes, reserves, refunds, and adjustments are governed by the terms displayed in the Platform or a separate written agreement." },
      { text: "You are responsible for taxes and reporting obligations associated with amounts paid to you." },
      { text: "Lessons you deliberately teach the AI Builder (\"Teach the Builder\") may be used, anonymously and without any model training, to improve the Builder's written guidance for the Platform. You can mark any lesson private to you, and you can delete your lessons at any time." }
    ]
  },
  {
    id: "ai-services",
    title: "6. AI Services and Human Oversight",
    body: [
      "AI-generated outputs may be inaccurate, incomplete, outdated, offensive, delayed, or unsuitable for a particular purpose. The Platform does not guarantee that an agent will produce correct results or operate without interruption.",
      "All AI processing on the Platform is inference-only. Triven.ai does not use Customer Data, end-user interaction data, or data received from connected third-party services (including Google Workspace APIs) to create, train, or fine-tune generalized or shared AI or machinelearning models, and does not permit its AI service providers to do so with data sent through the Platform.",
      "You must not rely on an agent as the sole basis for decisions that could create legal, medical, financial, employment, housing, insurance, safety, or other material consequences without appropriate qualified human review.",
      "Triven.ai does not provide legal, medical, financial, tax, employment, or other professional advice through the Platform unless expressly stated in a separate written agreement.",
      "Business Owners are responsible for determining when human review, approval, correction, disclosure, or intervention is required."
    ]
  },
  {
    id: "calling-sms",
    title: "7. Calling, SMS Messaging, and End-User Consent",
    body: [
      "Business Owners may use installed agents to communicate with customers and end-users through telephone calls, text messages, email, and other connected services.",
      "Each Business Owner is responsible for ensuring that its use of calls, recordings, automated communications, and messages complies with applicable laws, carrier rules, telecommunications requirements, industry standards, and consent obligations."
    ],
    list: [
      { label: "Consent:", text: "Obtain and maintain all legally required consent before initiating an automated or prerecorded call, recording a call, or sending an SMS message." },
      { label: "Identification:", text: "Clearly identify the applicable business or messaging program and do not misrepresent the sender." },
      { label: "Purpose limitation:", text: "Send messages only for the purposes disclosed when consent was obtained." },
      { label: "Consent records:", text: "Maintain evidence of consent, including the consent method, time, disclosure, applicable business, and messaging program." },
      { label: "Opt-out:", text: "Honor STOP and other recognized opt-out requests promptly and do not continue messaging a recipient who has opted out unless the recipient validly opts in again." },
      { label: "Help:", text: "Provide HELP information when requested." },
      { label: "List restrictions:", text: "Do not use purchased, rented, scraped, or improperly obtained contact lists." },
      { label: "Non-transferability:", text: "Do not transfer consent between unrelated businesses, campaigns, senders, or materially different messaging purposes." },
      { label: "Marketing separation:", text: "Collect marketing consent separately from transactional or informational consent where required." },
      { label: "Recording:", text: "Provide call-recording notice and obtain consent where required by applicable law." }
    ],
    after: "Triven.ai may block, pause, limit, or disable calling or messaging capabilities when required for legal or carrier compliance, registration failures, suspected abuse, excessive complaints, invalid consent, prohibited content, fraud, or security concerns. Approval of an account, agent, number, Messaging Service, registration, or campaign does not guarantee that your communications comply with all applicable laws."
  },
  {
    id: "end-user-messaging",
    title: "8. Triven.ai SMS Program and End-User Messaging Disclosures",
    body: [
      "End-user SMS consent may be provided verbally during an inbound AI-assisted call (after the standardized consent disclosure is read aloud) or through a separate, optional consent checkbox on a public booking or service-request form that is unchecked by default and never required to submit the form.",
      "Consent is specific to the identified sending business and messaging program and is not shared or transferred to unrelated businesses for marketing or promotional purposes.",
      "Business Owners remain responsible for lawful calling, call recording, and messaging practices, including any notices and consents required by applicable law.",
      "Triven.ai may disable or restrict messaging for invalid consent, end-user complaints, carrier requirements, or abuse."
    ],
    afterNode: (
      <>
        Triven.ai SMS Program: Users who provide affirmative consent may receive appointment
        confirmations, reminders, booking updates, rescheduling notices, cancellations, service
        updates, and customer-support messages from the identified business through Triven.ai.
        Message frequency varies. Message and data rates may apply. Reply <strong>STOP</strong> to
        opt out or <strong>HELP</strong> for assistance. Consent is not a condition of purchase,
        booking, or receiving services.
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
          <LegalSection
            key={section.id}
            section={section}
            isLast={index === termsSections.length - 1}
          />
        ))}
      </main>
    </LegalPageShell>
  );
}

function LegalPageShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

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

      <CoreHeader
        navTop={0}
        navScrolled={navScrolled}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      {children}

      <CoreFooter />
    </div>
  );
}

function LegalHero({ title }: { title: string }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-8 pt-32 md:pt-36">
      <h1
        className="text-4xl font-extrabold tracking-tight text-slate-900"
        data-testid="terms-title-heading"
      >
        {title}
      </h1>
      <p className="mt-4 text-sm text-slate-500" data-testid="terms-last-updated-text">
        Last updated: {LAST_UPDATED}
      </p>
      <p className="mt-1 text-sm text-slate-500" data-testid="terms-effective-date-text">
        Effective date: {EFFECTIVE_DATE}
      </p>
    </section>
  );
}

function LegalToc({ items }: { items: { href: string; label: string }[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-10">
      <div className="rounded-xl border border-gray-100 px-6 py-5">
        <p className="mb-3 text-sm font-semibold text-slate-900" data-testid="terms-on-this-page-text">
          On this page
        </p>
        <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href} data-testid="terms-toc-item">
              <a
                data-testid="terms-toc-link"
                href={item.href}
                className="transition hover:text-amber-600"
              >
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
  section: LegalSectionData;
  isLast: boolean;
}) {
  return (
    <section id={section.id} className={`pb-8 ${isLast ? "" : "border-b border-gray-100"}`}>
      <h2
        className="mt-10 text-xl font-bold text-slate-900"
        data-testid="terms-section-title-heading"
      >
        {section.title}
      </h2>

      {section.body?.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 text-base leading-relaxed text-slate-600 whitespace-pre-line"
          data-testid="terms-paragraph-text"
        >
          {highlightBrands(paragraph)}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="terms-list-item">
              {item.label ? (
                <span className="font-medium text-slate-800" data-testid="terms-list-label">
                  {highlightBrands(item.label)}{" "}
                </span>
              ) : null}
              {highlightBrands(item.text)}
            </li>
          ))}
        </ul>
      ) : null}

      {section.after ? (
        <p
          className="mt-4 text-base leading-relaxed text-slate-600 whitespace-pre-line"
          data-testid="terms-section-after-text"
        >
          {highlightBrands(section.after)}
        </p>
      ) : null}

      {section.afterNode ? (
        <div
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="terms-section-after-node-text"
        >
          {section.afterNode}
        </div>
      ) : null}
    </section>
  );
}
