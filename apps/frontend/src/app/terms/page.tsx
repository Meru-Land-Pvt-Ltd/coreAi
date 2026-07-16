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

const termsSections: LegalSectionData[] = [
  {
    id: "acceptance",
    title: "1. Acceptance of Terms",
    body: [
      `These Terms of Service ("Terms") are a legal agreement between you and Triven AI Agent Platform ("Triven," "we," "us," or "our") governing your access to and use of our websites, applications, marketplace, AI-agent builder, communications infrastructure, integrations, and related services (collectively, the "Platform").`,
      "By accessing or using the Platform, creating an account, purchasing or installing an agent, publishing an agent, or otherwise indicating acceptance, you agree to these Terms and our Privacy Policy. If you do not agree, do not access or use the Platform.",
      "You must be at least 18 years old and legally capable of entering into a binding agreement to use the Platform. If you use the Platform on behalf of a company or other organization, you represent that you have authority to bind that organization, and references to “you” include that organization."
    ]
  },
  {
    id: "service",
    title: "2. Description of the Platform",
    body: [
      "Triven operates a marketplace and infrastructure platform through which AI Architects may build and publish reusable AI-agent templates and Business Owners may browse, purchase, install, configure, deploy, and operate agents.",
      "The Platform may support telephone calls, SMS messages, email, calendars, voice synthesis, speech recognition, AI-model processing, workflow automation, billing, analytics, and third-party integrations.",
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
      { text: "You must promptly notify Triven if you suspect unauthorized access, credential compromise, or misuse of your account." },
      { text: "You are responsible for activity performed through your account unless caused solely by Triven's breach of these Terms." },
      { text: "We may require identity, business, payment, tax, or compliance verification before enabling certain features." }
    ]
  },
  {
    id: "business-owners",
    title: "4. Business Owner Terms",
    body: [
      "Business Owners control the live configuration and use of agents installed for their businesses. This may include business instructions, services, FAQs, telephone numbers, voice settings, communications, calendars, consent flows, testing, deployment, and customer-data handling."
    ],
    list: [
      { text: "You are responsible for reviewing an agent before deployment and confirming that its configuration is appropriate for your business and use case." },
      { text: "You are responsible for the acts and omissions of installed agents operating on your behalf." },
      { text: "You must provide accurate business information and keep customer-facing disclosures, contact details, and connected services current." },
      { text: "You must obtain all rights, permissions, and consents necessary to process customer and end-user information." },
      { text: "You must provide legally required privacy notices, call-recording notices, AI disclosures, and messaging disclosures." },
      { text: "You must supervise agent performance and provide a reasonable method for escalation to a human when appropriate." },
      { text: "You may not access, use, or attempt to control another Business Owner's installed agent, customer data, telephone number, recordings, or connected accounts." }
    ]
  },
  {
    id: "architects",
    title: "5. AI Architect Terms",
    body: [
      "AI Architects may create and submit agent templates for review and distribution through the marketplace. Publishing access does not guarantee approval, listing, sales, or continued availability."
    ],
    list: [
      { text: "You must have all rights necessary to publish your agent logic, prompts, descriptions, media, workflows, and other submitted materials." },
      { text: "Agents must be accurate in their descriptions and may not be malicious, deceptive, unlawful, unsafe, or designed to circumvent security or consent requirements." },
      { text: "You must not include secrets, production credentials, personal data, or customer-specific confidential information in a reusable template." },
      { text: "Triven may review, test, reject, suspend, unpublish, or remove an agent for quality, security, legal, operational, or marketplace reasons." },
      { text: "Commission percentages, payout thresholds, payout schedules, supported payout methods, taxes, reserves, refunds, and adjustments are governed by the terms displayed in the Platform or a separate written agreement." },
      { text: "You are responsible for taxes and reporting obligations associated with amounts paid to you." }
    ]
  },
  {
    id: "ai-services",
    title: "6. AI Services and Human Oversight",
    body: [
      "AI-generated outputs may be inaccurate, incomplete, outdated, offensive, delayed, or unsuitable for a particular purpose. The Platform does not guarantee that an agent will produce correct results or operate without interruption.",
      "You must not rely on an agent as the sole basis for decisions that could create legal, medical, financial, employment, housing, insurance, safety, or other material consequences without appropriate qualified human review.",
      "Triven does not provide legal, medical, financial, tax, employment, or other professional advice through the Platform unless expressly stated in a separate written agreement.",
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
      {
        label: "Consent:",
        text: "Obtain and maintain all legally required consent before initiating an automated or prerecorded call, recording a call, or sending an SMS message."
      },
      {
        label: "Identification:",
        text: "Clearly identify the applicable business or messaging program and do not misrepresent the sender."
      },
      {
        label: "Purpose limitation:",
        text: "Send messages only for the purposes disclosed when consent was obtained."
      },
      {
        label: "Consent records:",
        text: "Maintain evidence of consent, including the consent method, time, disclosure, applicable business, and messaging program."
      },
      {
        label: "Opt-out:",
        text: "Honor STOP and other recognized opt-out requests promptly and do not continue messaging a recipient who has opted out unless the recipient validly opts in again."
      },
      {
        label: "Help:",
        text: "Provide HELP information when requested."
      },
      {
        label: "List restrictions:",
        text: "Do not use purchased, rented, scraped, or improperly obtained contact lists."
      },
      {
        label: "Non-transferability:",
        text: "Do not transfer consent between unrelated businesses, campaigns, senders, or materially different messaging purposes."
      },
      {
        label: "Marketing separation:",
        text: "Collect marketing consent separately from transactional or informational consent where required."
      },
      {
        label: "Recording:",
        text: "Provide call-recording notice and obtain consent where required by applicable law."
      }
    ],
    after:
      "Triven may block, pause, limit, or disable calling or messaging capabilities when required for legal or carrier compliance, registration failures, suspected abuse, excessive complaints, invalid consent, prohibited content, fraud, or security concerns. Approval of an account, agent, number, Messaging Service, registration, or campaign does not guarantee that your communications comply with all applicable laws."
  },
  {
    id: "end-user-messaging",
    title: "8. End-User Messaging Disclosures",
    body: [
      "End-users who affirmatively consent may receive transactional messages from the identified Business Owner through Triven, including appointment confirmations, reminders, booking updates, service updates, account-related notices, and customer-support messages.",
      "Message frequency varies. Message and data rates may apply. End-users may reply STOP to opt out and HELP for assistance.",
      "Consent is specific to the identified sending business and messaging program and is not shared or transferred to unrelated businesses for marketing or promotional purposes.",
      "Consent to receive text messages is not a condition of purchase, booking, or receiving services unless expressly permitted by applicable law."
    ]
  },
  {
    id: "acceptable-use",
    title: "9. Acceptable Use",
    body: ["You may not use the Platform to:"],
    list: [
      { text: "Violate any law, regulation, court order, carrier rule, industry standard, or third-party right." },
      { text: "Send spam, unsolicited messages, deceptive messages, unlawful telemarketing, or communications after a recipient has opted out." },
      { text: "Harass, threaten, exploit, defraud, impersonate, discriminate against, or harm another person." },
      { text: "Misrepresent the identity of a sending business or conceal the commercial or automated nature of a communication where disclosure is required." },
      { text: "Use an individual's consent for a different business, campaign, sender, or materially different purpose." },
      { text: "Upload or use purchased, rented, scraped, or improperly obtained contact lists." },
      { text: "Send prohibited, restricted, age-gated, fraudulent, or abusive content through telecommunications providers." },
      { text: "Collect or process highly sensitive information unless you have a lawful basis, appropriate safeguards, and written authorization where required." },
      { text: "Use the Platform to make decisions that unlawfully discriminate or create material harm." },
      { text: "Upload malware, interfere with security, probe systems without authorization, bypass usage limits, or disrupt the Platform." },
      { text: "Reverse engineer, copy, scrape, or extract source code, models, prompts, data, or non-public content except where applicable law expressly permits." },
      { text: "Share or expose credentials, secrets, tokens, or private keys." },
      { text: "Resell, sublicense, or provide unauthorized access to the Platform except under a written agreement with Triven." }
    ]
  },
  {
    id: "customer-data",
    title: "10. Customer Data and Privacy Responsibilities",
    body: [
      "As between Triven and a Business Owner, the Business Owner retains its rights in customer data submitted to or generated through its installed agents, subject to end-user privacy rights and applicable law.",
      "The Business Owner represents that it has all rights and permissions necessary to provide customer data to Triven and instruct Triven and its service providers to process it.",
      "Triven may process customer data to provide, secure, support, monitor, and improve the Platform, comply with law, and perform the Business Owner's authorized instructions, as further described in our Privacy Policy and any applicable data-processing agreement.",
      "Business Owners must respond appropriately to end-user privacy requests and cooperate with Triven where necessary to fulfill those requests."
    ]
  },
  {
    id: "integrations",
    title: "11. Third-Party Services and Providers",
    body: [
      "The Platform may rely on or integrate with third-party services, including AI-model providers, voice providers, speech-recognition providers, telecommunications providers, payment processors, email providers, calendar providers, hosting services, and analytics tools.",
      "Your use of a third-party service may be subject to that provider's terms, privacy policy, pricing, limits, and approval requirements. You are responsible for maintaining valid accounts and permissions where required.",
      "Triven is not responsible for third-party outages, policy changes, account suspensions, message filtering, carrier rejections, model errors, data loss, or other failures outside Triven's reasonable control."
    ]
  },
  {
    id: "fees",
    title: "12. Fees, Purchases, Subscriptions, and Usage Charges",
    body: [
      "Agents and Platform services may be offered free of charge, through a one-time purchase, recurring subscription, usage-based pricing, or a combination of these models, as displayed at checkout or in the applicable order.",
      "Applicable charges, billing frequency, trial terms, renewal terms, usage rates, taxes, cancellation rights, and refund eligibility will be displayed before purchase or stated in a separate written agreement."
    ],
    list: [
      { text: "You authorize Triven and its payment processors to charge the selected payment method for applicable fees, taxes, usage, renewals, and approved adjustments." },
      { text: "Recurring subscriptions renew automatically until cancelled, unless otherwise stated at checkout." },
      { text: "Usage charges may continue to accrue while an agent, number, connector, or service remains active." },
      { text: "You are responsible for telecommunications, AI-model, voice, messaging, phone-number, email, calendar, and other third-party usage generated through your account where shown as billable." },
      { text: "Failed or overdue payments may result in suspension, limitation, or termination of paid features." },
      { text: "Refunds are provided only where required by law or expressly stated in the applicable checkout terms, refund policy, or written agreement." },
      { text: "Prices may change prospectively. We will provide notice where required by law or contract." }
    ]
  },
  {
    id: "marketplace",
    title: "13. Marketplace Transactions",
    body: [
      "Triven facilitates marketplace transactions between Business Owners and AI Architects but may remain the merchant of record, platform provider, licensing intermediary, or payment facilitator depending on the transaction.",
      "Purchasing an agent provides only the rights expressly described at checkout or in the applicable license. It does not transfer ownership of Triven's Platform or an Architect's underlying intellectual property.",
      "Triven may reverse, refund, withhold, offset, or adjust marketplace payments, commissions, or payouts for refunds, chargebacks, fraud, disputes, taxes, violations, or errors."
    ]
  },
  {
    id: "ip",
    title: "14. Intellectual Property",
    body: [
      "Triven and its licensors own the Platform, Triven branding, software, interfaces, infrastructure, documentation, and other materials provided by Triven, excluding content owned by users or third parties.",
      "AI Architects retain their rights in original agent logic, workflows, prompts, and materials they create, subject to the licenses granted to Triven and buyers through the Platform.",
      "Business Owners retain their rights in business content and customer data they lawfully provide, subject to the licenses necessary for Triven to operate the Platform.",
      "You grant Triven a worldwide, non-exclusive license to host, reproduce, process, display, transmit, adapt, and use content you submit solely as necessary to operate, secure, support, promote, and improve the Platform and fulfill marketplace transactions.",
      "You may provide feedback, and Triven may use that feedback without restriction or compensation, provided it does not identify confidential customer data."
    ]
  },
  {
    id: "confidentiality",
    title: "15. Confidentiality",
    body: [
      "Non-public technical, business, security, pricing, customer, and product information disclosed by one party to another and reasonably understood to be confidential must be protected and used only for the purposes of the relationship.",
      "Confidentiality obligations do not apply to information that is publicly available without breach, already lawfully known, independently developed, or lawfully received from another source without restriction.",
      "A party may disclose confidential information when required by law, after providing notice where legally permitted."
    ]
  },
  {
    id: "suspension",
    title: "16. Suspension and Termination",
    body: [
      "You may stop using the Platform at any time. Account cancellation, agent cancellation, and subscription cancellation may be subject to the terms displayed in the Platform.",
      "Triven may suspend, limit, or terminate access immediately when reasonably necessary to address security risks, unlawful conduct, non-payment, abuse, carrier or provider requirements, regulatory concerns, violations of these Terms, or harm to Triven, users, end-users, or third parties.",
      "Upon termination, your right to use the Platform ends. Certain provisions survive termination, including payment obligations, confidentiality, intellectual property, disclaimers, liability limitations, indemnification, dispute terms, and provisions that by their nature should survive.",
      "Data export and deletion are governed by the Privacy Policy, applicable law, technical limitations, and any applicable order or data-processing agreement."
    ]
  },
  {
    id: "disclaimers",
    title: "17. Disclaimers",
    body: [
      `TO THE MAXIMUM EXTENT PERMITTED BY LAW, THE PLATFORM IS PROVIDED "AS IS" AND "AS AVAILABLE." TRIVEN DISCLAIMS ALL EXPRESS, IMPLIED, AND STATUTORY WARRANTIES, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, ACCURACY, RELIABILITY, AVAILABILITY, AND RESULTS.`,
      "Triven does not warrant that the Platform, an agent, a connector, a telephone number, a model, or a third-party service will be uninterrupted, error-free, secure, compliant with your specific legal obligations, or suitable for every use case.",
      "Some jurisdictions do not allow certain warranty disclaimers, so some disclaimers may not apply to you."
    ]
  },
  {
    id: "liability",
    title: "18. Limitation of Liability",
    body: [
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, TRIVEN AND ITS AFFILIATES, OFFICERS, EMPLOYEES, CONTRACTORS, LICENSORS, AND SERVICE PROVIDERS WILL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, GOODWILL, BUSINESS OPPORTUNITIES, OR SERVICE INTERRUPTION.",
      "TO THE MAXIMUM EXTENT PERMITTED BY LAW, TRIVEN'S TOTAL AGGREGATE LIABILITY ARISING OUT OF OR RELATING TO THE PLATFORM OR THESE TERMS WILL NOT EXCEED THE GREATER OF: (A) THE AMOUNT YOU PAID TO TRIVEN FOR THE AFFECTED SERVICE DURING THE 12 MONTHS BEFORE THE EVENT GIVING RISE TO THE CLAIM; OR (B) USD $100.",
      "The limitations apply regardless of the legal theory and even if a remedy fails of its essential purpose. Some jurisdictions do not allow certain liability limitations, so some limitations may not apply to you."
    ]
  },
  {
    id: "indemnification",
    title: "19. Indemnification",
    body: [
      "To the extent permitted by law, you will defend, indemnify, and hold harmless Triven and its affiliates, officers, employees, contractors, and service providers from claims, liabilities, damages, losses, penalties, fines, costs, and expenses, including reasonable legal fees, arising from or related to your content, your agents, your communications, your customer relationships, your violation of law or third-party rights, your breach of these Terms, or your misuse of the Platform.",
      "Triven will provide reasonable notice of an indemnified claim and may participate in the defense. You may not settle a claim in a manner that admits fault by or imposes obligations on Triven without Triven's written consent."
    ]
  },
  {
    id: "disputes",
    title: "20. Governing Law and Disputes",
    body: [
      "The governing law, courts, arbitration requirements, venue, and dispute procedures applicable to your use of the Platform will be determined by the contracting Triven entity, your location, applicable law, and any separate written agreement or order form.",
      "Before filing a formal claim, the parties agree to make a good-faith effort to resolve the dispute informally by providing written notice and allowing at least 30 days for discussion, unless urgent injunctive relief is reasonably necessary.",
      "Nothing in these Terms limits rights that cannot lawfully be waived."
    ]
  },
  {
    id: "changes",
    title: "21. Changes to the Platform or Terms",
    body: [
      "We may modify the Platform and these Terms from time to time. The updated Terms will be posted with a revised effective date.",
      "Where required by law, we will provide additional notice before material changes take effect. Continued use after the effective date constitutes acceptance of the revised Terms, except where applicable law requires another form of consent."
    ]
  },
  {
    id: "general",
    title: "22. General Terms",
    list: [
      { text: "These Terms, the Privacy Policy, applicable checkout terms, order forms, policies, and written addenda constitute the agreement governing the applicable services." },
      { text: "If a conflict exists, a signed order form or written addendum controls over these Terms for the conflicting subject." },
      { text: "You may not assign these Terms without Triven's written consent. Triven may assign them in connection with a corporate transaction or to an affiliate." },
      { text: "Failure to enforce a provision is not a waiver." },
      { text: "If a provision is unenforceable, it will be modified to the minimum extent necessary, and the remaining provisions remain effective." },
      { text: "Headings are for convenience only." },
      { text: "Neither party is liable for delay caused by events beyond its reasonable control, except for payment obligations." },
      { text: "Notices may be provided electronically through the Platform, by email, or through other reasonable means." }
    ]
  },
  {
    id: "contact",
    title: "23. Contact",
    body: ["Questions about these Terms may be sent to:"],
    afterNode: (
      <>
        Email:{" "}
        <a
          data-testid="terms-contact-email"
          href="mailto:info@triven.ai"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          info@triven.ai
        </a>
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
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="terms-paragraph-text"
        >
          {paragraph}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="terms-list-item">
              {item.label ? (
                <span className="font-medium text-slate-800" data-testid="terms-list-label">
                  {item.label}{" "}
                </span>
              ) : null}
              {item.text}
            </li>
          ))}
        </ul>
      ) : null}

      {section.after ? (
        <p
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="terms-section-after-text"
        >
          {section.after}
        </p>
      ) : null}

      {section.afterNode ? (
        <p
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="terms-section-after-node-text"
        >
          {section.afterNode}
        </p>
      ) : null}
    </section>
  );
}