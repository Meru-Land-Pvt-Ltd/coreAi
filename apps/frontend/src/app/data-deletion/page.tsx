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

const LAST_UPDATED = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric"
});
const EFFECTIVE_DATE = new Date().toLocaleDateString("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric"
});

const BRAND_NAME_CLASS = "font-semibold";
const EMAIL_LINK_CLASS = "font-medium text-amber-600 hover:text-amber-700";
const RICH_TEXT_PATTERN =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b|\bTriven\.ai\b|\bCollabGlam LLC\b|\bCollabGlam\b|\bWhatsApp Business Platform\b|\bWhatsApp Business Account\b|\bWhatsApp Business\b|\bWhatsApp\b|\bTriven\b|\bMeta\b/g;

function isEmailAddress(value: string): boolean {
  return value.includes("@");
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
          ? `mailto:${matchedText}?subject=Data%20Deletion%20Request`
          : `mailto:${matchedText}`;

      nodes.push(
        <a
          key={`${matchIndex}-${matchedText}`}
          href={mailtoHref}
          className={EMAIL_LINK_CLASS}
          data-testid="data-deletion-email-link"
        >
          {matchedText}
        </a>
      );
    } else {
      nodes.push(
        <span
          key={`${matchIndex}-${matchedText}`}
          className={BRAND_NAME_CLASS}
          data-testid="data-deletion-brand-name"
        >
          {matchedText}
        </span>
      );
    }
    lastIndex = matchIndex + matchedText.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes.length > 0 ? <>{nodes}</> : text;
}

function Brand({ children }: { children: string }) {
  return (
    <span className={BRAND_NAME_CLASS} data-testid="data-deletion-brand-name">
      {children}
    </span>
  );
}

