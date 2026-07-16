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

const privacySections: LegalSectionData[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: [
      `Triven AI Agent Platform ("Triven," "we," "us," or "our") provides an AI-agent marketplace and communications platform for businesses, AI Architects, and other authorized users. This Privacy Policy explains how we collect, use, disclose, retain, and protect personal information when you visit our websites, create an account, purchase, install, build, publish, configure, test, or operate an AI agent, connect third-party services, communicate with us, or interact with a Triven-powered agent (collectively, the "Platform").`,
      "This Privacy Policy applies to Business Owners, AI Architects, end-users who interact with Triven-powered agents, website visitors, and other individuals whose information is processed through the Platform.",
      "In some situations, a Business Owner determines why and how an installed agent processes an end-user's information. In those situations, the Business Owner may act as the data controller or business, and Triven may process information on the Business Owner's behalf. End-users should also review the privacy notices of the business with which they are interacting."
    ]
  },
  {
    id: "information-we-collect",
    title: "2. Information We Collect",
    body: ["Depending on how you use or interact with the Platform, we may collect the following categories of information:"],
    list: [
      {
        label: "Account and profile information:",
        text: "name, email address, phone number, account role, business name, business type, profile details, authentication data, and account preferences."
      },
      {
        label: "Business and marketplace information:",
        text: "business details, services, FAQs, agent listings, agent configurations, publishing information, buyer setup answers, connected tools, and marketplace activity."
      },
      {
        label: "Payment and transaction information:",
        text: "purchase, subscription, usage, invoice, refund, payout, tax, and billing details. Payment-card information is generally processed by our payment processors, and Triven does not intentionally store full card numbers."
      },
      {
        label: "Communications and agent-interaction data:",
        text: "caller and recipient phone numbers, call identifiers, call status, call duration, call audio or recordings when enabled, transcripts, SMS messages, email content, support messages, AI-generated responses, tool calls, appointment details, service requests, and related timestamps."
      },
      {
        label: "SMS consent and preference data:",
        text: "mobile number, consent status, date and time of consent, consent method, the business and messaging program involved, call or interaction identifier, consent-script version, STOP or HELP requests, and opt-out history."
      },
      {
        label: "Connected-service data:",
        text: "information obtained from services you choose to connect, such as calendars, email providers, telecommunications providers, payment processors, and other integrations, subject to the permissions you grant."
      },
      {
        label: "Device, log, and usage data:",
        text: "IP address, browser and device information, operating system, pages viewed, actions taken, error logs, security events, referral information, and approximate location inferred from technical data."
      },
      {
        label: "Cookies and similar technologies:",
        text: "session identifiers and other technologies used to keep you signed in, remember preferences, secure the Platform, and understand usage."
      },
      {
        label: "Information you submit to us:",
        text: "support requests, feedback, survey responses, files, documents, screenshots, and other information you voluntarily provide."
      }
    ]
  },
  {
    id: "how-we-use",
    title: "3. How We Use Information",
    body: ["We may use personal information to:"],
    list: [
      { text: "Provide, operate, maintain, secure, and improve the Platform." },
      { text: "Create and manage accounts, authenticate users, and enforce role-based access." },
      { text: "Enable Business Owners to purchase, install, configure, test, deploy, and manage AI agents." },
      { text: "Enable AI Architects to build, test, publish, license, and monitor their agents." },
      { text: "Process payments, subscriptions, usage charges, invoices, refunds, commissions, and payouts." },
      { text: "Connect calls, generate AI responses, transcribe speech, synthesize voice, send messages, book appointments, and perform other agent actions requested by authorized users." },
      { text: "Record and honor SMS consent, opt-out, and HELP requests." },
      { text: "Provide account, billing, security, service, appointment, booking, and customer-support communications." },
      { text: "Detect, investigate, and prevent fraud, abuse, security incidents, unauthorized access, spam, and violations of our terms." },
      { text: "Monitor reliability, debug errors, analyze usage, and develop new functionality." },
      { text: "Comply with legal, regulatory, carrier, telecommunications, and contractual obligations." },
      { text: "Protect the rights, property, safety, and integrity of Triven, our users, end-users, and the public." }
    ]
  },
  {
    id: "legal-bases",
    title: "4. Legal Bases for Processing",
    body: [
      "Where applicable law requires a legal basis, we process personal information as necessary to perform a contract, provide requested services, comply with legal obligations, protect vital or legitimate interests, prevent fraud and abuse, and obtain consent where required.",
      "When Triven processes end-user information on behalf of a Business Owner, the Business Owner is responsible for establishing an appropriate legal basis and providing any notices or obtaining any permissions required for its use of the Platform."
    ]
  },
  {
    id: "data-sharing",
    title: "5. How We Disclose Information",
    body: [
      "We do not sell personal information. We may disclose information only as reasonably necessary for the purposes described in this Privacy Policy, including to:"
    ],
    list: [
      {
        label: "Business Owners:",
        text: "to provide the business with information generated through its installed agents, such as customer requests, appointments, call details, transcripts, messages, and consent status."
      },
      {
        label: "AI Architects:",
        text: "to provide aggregated or de-identified performance information about agents. Unless separately authorized and legally permitted, AI Architects do not receive end-user phone numbers, call recordings, transcripts, message content, SMS consent data, or individual customer records."
      },
      {
        label: "Service providers:",
        text: "including payment processors, cloud-hosting providers, telecommunications and messaging providers, AI-model providers, speech-to-text providers, text-to-speech providers, email and calendar providers, analytics providers, security providers, monitoring providers, and customer-support tools."
      },
      {
        label: "Professional advisers:",
        text: "such as lawyers, accountants, auditors, insurers, and consultants where reasonably necessary."
      },
      {
        label: "Legal and safety recipients:",
        text: "government authorities, courts, regulators, law-enforcement agencies, or other parties when required by law or reasonably necessary to protect rights, safety, security, or prevent fraud."
      },
      {
        label: "Corporate-transaction recipients:",
        text: "in connection with a merger, financing, acquisition, reorganization, bankruptcy, sale of assets, or similar transaction, subject to appropriate confidentiality protections."
      },
      {
        label: "Recipients you direct or authorize:",
        text: "when you ask us to connect, send, export, or otherwise disclose information to another person or service."
      }
    ],
    after:
      "Service providers may process information only for the services they provide to Triven or the applicable Business Owner and are not authorized to use mobile opt-in data for their own marketing or promotional purposes."
  },
  {
    id: "ai-communications",
    title: "6. AI Agents, Calls, Recordings, and Communications",
    body: [
      "When an end-user interacts with a Triven-powered agent, information from that interaction may be processed by AI-model providers, speech-recognition providers, voice-synthesis providers, telecommunications providers, calendar providers, email providers, and other service providers required to complete the requested interaction.",
      "Depending on the agent configuration, interaction data may include call audio, call recordings, transcripts, telephone numbers, SMS messages, booking details, service requests, calendar information, tool results, and AI-generated responses.",
      "AI outputs may be inaccurate, incomplete, delayed, or inappropriate. Business Owners are responsible for reviewing their agent configurations, monitoring use, and determining when human review or intervention is required.",
      "Where calls are recorded, the Business Owner is responsible for providing legally required notice and obtaining legally required consent. Triven may also provide technical settings or prompts to support recording notices, but those features do not replace the Business Owner's legal obligations."
    ]
  },
  {
    id: "sms-messaging",
    title: "7. SMS Messaging and Consent",
    body: [
      "Triven enables businesses using the Platform to send transactional text messages to their customers and end-users. Depending on the applicable business and use case, messages may include appointment confirmations, appointment reminders, booking updates, service-request updates, account-related notices, and customer-support communications.",
      "End-users may provide consent through an approved opt-in method, including an affirmative verbal response during an inbound telephone call with an AI agent or an unchecked consent checkbox on an online form.",
      "Before any SMS is sent following verbal consent, the AI agent should identify the applicable business, describe the types of messages the end-user may receive, disclose that message frequency varies and message and data rates may apply, and explain that the end-user may reply STOP to opt out or HELP for assistance.",
      "Consent to receive text messages is not a condition of purchase, booking, or receiving services. If an end-user does not consent, the business may still complete the appointment, booking, or service request without sending text messages.",
      "Message frequency varies based on the end-user's appointments, bookings, service requests, and interactions with the applicable business. Message and data rates may apply.",
      "End-users may opt out at any time by replying STOP. After opting out, the end-user will no longer receive messages from that messaging program unless the end-user later opts in again. End-users may reply HELP for assistance.",
      "Mobile phone numbers, SMS opt-in data, and SMS consent records will not be sold, rented, transferred, or shared with third parties, affiliates, or lead generators for marketing or promotional purposes.",
      "Mobile information may be disclosed only to service providers necessary to operate and deliver the messaging service, such as telecommunications providers, messaging infrastructure providers, hosting providers, and the business with which the end-user is directly interacting. Those providers may use the information only to provide the requested services and must protect it appropriately.",
      "SMS consent is specific to the identified sending business and messaging program. Consent provided to one business is not automatically transferred to another business using Triven.",
      "Consent for marketing messages, where offered, must be collected separately from consent for transactional or informational messages and must satisfy any additional legal requirements that apply."
    ]
  },
  {
    id: "retention",
    title: "8. Data Retention",
    body: [
      "We retain personal information only for as long as reasonably necessary to provide the Platform, complete transactions, support Business Owners and AI Architects, maintain security, prevent fraud, resolve disputes, comply with legal obligations, enforce agreements, and satisfy legitimate operational needs.",
      "Retention periods may differ based on the type of information, the configuration selected by a Business Owner, contractual requirements, legal obligations, carrier requirements, and whether information is needed for an active account, transaction, dispute, investigation, or support request.",
      "Business Owners and account holders may request deletion or export of eligible information, subject to legal, security, fraud-prevention, backup, and operational retention requirements."
    ]
  },
  {
    id: "security",
    title: "9. Data Security",
    body: [
      "We use reasonable administrative, technical, and organizational safeguards designed to protect information against unauthorized access, loss, misuse, alteration, and disclosure.",
      "These safeguards may include access controls, encryption in transit, restricted production access, logging, monitoring, backups, authentication controls, and security reviews.",
      "No method of transmission or storage is completely secure, and we cannot guarantee absolute security."
    ]
  },
  {
    id: "international-transfers",
    title: "10. International Data Transfers",
    body: [
      "Triven and our service providers may process information in countries other than the country where the information was collected. Those countries may have different data-protection laws.",
      "Where required, we use appropriate safeguards for cross-border transfers, such as contractual protections or other lawful transfer mechanisms."
    ]
  },
  {
    id: "your-rights",
    title: "11. Your Privacy Rights",
    body: [
      "Depending on your location and applicable law, you may have the right to request access to, correction of, deletion of, or a copy of personal information; object to or restrict certain processing; withdraw consent; or appeal a decision concerning a privacy request.",
      "Some rights are subject to exceptions. We may need to verify your identity and authority before completing a request. When Triven processes end-user information on behalf of a Business Owner, we may direct the request to that Business Owner."
    ],
    list: [
      { text: "Access personal information we maintain about you." },
      { text: "Correct inaccurate or incomplete personal information." },
      { text: "Request deletion of eligible personal information." },
      { text: "Request a portable copy of eligible information." },
      { text: "Withdraw consent where processing is based on consent." },
      { text: "Opt out of marketing communications." },
      { text: "Submit a complaint to an applicable data-protection authority." }
    ],
    afterNode: (
      <>
        To submit a privacy request, contact{" "}
        <a
          data-testid="privacy-contact-email"
          href="mailto:info@triven.ai"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          info@triven.ai
        </a>
        .
      </>
    )
  },
  {
    id: "cookies",
    title: "12. Cookies and Similar Technologies",
    body: [
      "We use essential cookies and similar technologies to authenticate users, maintain sessions, remember preferences, secure the Platform, and provide requested functionality.",
      "We may use analytics technologies to understand usage and improve the Platform. Where required by law, we will request consent before using non-essential cookies.",
      "Browser settings may allow you to block or delete cookies, but some Platform features may not function correctly without essential cookies."
    ]
  },
  {
    id: "third-party-services",
    title: "13. Third-Party Services and Links",
    body: [
      "The Platform integrates with or links to third-party services. Those services operate under their own terms and privacy policies. Triven is not responsible for the privacy practices of third parties, and you should review their notices before connecting or using them."
    ]
  },
  {
    id: "children",
    title: "14. Children's Privacy",
    body: [
      "The Platform is not intended for individuals under 18, and we do not knowingly allow individuals under 18 to create Triven accounts. If you believe a minor has provided personal information to us, contact us so we can review and take appropriate action."
    ]
  },
  {
    id: "changes",
    title: "15. Changes to This Policy",
    body: [
      "We may update this Privacy Policy from time to time. The updated version will be posted on this page with a revised effective date. Where required by law, we will provide additional notice or obtain consent before material changes take effect."
    ]
  },
  {
    id: "contact",
    title: "16. Contact Us",
    body: ["For questions, complaints, or requests concerning this Privacy Policy or our privacy practices, contact us at:"],
    afterNode: (
      <>
        Email:{" "}
        <a
          data-testid="privacy-contact-email-footer"
          href="mailto:info@triven.ai"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          info@triven.ai
        </a>
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
          <LegalSection
            key={section.id}
            section={section}
            isLast={index === privacySections.length - 1}
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
        data-testid="privacy-title-heading"
      >
        {title}
      </h1>
      <p className="mt-4 text-sm text-slate-500" data-testid="privacy-last-updated-text">
        Last updated: {LAST_UPDATED}
      </p>
      <p className="mt-1 text-sm text-slate-500" data-testid="privacy-effective-date-text">
        Effective date: {EFFECTIVE_DATE}
      </p>
    </section>
  );
}

function LegalToc({ items }: { items: { href: string; label: string }[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-10">
      <div className="rounded-xl border border-gray-100 px-6 py-5">
        <p className="mb-3 text-sm font-semibold text-slate-900" data-testid="privacy-on-this-page-text">
          On this page
        </p>
        <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href} data-testid="privacy-toc-item">
              <a
                data-testid="privacy-toc-link"
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
        data-testid="privacy-section-title-heading"
      >
        {section.title}
      </h2>

      {section.body?.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="privacy-paragraph-text"
        >
          {paragraph}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="privacy-list-item">
              {item.label ? (
                <span className="font-medium text-slate-800" data-testid="privacy-list-label">
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
          data-testid="privacy-section-after-text"
        >
          {section.after}
        </p>
      ) : null}

      {section.afterNode ? (
        <p
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="privacy-section-after-node-text"
        >
          {section.afterNode}
        </p>
      ) : null}
    </section>
  );
}