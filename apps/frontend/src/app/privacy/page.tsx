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
const LINK_CLASS = "font-medium text-amber-600 hover:text-amber-700";
const RICH_TEXT_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|Data Deletion Instructions(?:\s*\(https:\/\/triven\.ai\/data-deletion\))?|Security page(?:\s*\(https:\/\/triven\.ai\/security\))?|Terms of Service(?:\s*\(https:\/\/triven\.ai\/terms\))?|Data Processing Addendum \(DPA\)(?:\s*\(https:\/\/triven\.ai\/DPA\))?|\bTriven\.ai\b|\bCollabGlam LLC\b|\bCollabGlam\b|\bWhatsApp Business Platform\b|\bWhatsApp Business Account\b|\bWhatsApp Business\b|\bWhatsApp\b|\bTriven\b|\bMeta\b/g;

function isEmailAddress(value: string): boolean {
  return value.includes("@");
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
          ? `mailto:${matchedText}?subject=Privacy%20Request`
          : `mailto:${matchedText}`;

      nodes.push(
        <a
          key={`${matchIndex}-${matchedText}`}
          href={mailtoHref}
          className={LINK_CLASS}
          data-testid="privacy-email-link"
        >
          {matchedText}
        </a>
      );
    } else {
      const policyRoute = getPolicyRoute(matchedText);

      if (policyRoute) {
        nodes.push(
          <a
            key={`${matchIndex}-${matchedText}`}
            href={policyRoute.href}
            className={LINK_CLASS}
            data-testid="privacy-route-link"
          >
            {policyRoute.label}
          </a>
        );
      } else {
        nodes.push(
          <span
            key={`${matchIndex}-${matchedText}`}
            className={BRAND_NAME_CLASS}
            data-testid="privacy-brand-name"
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

const privacySections: LegalSectionData[] = [
  {
    id: "introduction",
    title: "1. Introduction",
    body: [
      "Triven.ai (Triven.ai, Triven, we, us, or our) is a product owned and operated by CollabGlam LLC. Triven.ai provides an AI-agent marketplace and communications platform for businesses, AI Architects, and other authorized users. This Privacy Policy explains how we collect, use, disclose, retain, and protect personal information when you visit our websites, create an account, purchase, install, build, publish, configure, test, or operate an AI agent, connect third-party services, communicate with us, or interact with a Triven-powered agent (collectively, the Platform).",
      "This Privacy Policy applies to Business Owners, AI Architects, end-users who interact with Triven-powered agents, website visitors, and other individuals whose information is processed through the Platform.",
      "In some situations, a Business Owner determines why and how an installed agent processes an end-user's information. In those situations, the Business Owner may act as the data controller or business, and Triven.ai may process information on the Business Owner's behalf. End-users should also review the privacy notices of the business with which they are interacting.",
      "This Privacy Policy should be read alongside our Data Deletion Instructions (https://triven.ai/data-deletion), Security page (https://triven.ai/security), Terms of Service, and Data Processing Addendum (DPA)."
    ]
  },
  {
    id: "information-we-collect",
    title: "2. Information We Collect",
    body: ["Depending on how you use or interact with the Platform, we may collect the following categories of information:"],
    list: [
      { label: "Account and profile information:", text: "name, email address, phone number, account role, business name, business type, profile details, authentication data, and account preferences." },
      { label: "Business and marketplace information:", text: "business details, services, FAQs, agent listings, agent configurations, publishing information, buyer setup answers, connected tools, and marketplace activity." },
      { label: "Payment and transaction information:", text: "purchase, subscription, usage, invoice, refund, payout, tax, and billing details. Payment-card information is generally processed by our payment processors, and Triven.ai does not intentionally store full card numbers." },
      { label: "Communications and agent-interaction data:", text: "caller and recipient phone numbers, call identifiers, call status, call duration, call audio or recordings when enabled, transcripts, SMS messages, email content, support messages, AI-generated responses, tool calls, appointment details, service requests, and related timestamps." },
      { label: "SMS consent and preference data:", text: "mobile number, consent status, date and time of consent, consent method, the business and messaging program involved, call or interaction identifier, consent-script version, STOP or HELP requests, and opt-out history." },
      { label: "Connected-service data:", text: "information obtained from services you choose to connect, such as calendars, email providers, telecommunications providers, payment processors, and other integrations, subject to the permissions you grant." },
      { label: "Device, log, and usage data:", text: "IP address, browser and device information, operating system, pages viewed, actions taken, error logs, security events, referral information, and approximate location inferred from technical data." },
      { label: "Cookies and similar technologies:", text: "session identifiers and other technologies used to keep you signed in, remember preferences, secure the Platform, and understand usage." },
      { label: "Information you submit to us:", text: "support requests, feedback, survey responses, files, documents, screenshots, and other information you voluntarily provide." }
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
      { text: "Protect the rights, property, safety, and integrity of Triven.ai, our users, end-users, and the public." }
    ],
    after: "None of the purposes above — including improving the Platform, usage analysis, debugging, developing new functionality, aggregation, or de-identification — authorize using raw or derived Google Workspace API user data to create, train, or improve generalized AI/ML models, to improve any AI provider's services, for shared model evaluation or fine-tuning, or for any secondary purpose unrelated to the user-facing feature the data was collected for. The same restriction applies to every other permission in this Privacy Policy.\n\nWhatsApp Business Platform data limitation. Information obtained through the Meta WhatsApp Business Platform is processed only under the applicable Workspace Owner's instructions and authorization, and only to provide, secure, maintain, troubleshoot, and support the WhatsApp-enabled services requested by that Workspace Owner. Triven.ai does not use WhatsApp user data for its own unrelated product development, independent marketing, advertising, retargeting, consumer profiling, data brokerage, or generalized artificial-intelligence or machine-learning model training."
  },
  {
    id: "legal-bases",
    title: "4. Legal Bases for Processing",
    body: [
      "Where applicable law requires a legal basis, we process personal information as necessary to perform a contract, provide requested services, comply with legal obligations, protect vital or legitimate interests, prevent fraud and abuse, and obtain consent where required.",
      "When Triven.ai processes end-user information on behalf of a Business Owner, the Business Owner is responsible for establishing an appropriate legal basis and providing any notices or obtaining any permissions required for its use of the Platform."
    ]
  },
  {
    id: "data-sharing",
    title: "5. How We Disclose Information",
    body: ["We do not sell personal information, and we do not share personal information for cross-context behavioral advertising. We may disclose information only as reasonably necessary for the purposes described in this Privacy Policy, including to:"],
    list: [
      { label: "Business Owners:", text: "to provide the business with information generated through its installed agents, such as customer requests, appointments, call details, transcripts, messages, and consent status." },
      { label: "AI Architects:", text: "We may provide AI Architects with general operational and marketplace analytics about agents, such as installation counts, configuration status, and platform-level performance indicators. AI Architects do not receive WhatsApp user data, message content, telephone numbers, recordings, transcripts, consent records, customer lists, or analytics derived from WhatsApp user data." },
      { label: "Service providers:", text: "including payment processors, cloud-hosting providers, telecommunications and messaging providers, AI-model providers, speech-to-text providers, text-to-speech providers, email and calendar providers, analytics providers, security providers, monitoring providers, and customer-support tools." },
      { label: "Professional advisers:", text: "such as lawyers, accountants, auditors, insurers, and consultants where reasonably necessary." },
      { label: "Legal and safety recipients:", text: "government authorities, courts, regulators, law-enforcement agencies, or other parties when required by law or reasonably necessary to protect rights, safety, security, or prevent fraud." },
      { label: "Corporate-transaction recipients:", text: "in connection with a merger, financing, acquisition, reorganization, bankruptcy, sale of assets, or similar transaction, subject to appropriate confidentiality protections." },
      { label: "Recipients you direct or authorize:", text: "when you ask us to connect, send, export, or otherwise disclose information to another person or service." }
    ],
    after: "Service providers may process information only for the services they provide to Triven.ai or the applicable Business Owner and are not authorized to use mobile opt-in data for their own marketing or promotional purposes.\n\nFor information obtained through the WhatsApp Business Platform, Triven.ai discloses information only to service providers reasonably necessary to provide, secure, maintain, troubleshoot, or support the WhatsApp-enabled service requested by the applicable Workspace Owner. Those providers may process the information only for the contracted service and are not authorized to use it for their own advertising, marketing, consumer profiling, data brokerage, generalized model training, or unrelated product development."
  },
  {
    id: "ai-communications",
    title: "6. AI Agents, Calls, Recordings, and Communications",
    body: [
      "When an end-user interacts with a Triven-powered agent, information from that interaction may be processed by AI-model providers, speech-recognition providers, voice-synthesis providers, telecommunications providers, calendar providers, email providers, and other service providers required to complete the requested interaction.",
      "All AI processing on the Platform is inference-only. Triven.ai does not use customer data, end-user interaction data, messages, recordings, transcripts, uploaded files, workflow data, or information obtained through connected third-party services to create, train, or fine-tune generalized or shared artificial intelligence or machine-learning models. AI service providers process interaction data solely to generate the requested response in the moment, under terms that prohibit the provider from using it to train their models. Where a provider offers additional no-training, no-logging, or zero-retention controls, Triven.ai enables them for the plans it uses.",
      "Depending on the agent configuration, interaction data may include call audio, call recordings, transcripts, telephone numbers, SMS messages, booking details, service requests, calendar information, tool results, and AI-generated responses.",
      "AI outputs may be inaccurate, incomplete, delayed, or inappropriate. Business Owners are responsible for reviewing their agent configurations, monitoring use, and determining when human review or intervention is required.",
      "Where calls are recorded, the Business Owner is responsible for providing legally required notice and obtaining legally required consent. Triven.ai may also provide technical settings or prompts to support recording notices, but those features do not replace the Business Owner's legal obligations."
    ]
  },
  {
    id: "google-limited-use",
    title: "7. Google API Services and Limited Use",
    body: [
      "Triven.ai's use and transfer to any other app of information received from Google APIs will adhere to the Google API Services User Data Policy, including the Limited Use requirements. The use of raw or derived user data received from Google Workspace APIs will adhere to the Google User Data Policy, including the Limited Use requirements.",
      "When a Business Owner chooses to connect a Google account, Triven.ai accesses only the following Google user data: Google Calendar event timing information, which is used solely to determine open appointment times and to create, reschedule, or cancel appointment events at the direction of the business and its customers; and the email address of the connected Google account, which is used solely to identify and manage the connection.",
      "Before any Google connection begins, Triven.ai shows a disclosure describing exactly what data is accessed and how it is used. The Google authorization flow starts only after the user explicitly clicks Agree and continue to Google, and Triven.ai keeps a versioned record of that agreement (the user, the disclosure version shown, the action taken, and the time). Closing or dismissing the disclosure records nothing and does not start the connection.",
      "Internally, Triven.ai classifies all processed data as general platform data, raw Google Workspace data, or data derived from Google Workspace data, and enforces technical controls on the second and third categories: raw Google Workspace data is never eligible for AI processing under any configuration, and derived data (such as computed open appointment times) can be processed by an AI service provider only when platform-level, fail-closed configuration confirms that the specific provider does not train on the data.",
      "Triven.ai applies the following restrictions to all Google user data, whether raw, aggregated, anonymized, or derived:"
    ],
    list: [
      { label: "No AI/ML training:", text: "Google user data is never used to develop, improve, or train generalized, foundational, or any other artificial-intelligence or machine-learning models, whether by Triven.ai or by any third party. Triven.ai does not build or fine-tune AI models with Google user data." },
      { label: "No transfer to AI tools for training:", text: "Google user data is never transferred, sold, or made available to third-party AI/ML services for model training or improvement. Where an AI service provider processes limited, derived scheduling information (such as open appointment times) in the course of generating a response requested during a live interaction, that processing is inference-only: the provider is used under terms that prohibit training on the data, and raw calendar event contents (titles, descriptions, attendees, or other event details) never leave Triven.ai's backend systems." },
      { label: "No advertising:", text: "Google user data is never used to serve, target, or personalize advertisements." },
      { label: "No selling:", text: "Google user data is never sold to any party." },
      { label: "Restricted human access:", text: "Humans do not read Google user data unless the account holder gives explicit permission, it is necessary for security purposes (such as investigating abuse), it is required to comply with applicable law, or the data has been aggregated and anonymized for internal operations." },
      { label: "Limited transfers:", text: "Google user data is transferred to others only as necessary to provide or improve user-facing features of the Platform, for security purposes, to comply with applicable law, or as part of a merger, acquisition, or sale of assets with prior notice to affected users." }
    ],
    after: "Triven.ai does not use Google Photos APIs. Triven.ai does not operate self-hosted or offline AI models that process Google user data; all AI processing described above occurs through hosted service providers on inference-only terms. When you disconnect the integration inside the Platform, Triven.ai asks Google to revoke its access grant and then deletes the stored encrypted credentials; you can also revoke Triven.ai's access at any time from your Google account security settings. OAuth tokens are stored encrypted, are never written to logs, and are never included in consent or audit records."
  },
  {
    id: "meta-whatsapp-business-platform",
    title: "8. Meta WhatsApp Business Platform",
    body: [
      "When a Workspace Owner connects a WhatsApp Business Account or another supported Meta business asset to Triven.ai, Triven.ai may receive and process information necessary to operate that integration. Depending on the enabled features, this information may include Meta Business Portfolio and WhatsApp Business Account identifiers; WhatsApp phone-number identifiers and business-profile information; WhatsApp user telephone numbers, identifiers, and profile names where provided through the platform; message content, attachments, and interaction timestamps; delivery, read, failure, and other message-status information; message-template, webhook, connection, and integration metadata; and information generated when an authorized workflow processes or responds to a WhatsApp interaction.",
      "Triven.ai processes this information only at the direction and with the authorization of the applicable Workspace Owner, and only to provide, secure, maintain, troubleshoot, and support the WhatsApp-enabled services requested by that Workspace Owner.",
      "Where a Workspace Owner communicates with its customers through Triven.ai, the Workspace Owner generally determines the purpose of the processing and acts as the controller or business for that customer information. Triven.ai acts as a processor or service provider on the Workspace Owner's behalf. For WhatsApp customer and user data, Triven.ai processes information solely on behalf of the applicable Workspace Owner and does not independently determine unrelated processing purposes.",
      "Triven.ai does not sell WhatsApp user data; use it for cross-context behavioral advertising; build or augment unrelated consumer profiles; combine it with unrelated third-party data; retarget users on or outside WhatsApp; or use it for Triven.ai's independent marketing purposes.",
      "Triven.ai may disclose WhatsApp information only to the applicable Workspace Owner, recipients specifically authorized by that Workspace Owner, and service providers reasonably necessary to operate the requested functionality, subject to appropriate contractual and security obligations.",
      "Requests to delete eligible WhatsApp information stored by Triven.ai are handled under our Data Deletion Instructions (https://triven.ai/data-deletion). Deleting information from Triven.ai does not automatically delete information independently controlled by the Workspace Owner or Meta."
    ]
  },
  {
    id: "sms-messaging",
    title: "9. SMS Messaging and Consent",
    body: [
      "Triven.ai enables businesses using the Platform to send transactional text messages to their customers and end-users, and transactional SMS is sent only after the end-user's affirmative consent has been recorded. Message types include appointment confirmations, appointment reminders, booking updates, rescheduling notices, cancellations, service updates, and customer-support communications.",
      "Consent may be collected in two ways: (1) an affirmative verbal response during an inbound, AI-assisted telephone call, after the AI receptionist reads a standardized consent disclosure identifying the business; or (2) a separate, optional consent checkbox on a public booking or service-request form that is unchecked by default and is never required to submit the form.",
      "Before recording verbal consent, the AI agent identifies the applicable business, describes the types of messages the end-user may receive, discloses that message frequency varies and message and data rates may apply, and explains that the end-user may reply STOP to opt out or HELP for assistance.",
      "Consent to receive text messages is not required to complete a purchase, booking, or service request. If an end-user does not consent, the business still completes the appointment, booking, or service request without sending text messages.",
      "Message frequency varies based on the end-user's appointments, bookings, service requests, and interactions with the applicable business. Message and data rates may apply.",
      "End-users may opt out at any time by replying STOP. After opting out, the end-user will no longer receive messages from that messaging program unless the end-user later opts in again through a supported re-opt-in method. End-users may reply HELP for assistance.",
      "SMS consent is specific to the identified sending business and messaging program and is non-transferable. Consent provided to one business is never applied to, or usable by, another business using Triven.ai.",
      "Mobile phone numbers, SMS opt-in data, and SMS consent records will not be sold, rented, transferred, or shared with third parties, affiliates, or lead generators for marketing or promotional purposes.",
      "Mobile information may be disclosed only to service providers necessary to operate and deliver the messaging service, such as telecommunications providers, messaging infrastructure providers, hosting providers, and the business with which the end-user is directly interacting. Those providers may process the information only as needed to provide the requested services and must protect it appropriately.",
      "Consent for marketing messages, where offered, must be collected separately from consent for transactional or informational messages and must satisfy any additional legal requirements that apply."
    ]
  },
  {
    id: "retention",
    title: "10. Data Retention",
    body: [
      "We retain personal information only for as long as reasonably necessary to provide the Platform, complete transactions, support Business Owners and AI Architects, maintain security, prevent fraud, resolve disputes, comply with legal obligations, enforce agreements, and satisfy legitimate operational needs.",
      "Retention periods may differ based on the type of information, the configuration selected by a Business Owner, contractual requirements, legal obligations, carrier requirements, and whether information is needed for an active account, transaction, dispute, investigation, or support request.",
      "Business Owners and account holders may request deletion or export of eligible information, subject to legal, security, fraud-prevention, backup, and operational retention requirements, as described in our Data Deletion Instructions (https://triven.ai/data-deletion).",
      "WhatsApp Business Platform information is retained only for the period reasonably necessary to provide the WhatsApp-enabled service requested by the applicable Workspace Owner, comply with the Workspace Owner's instructions and contractual settings, protect platform security, resolve disputes, and satisfy applicable legal or platform obligations. Eligible WhatsApp information may be deleted under our Data Deletion Instructions (https://triven.ai/data-deletion). An end user who does not hold a Triven.ai account may submit a request using the business name, relevant WhatsApp phone number, and other limited identifiers described on that page. Deleting Triven.ai's copy of this information does not automatically delete data stored separately by Meta or by the customer business.",
      "Records of agreement to the Google connection disclosure are retained in identifiable form for 24 months as compliance evidence and then deleted. If you delete your account, those records are immediately pseudonymized: the account identifier is replaced with an irreversible token and the business reference is removed, so the record can no longer be tied to you."
    ]
  },
  {
    id: "security",
    title: "11. Data Security",
    body: [
      "We use reasonable administrative, technical, and organizational safeguards designed to protect information against unauthorized access, loss, misuse, alteration, and disclosure. These safeguards may include access controls, encryption in transit, restricted production access, logging, monitoring, backups, authentication controls, and security reviews. Further detail is available on our Security page (https://triven.ai/security).",
      "No method of transmission or storage is completely secure, and we cannot guarantee absolute security."
    ]
  },
  {
    id: "international-transfers",
    title: "12. International Data Transfers",
    body: [
      "Triven.ai and our service providers may process information in countries other than the country where the information was collected. Those countries may have different data-protection laws.",
      "Where required, we use appropriate safeguards for cross-border transfers, such as contractual protections or other lawful transfer mechanisms."
    ]
  },
  {
    id: "your-rights",
    title: "13. Your Privacy Rights",
    body: ["Depending on your location and applicable law, you may have the right to:"],
    list: [
      { text: "Access personal information we maintain about you." },
      { text: "Correct inaccurate or incomplete personal information." },
      { text: "Delete eligible personal information." },
      { text: "Port a copy of eligible information." },
      { text: "Withdraw consent where processing is based on consent." },
      { text: "Opt out of marketing communications, and of the sale or sharing of personal information (Triven.ai does not sell personal information or share it for cross-context behavioral advertising, so no opt-out action is required for this right)." },
      { text: "Submit a complaint to an applicable data-protection authority." },
      { text: "Appeal a decision concerning a privacy request." }
    ],
    after: "Some rights are subject to exceptions. We may need to verify your identity and authority before completing a request. When Triven.ai processes end-user information on behalf of a Business Owner, we may direct the request to that Business Owner.\n\nDeletion requests, including the applicable processing timelines and the process for WhatsApp end-users who do not hold a Triven.ai account, are handled under our Data Deletion Instructions (https://triven.ai/data-deletion). To submit any other privacy request, contact info@triven.ai."
  },
  {
    id: "cookies",
    title: "14. Cookies and Similar Technologies",
    body: [
      "We use essential cookies and similar technologies to authenticate users, maintain sessions, remember preferences, secure the Platform, and provide requested functionality.",
      "We may use analytics technologies to understand usage and improve the Platform. Where required by law, we will request consent before using non-essential cookies.",
      "Browser settings may allow you to block or delete cookies, but some Platform features may not function correctly without essential cookies."
    ]
  },
  {
    id: "third-party-services",
    title: "15. Third-Party Services and Links",
    body: ["The Platform integrates with or links to third-party services, including the Meta WhatsApp Business Platform. Those services operate under their own terms and privacy policies. Triven.ai is not responsible for the privacy practices of third parties, and you should review their notices before connecting or using them."]
  },
  {
    id: "children",
    title: "16. Children's Privacy",
    body: ["The Platform is not intended for individuals under 18, and we do not knowingly allow individuals under 18 to create Triven.ai accounts. If you believe a minor has provided personal information to us, contact us so we can review and take appropriate action."]
  },
  {
    id: "changes",
    title: "17. Changes to This Policy",
    body: ["We may update this Privacy Policy from time to time. The updated version will be posted on this page with a revised effective date. Where required by law, we will provide additional notice or obtain consent before material changes take effect."]
  },
  {
    id: "legal-entity",
    title: "18. Legal Entity",
    body: ["Triven.ai is a product owned and operated by CollabGlam LLC. This Privacy Policy describes the practices of CollabGlam LLC in connection with the operation of the Triven.ai platform. It should be read alongside our Data Deletion Instructions (https://triven.ai/data-deletion), Security page (https://triven.ai/security), Terms of Service, and Data Processing Addendum (DPA)."]
  },
  {
    id: "contact",
    title: "19. Contact Us",
    body: ["For questions, complaints, or requests concerning this Privacy Policy or our privacy practices, contact us at:"],
    afterNode: (
      <>
        Email:{" "}
        <a
          data-testid="privacy-contact-email"
          href="mailto:info@triven.ai?subject=Privacy%20Request"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          info@triven.ai
        </a>
        <br />
        Website:{" "}
        <a
          data-testid="privacy-website-link"
          href="/"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          triven.ai
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
        {highlightBrands(section.title)}
      </h2>

      {section.body?.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 text-base leading-relaxed text-slate-600 whitespace-pre-line"
          data-testid="privacy-paragraph-text"
        >
          {highlightBrands(paragraph)}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="privacy-list-item">
              {item.label ? (
                <span className="font-medium text-slate-800" data-testid="privacy-list-label">
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
          data-testid="privacy-section-after-text"
        >
          {highlightBrands(section.after)}
        </p>
      ) : null}

      {section.afterNode ? (
        <div
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="privacy-section-after-node-text"
        >
          {section.afterNode}
        </div>
      ) : null}
    </section>
  );
}