const dataDeletionSections: LegalSectionData[] = [
  {
    id: "overview",
    title: "1. Overview",
    body: [
      `Triven.ai is an AI workflow automation platform owned and operated by CollabGlam LLC (CollabGlam, we, us, or our). This page explains how Triven.ai account holders, Workspace members, and individuals whose information has been processed through a Triven-powered workflow may request deletion of eligible personal information, including information received or stored through connected Meta products such as the WhatsApp Business Platform.`,
      `CollabGlam LLC is the data controller for personal information processed through Triven.ai, except where a customer organization (Workspace Owner) acts as the controller of its own end-user data and Triven.ai acts solely as a data processor on that Workspace Owner's behalf. See Section 9 for details.`
    ]
  },
  {
    id: "how-to-request",
    title: "2. How to Request Deletion",
    body: [
      "To request deletion, email info@triven.ai with the subject line Data Deletion Request, ideally from the email address associated with your Triven.ai account. Please include:"
    ],
    list: [
      { text: "Full name and Triven.ai account email address" },
      { text: "Workspace, organization, or customer-business name" },
      {
        text: "The connected WhatsApp business phone number or WhatsApp Business Account identifier, if your request relates to a Meta integration (see Section 3)"
      },
      {
        text: "Whether you want specific connected-integration data deleted, or your complete Triven.ai account and all eligible data"
      }
    ],
    after:
      "Do not send passwords, access tokens, API keys, payment-card information, or identity documents in your request unless we specifically ask for verification through a secure method (see Section 5).",
    afterNode: (
      <>
        You may also submit a request as a California resident through an authorized agent. We may
        require the agent to provide written proof of authorization and may still require you to
        directly verify your own identity.
        <br />
        <br />
        We will acknowledge a verified request by email and provide a completion confirmation once
        processed. If only part of a request can be fulfilled, our response will identify the
        categories retained, the reason, and the expected review date where applicable.
      </>
    )
  },
  {
    id: "meta-whatsapp",
    title: "3. Meta and WhatsApp Data Deletion",
    body: [
      "If you connected a Meta Business Portfolio, WhatsApp Business Account, WhatsApp business phone number, or another supported Meta asset to Triven.ai, you may request deletion of eligible information stored by Triven.ai in connection with that integration.",
      "Depending on the integration used, this may include Meta account identifiers, WhatsApp Business Account or Business Portfolio identifiers, phone-number mappings, encrypted access credentials or tokens, webhook configuration, connection metadata, message or conversation records stored by Triven.ai, attachments, and related operational records. We will revoke or delete eligible stored credentials and disconnect the relevant integration as part of a completed request.",
      "To help us locate and action your request, please provide where known:"
    ],
    list: [
      { text: "Your Triven.ai account email address" },
      { text: "Workspace, organization, or customer-business name" },
      { text: "The connected WhatsApp business phone number" },
      { text: "The WhatsApp Business Account ID or Business Portfolio ID" },
      {
        text: "Whether the request covers Meta-connected data only, a specific conversation or end user, or your complete Triven.ai account"
      }
    ],
    after:
      "If you are a WhatsApp end user and do not hold a Triven.ai account: you can still submit a request. In place of an account email, provide the WhatsApp phone number you messaged the business from, the name of the business you contacted, and the approximate date range of your conversation. We will use these details, together with the business's Workspace records, to locate and action eligible information.",
    afterNode: (
      <>
        <span className="font-medium text-slate-800">Important distinctions:</span>
        <ul className="mt-3 list-outside list-disc space-y-3 pl-6">
          <li data-testid="data-deletion-list-item">
            We can delete <Brand>Triven.ai</Brand>&apos;s copies of your data and revoke{" "}
            <Brand>Triven.ai</Brand>&apos;s access to your <Brand>Meta</Brand> integration. We do
            not control, and cannot delete, information stored independently within{" "}
            <Brand>Meta</Brand>&apos;s own systems — that must be requested directly through{" "}
            <Brand>Meta</Brand>&apos;s own settings or request channels.
          </li>
          <li data-testid="data-deletion-list-item">
            Where a connected third-party processor has its own verified deletion and backup
            schedule, our completion of your request is subject to that processor&apos;s timeline.
          </li>
        </ul>
      </>
    )
  },
  {
    id: "scope",
    title: "4. Scope of Deletable Data",
    body: [
      "Upon a verified request, we will delete the following categories of personal information associated with an account or Workspace, where applicable and not subject to Section 7:"
    ],
    list: [
      {
        label: "Account & profile data:",
        text: "Name, email address, phone number, authentication account data"
      },
      {
        label: "Workspace data:",
        text: "Workspace configuration, team member records, permissions"
      },
      {
        label: "Connected integrations:",
        text: "WhatsApp Business, Telegram, Email, CRM, and other authorized connections"
      },
      {
        label: "Workflow data:",
        text: "Automation configurations, triggers, and workflow logic"
      },
      {
        label: "Conversation data:",
        text: "AI conversation history and message logs processed on your behalf"
      },
      {
        label: "Files & documents:",
        text: "Uploaded files, attachments, and generated outputs"
      },
      {
        label: "Knowledge Base content:",
        text: "Documents and data ingested for AI reference"
      },
      {
        label: "AI memory records:",
        text: "Workspace-specific memory or context data used to personalize AI responses"
      },
      {
        label: "Credentials:",
        text: "API keys, OAuth tokens, and encrypted access credentials"
      },
      {
        label: "System logs:",
        text: "Logs eligible for deletion under our data retention schedule"
      }
    ],
    after:
      "Logs required for security, fraud-prevention, or legal purposes are retained under Section 7 rather than deleted outright."
  },
  {
    id: "identity-verification",
    title: "5. Identity Verification",
    body: [
      "To protect against fraudulent or unauthorized deletion requests, we will verify the identity of the requester before processing a request. Verification may include confirming account ownership, matching the request to registered account credentials, or requesting additional identifying information proportionate to the sensitivity of the data involved. We will not request more information than is reasonably necessary to verify identity."
    ]
  },
  {
    id: "processing-timelines",
    title: "6. Processing Timelines",
    body: ["We process verified deletion requests according to the following framework:"],
    list: [
      {
        label: "General / GDPR-eligible requests:",
        text: "within one calendar month of identity verification, in accordance with Article 12(3) GDPR."
      },
      {
        label: "California (CCPA/CPRA) requests:",
        text: "within 45 calendar days of receipt, with a one-time 45-day extension where reasonably necessary, provided we notify you of the extension and the reason within the initial 45-day period."
      },
      {
        label: "Requests involving connected third-party integrations:",
        text: "may require additional time where deletion depends on a connected platform's own processing schedule. We will notify you if this applies to your request."
      }
    ],
    after:
      "If we deny a deletion request in whole or in part, we will provide the reason for denial and, where applicable, information about your right to appeal."
  },
  {
    id: "legal-retention",
    title: "7. Legal, Regulatory & Security Retention",
    body: ["Notwithstanding a deletion request, we may retain limited data where necessary to:"],
    list: [
      {
        text: "Comply with a legal obligation requiring processing (GDPR Art. 17(3)(b); CCPA §1798.105(d));"
      },
      { text: "Establish, exercise, or defend legal claims;" },
      {
        text: "Detect, investigate, or prevent fraud, security incidents, or illegal activity;"
      },
      {
        text: "Complete a transaction or provide a good/service you requested prior to your deletion request;"
      },
      { text: "Satisfy tax, accounting, or financial recordkeeping obligations;" },
      { text: "Debug or repair functionality as necessary for platform integrity." }
    ],
    after:
      "Retained data is limited to what is strictly necessary for the applicable purpose, is subject to access restrictions, and is deleted once the retention basis no longer applies."
  },
  {
    id: "after-deletion",
    title: "8. What Happens After Deletion",
    body: ["Once a deletion request is completed:"],
    list: [
      {
        text: "The account and/or Workspace is disabled and cannot be reactivated."
      },
      {
        text: "Connected third-party integrations are disconnected, and eligible access tokens are revoked where supported by the provider."
      },
      {
        text: "Workflow configurations, conversation history, uploaded files, and AI memory records tied to the Workspace are deleted or irreversibly anonymized from active production systems."
      },
      {
        text: "API keys and OAuth credentials associated with the account are invalidated."
      }
    ],
    after:
      "After completion, deleted information will no longer be available through Triven.ai's active production systems or ordinary account-recovery processes. Limited copies may remain temporarily in encrypted, access-restricted backups until those backups are overwritten or expire under our backup-retention schedule (see Section 10). Backup copies are not used for ordinary business processing, and if a backup is ever restored, the original deletion request will be reapplied before the affected information returns to active use."
  },
  {
    id: "workspace-owner",
    title: "9. Data Controlled by a Customer Business (Workspace Owner)",
    body: [
      "Where Triven.ai processes customer or end-user information solely on behalf of a Workspace Owner — for example, WhatsApp messages a business sends to its own customers through our platform — that Workspace Owner is the data controller for that information, and Triven.ai processes it solely as a service provider/processor under the Workspace Owner's instructions.",
      "If you are an end user who messaged a business via WhatsApp, we may refer your request to that Workspace Owner, or coordinate with them to complete it. We will still delete information within our own control when required by applicable law or a valid controller instruction. Deletion from Triven.ai's systems does not automatically delete information independently retained by the Workspace Owner or by Meta."
    ]
  },
  {
    id: "backups",
    title: "10. Backups",
    body: [
      "Deleted data may persist temporarily in encrypted, access-restricted backups maintained for disaster recovery and business continuity, as described in Section 8. Backup data is not accessible in the ordinary course of business and is automatically purged in accordance with our backup-retention schedule."
    ]
  },
  {
    id: "other-integrations",
    title: "11. Other Third-Party Integrations",
    body: [
      "Beyond the Meta WhatsApp Business Platform (Section 3), Triven.ai integrates with other third-party platforms at the customer's direction, including but not limited to Telegram, Google Workspace, Microsoft services, Stripe, and Twilio. We will disconnect these integrations and delete our copy of associated data as part of a completed request. Data independently stored within those third-party platforms is governed by their own policies, and you may need to separately request deletion directly from them."
    ]
  },
  {
    id: "ai-systems",
    title: "12. How We Use Data With AI Systems",
    body: [
      "Customer conversations, uploaded files, workflow data, and messages processed through Triven.ai are not used to train shared or foundation AI models. Where third-party AI service providers are used to process a request, that processing is governed by our agreements with those providers and our Privacy Policy, and is subject to the same deletion rights described on this page."
    ]
  },
  {
    id: "childrens-data",
    title: "13. Children's Data",
    body: [
      "Triven.ai is not directed to individuals under the age of 18, and we do not knowingly collect personal information from children. If we become aware that we have inadvertently collected data from a child in violation of applicable law, we will delete it promptly upon verification."
    ]
  },
  {
    id: "your-rights",
    title: "14. Your Rights (GDPR / CCPA / Other Applicable Law)",
    body: ["Depending on your jurisdiction, you may have the right to:"],
    list: [
      { text: "Access the personal information we hold about you;" },
      { text: "Correct inaccurate personal information;" },
      { text: "Delete your personal information (subject to Section 7);" },
      { text: "Restrict or object to certain processing;" },
      { text: "Port your data to another provider;" },
      {
        text: "Know what categories of personal information are collected, used, and disclosed (CCPA/CPRA);"
      },
      {
        text: "Opt out of the sale or sharing of personal information. Triven.ai does not sell or share personal information for cross-context behavioral advertising, so no opt-out action is required for this right;"
      },
      { text: "Non-discrimination for exercising any of the above rights." }
    ],
    after: "To exercise any of these rights, use the contact method in Section 2."
  },
  {
    id: "contact",
    title: "15. Contact Us",
    body: ["For data deletion and privacy requests, contact us at:"],
    afterNode: (
      <>
        Email:{" "}
        <a
          data-testid="data-deletion-contact-email"
          href="mailto:info@triven.ai?subject=Data%20Deletion%20Request"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          info@triven.ai
        </a>
        {" "}
        (Subject line: Data Deletion Request)
        <br />
        Website:{" "}
        <a
          data-testid="data-deletion-website-link"
          href="https://triven.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          https://triven.ai
        </a>
      </>
    )
  },
  {
    id: "legal-entity",
    title: "16. Legal Entity & Governing Terms",
    body: [
      "Triven.ai is a product owned and operated by CollabGlam LLC. All requests submitted through this page are received, verified, and processed by CollabGlam LLC in accordance with applicable data protection law, our Privacy Policy, our Terms of Service, and the Meta Platform Terms governing use of the WhatsApp Business Platform."
    ],
    afterNode: (
      <>
        Read alongside our{" "}
        <a
          data-testid="data-deletion-privacy-policy-link"
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-amber-600 hover:text-amber-700"
        >
          Privacy Policy
        </a>
        .
      </>
    )
  }
];

const tocItems = dataDeletionSections.map((section) => ({
  href: `#${section.id}`,
  label: section.title.replace(/^\d+\.\s*/, "")
}));

export default function DataDeletionPage() {
  return (
    <LegalPageShell>
      <LegalHero title="Data Deletion Policy" />
      <LegalToc items={tocItems} />

      <main className="mx-auto max-w-3xl px-6 pb-20">
        {dataDeletionSections.map((section, index) => (
          <LegalSection
            key={section.id}
            section={section}
            isLast={index === dataDeletionSections.length - 1}
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
        data-testid="data-deletion-title-heading"
      >
        {title}
      </h1>
      <p className="mt-4 text-sm text-slate-500" data-testid="data-deletion-last-updated-text">
        Last updated: {LAST_UPDATED}
      </p>
      <p className="mt-1 text-sm text-slate-500" data-testid="data-deletion-effective-date-text">
        Effective date: {EFFECTIVE_DATE}
      </p>
    </section>
  );
}

function LegalToc({ items }: { items: { href: string; label: string }[] }) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-10">
      <div className="rounded-xl border border-gray-100 px-6 py-5">
        <p
          className="mb-3 text-sm font-semibold text-slate-900"
          data-testid="data-deletion-on-this-page-text"
        >
          On this page
        </p>
        <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href} data-testid="data-deletion-toc-item">
              <a
                data-testid="data-deletion-toc-link"
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
        data-testid="data-deletion-section-title-heading"
      >
        {highlightBrands(section.title)}
      </h2>

      {section.body?.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="data-deletion-paragraph-text"
        >
          {highlightBrands(paragraph)}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="data-deletion-list-item">
              {item.label ? (
                <span className="font-medium text-slate-800" data-testid="data-deletion-list-label">
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
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="data-deletion-section-after-text"
        >
          {highlightBrands(section.after)}
        </p>
      ) : null}

      {section.afterNode ? (
        <div
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="data-deletion-section-after-node-text"
        >
          {section.afterNode}
        </div>
      ) : null}
    </section>
  );
}
