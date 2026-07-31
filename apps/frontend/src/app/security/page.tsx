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
      nodes.push(
        <a
          key={`${matchIndex}-${matchedText}`}
          href={`mailto:${matchedText}`}
          className={EMAIL_LINK_CLASS}
          data-testid="security-email-link"
        >
          {matchedText}
        </a>
      );
    } else {
      nodes.push(
        <span
          key={`${matchIndex}-${matchedText}`}
          className={BRAND_NAME_CLASS}
          data-testid="security-brand-name"
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
    <span className={BRAND_NAME_CLASS} data-testid="security-brand-name">
      {children}
    </span>
  );
}

const securitySections: LegalSectionData[] = [
  {
    id: "overview",
    title: "1. Overview",
    body: [
      `Protecting customer data is a core operating principle at Triven.ai, an AI Workflow Automation Platform owned and operated by CollabGlam LLC (CollabGlam). We implement administrative, technical, and organizational safeguards designed to protect customer information, business data, and connected third-party integrations — including the Meta WhatsApp Business Platform — against unauthorized access, disclosure, alteration, or destruction.`,
      "No system can guarantee absolute security. This page describes the security practices we have implemented and our ongoing commitment to improving them; it is not a guarantee of a specific outcome, and it should be read alongside our Privacy Policy, Terms of Service, Data Deletion Instructions, and Data Processing Addendum (DPA)."
    ]
  },
  {
    id: "security-principles",
    title: "2. Security Principles",
    body: ["Our security program is organized around the following principles:"],
    list: [
      {
        label: "Security by Design —",
        text: "security considerations are incorporated at the architecture and development stage, not added after the fact"
      },
      {
        label: "Least Privilege Access —",
        text: "access is granted only to the extent necessary for a role or function"
      },
      {
        label: "Data Minimization —",
        text: "we collect and retain only what is necessary to provide the service"
      },
      {
        label: "Customer Data Isolation —",
        text: "customer environments are logically separated in our multi-tenant architecture"
      },
      {
        label: "Encryption —",
        text: "data is protected in transit and, where appropriate, at rest"
      },
      {
        label: "Continuous Monitoring —",
        text: "systems are monitored for anomalous or unauthorized activity"
      },
      {
        label: "Responsible Disclosure —",
        text: "we maintain a channel for external researchers to report vulnerabilities in good faith"
      }
    ]
  },
  {
    id: "infrastructure-security",
    title: "3. Infrastructure Security",
    body: [
      "Our platform operates over encrypted communication channels and is hosted on reputable cloud infrastructure. Measures include:"
    ],
    list: [
      { text: "TLS encryption for all web and API traffic" },
      { text: "Encrypted storage of sensitive credentials and secrets" },
      {
        text: "Environment-based configuration management, separating development, staging, and production environments"
      },
      { text: "Network-level protections, including firewalling of production systems" },
      {
        text: "Regular application of software updates and security patches to underlying infrastructure and dependencies"
      }
    ]
  },
  {
    id: "data-encryption",
    title: "4. Data Encryption",
    body: [
      "Customer information is encrypted in transit using TLS. Triven.ai applies encryption and access restrictions to sensitive stored credentials, such as supported OAuth tokens, API credentials, and integration secrets, according to the sensitivity of the information and the applicable system design.",
      "Passwords are never stored in plain text."
    ]
  },
  {
    id: "authentication-access-control",
    title: "5. Authentication & Access Control",
    body: [
      "Access to customer data is governed by role-based access control (RBAC) and the principle of least privilege:"
    ],
    list: [
      { text: "User authentication is required to access any Workspace" },
      { text: "Permissions are scoped by role within a Workspace" },
      {
        text: "Access to a Workspace's data is restricted to users explicitly authorized within that Workspace"
      },
      {
        text: "Session management controls are in place to limit exposure from inactive or compromised sessions"
      },
      {
        text: "Administrative access to production systems is restricted to authorized personnel"
      }
    ]
  },
  {
    id: "workspace-isolation",
    title: "6. Workspace Isolation (Multi-Tenancy)",
    body: [
      "Triven.ai is a multi-tenant platform. Triven.ai uses Workspace identifiers and authorization controls designed to ensure that users can access only the customer environments and records for which they have been granted permission:"
    ],
    list: [
      { text: "Customer data is partitioned by Workspace" },
      { text: "Workflow executions run within the context of their own tenant" },
      {
        text: "Connected integrations (e.g., WhatsApp Business, Telegram, CRM) are scoped to the Workspace that authorized them"
      },
      {
        text: "Integration credentials, workflow executions, files, conversations, and AI memory records are scoped to the applicable Workspace"
      }
    ]
  },
  {
    id: "ai-security",
    title: "7. AI Security & Data Handling",
    body: [
      "Triven.ai does not use customer data, end-user interaction data, messages, recordings, transcripts, uploaded files, workflow data, or information obtained through connected third-party services to create, train, or fine-tune generalized or shared artificial intelligence or machine-learning models. Where an authorized AI service provider processes information to generate a response requested through the Platform, that processing is performed only to provide the requested functionality and is governed by applicable contractual and technical data-protection controls. Access to AI functionality is scoped to the applicable Workspace and authorized workflow."
    ]
  },
  {
    id: "third-party-integrations",
    title: "8. Third-Party & WhatsApp Business Platform Integrations",
    body: [
      "Triven.ai integrates with third-party platforms at the customer's direction, including but not limited to:"
    ],
    list: [
      { text: "Meta WhatsApp Business Platform" },
      { text: "Telegram" },
      { text: "Google Workspace" },
      { text: "Microsoft services" },
      { text: "Stripe" },
      { text: "Twilio" }
    ],
    after:
      "Each integration is authorized directly by the customer using that platform's supported authentication mechanism (e.g., OAuth). We do not access a connected platform beyond the scope of permissions the customer has granted. Customers may disconnect supported integrations through the Platform. When an integration is disconnected, Triven.ai disables the connection, removes or invalidates locally stored credentials, and, where supported by the provider, submits a request to revoke the corresponding authorization grant or access token. Customers may also revoke Triven.ai's access directly from the connected provider's account settings.",
    afterNode: (
      <>
        <h3
          className="mt-6 text-lg font-bold text-slate-900"
          data-testid="security-meta-subsection-heading"
        >
          <Brand>Meta</Brand> <Brand>WhatsApp Business Platform</Brand>
        </h3>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          <Brand>Triven.ai</Brand> accesses and processes <Brand>WhatsApp Business Platform</Brand>{" "}
          data only as authorized by the applicable Workspace Owner, and only to provide, secure,
          and support the <Brand>WhatsApp</Brand>-enabled services requested by that Workspace
          Owner. <Brand>Meta</Brand> and <Brand>WhatsApp</Brand> credentials, identifiers, and
          configuration records are scoped to the applicable Workspace. <Brand>Triven.ai</Brand>{" "}
          does not use <Brand>WhatsApp</Brand> user data to build unrelated consumer profiles, for
          cross-context behavioral advertising, or for <Brand>Triven.ai</Brand>&apos;s independent
          marketing purposes.
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          <Brand>Triven.ai</Brand> applies authorization controls designed to prevent one Workspace
          from accessing another Workspace&apos;s <Brand>WhatsApp Business Account</Brand>,
          phone-number configuration, credentials, messages, or related customer records. Access
          permissions are limited to those required for the enabled integration. Customers may
          disconnect the integration and request deletion of eligible information according to our{" "}
          <a
            href="/data-deletion"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-amber-600 hover:text-amber-700"
            data-testid="security-data-deletion-link"
          >
            Data Deletion Instructions
          </a>
          .
        </p>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          <Brand>Triven.ai</Brand> does not represent itself as an official <Brand>Meta</Brand>{" "}
          partner, <Brand>Meta</Brand>-approved platform, or <Brand>WhatsApp</Brand> partner
          beyond any status formally granted by <Brand>Meta</Brand>.
        </p>
      </>
    )
  },
  {
    id: "api-security",
    title: "9. API Security",
    body: [
      "Non-public Triven.ai API endpoints require appropriate authentication and authorization. Access is evaluated according to the requesting user, Workspace, role, and permitted operation. Public integration endpoints, including third-party webhook endpoints, are protected using controls appropriate to the relevant provider. These controls may include request-signature verification, verification tokens, secret validation, timestamp checks, replay protections, and request validation.",
      "Additional safeguards include TLS, Workspace-level authorization checks, input validation, secure handling of integration credentials, appropriate rate limiting or abuse controls, and logging of relevant security and operational events without intentionally recording plaintext passwords, private keys, or access tokens."
    ]
  },
  {
    id: "monitoring-logging",
    title: "10. Monitoring & Logging",
    body: [
      "We maintain system logs to support detection, investigation, and resolution of operational and security events. Logged activity may include:"
    ],
    list: [
      { text: "Authentication events (login, failed login attempts)" },
      { text: "API request activity" },
      { text: "Integration connection/disconnection events" },
      { text: "Workflow execution activity" },
      { text: "Administrative actions on Workspace or account settings" },
      { text: "Application error logs" }
    ],
    after:
      "Logs are retained in accordance with our internal retention schedule and applicable legal requirements, and access to logs is restricted to authorized personnel."
  },
  {
    id: "vulnerability-management",
    title: "11. Vulnerability Management",
    body: ["We work to reduce security risk on an ongoing basis by:"],
    list: [
      { text: "Applying security patches to platform dependencies and infrastructure" },
      { text: "Monitoring dependencies for publicly disclosed vulnerabilities" },
      {
        text: "Reviewing and remediating identified security issues based on severity and risk"
      },
      {
        text: "Incorporating secure coding practices into our development lifecycle"
      }
    ]
  },
  {
    id: "incident-response",
    title: "12. Incident Response",
    body: [
      "If we become aware of a security incident that affects customer data, we will:"
    ],
    list: [
      { text: "Investigate the scope and cause of the incident;" },
      { text: "Take reasonable steps to contain and remediate the issue;" },
      { text: "Assess the impact on affected customers and data;" },
      {
        text: "Notify affected customers without undue delay where required by applicable law, regulation, or contractual obligation (including, where applicable, notification timelines under the GDPR and similar frameworks)."
      }
    ],
    after:
      "Specific notification commitments to enterprise customers may be further defined in an executed Data Processing Addendum (DPA) or Master Services Agreement."
  },
  {
    id: "customer-responsibilities",
    title: "13. Customer Responsibilities",
    body: ["Security is a shared responsibility. We recommend that customers:"],
    list: [
      { text: "Use strong, unique passwords for their Triven.ai account" },
      { text: "Protect and rotate API credentials regularly" },
      { text: "Limit the number of users with administrator-level access" },
      {
        text: "Periodically review connected integrations and remove those no longer in use"
      },
      { text: "Remove unused or stale API tokens" },
      {
        text: "Report suspected suspicious activity to us immediately using the contact in Section 14"
      }
    ]
  },
  {
    id: "responsible-disclosure",
    title: "14. Responsible Disclosure",
    body: [
      "We welcome reports from security researchers who identify potential vulnerabilities in Triven.ai. If you believe you have found a security issue, please report it to us before disclosing it publicly, and include where possible:"
    ],
    list: [
      { text: "A description of the issue and its potential impact" },
      { text: "Steps to reproduce" },
      { text: "Any supporting evidence (screenshots, logs, proof-of-concept)" }
    ],
    afterNode: (
      <>
        Report to:{" "}
        <a
          href="mailto:info@triven.ai"
          className="font-medium text-amber-600 hover:text-amber-700"
          data-testid="security-vulnerability-email"
        >
          info@triven.ai
        </a>{" "}
        
        with the subject line Security Report.
        <br />
        <br />
        We will acknowledge good-faith reports and work with the reporter to understand and address
        the issue. We ask that researchers avoid accessing, modifying, or exfiltrating customer data
        beyond what is strictly necessary to demonstrate a vulnerability.
      </>
    )
  },
  {
    id: "compliance",
    title: "15. Compliance & Related Policies",
    body: [
      "Our security practices are designed to support applicable data protection and platform requirements. For related information, please see:"
    ],
    afterNode: (
      <>
        <ul className="mt-0 list-outside list-disc space-y-3 pl-6">
          <li data-testid="security-list-item">
            <a
              href="/privacy"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-600 hover:text-amber-700"
              data-testid="security-privacy-link"
            >
              Privacy Policy
            </a>
          </li>
          <li data-testid="security-list-item">
            <a
              href="/terms"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-600 hover:text-amber-700"
              data-testid="security-terms-link"
            >
              Terms of Service
            </a>
          </li>
          <li data-testid="security-list-item">
            <a
              href="/data-deletion"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-600 hover:text-amber-700"
              data-testid="security-data-deletion-policy-link"
            >
              Data Deletion Instructions
            </a>
          </li>
          <li data-testid="security-list-item">
            <a
              href="/DPA"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-amber-600 hover:text-amber-700"
              data-testid="security-dpa-link"
            >
              Data Processing Addendum (DPA)
            </a>
          </li>
        </ul>
        <p className="mt-4 text-base leading-relaxed text-slate-600">
          <Brand>Triven.ai</Brand> does not currently claim any specific third-party security
          certification (e.g., SOC 2, ISO 27001) on this page. If such a certification is obtained,
          this page will be updated accordingly with supporting detail.
        </p>
      </>
    )
  },
  {
    id: "changes",
    title: "16. Changes to This Page",
    body: [
      "We may update this Security page periodically to reflect changes in our platform, infrastructure, legal obligations, or security practices. The Last Updated date above reflects the most recent revision."
    ]
  },
  {
    id: "contact",
    title: "17. Contact Us",
    afterNode: (
      <>
        General Security &amp; Privacy Questions:{" "}
        <br />
        Security Vulnerability Reports:{" "}
        <a
          href="mailto:info@triven.ai"
          className="font-medium text-amber-600 hover:text-amber-700"
          data-testid="security-reports-email"
        >
          info@triven.ai
        </a>
        <br />
        Website:{" "}
        <a
          href="https://triven.ai"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-amber-600 hover:text-amber-700"
          data-testid="security-website-link"
        >
          https://triven.ai
        </a>
      </>
    )
  },
  {
    id: "legal-entity",
    title: "18. Legal Entity",
    body: [
      "Triven.ai is a product owned and operated by CollabGlam LLC. This Security page describes practices implemented by CollabGlam LLC in connection with the operation of the Triven.ai platform."
    ]
  }
];

const tocItems = securitySections.map((section) => ({
  href: `#${section.id}`,
  label: section.title.replace(/^\d+\.\s*/, "")
}));

export default function SecurityPage() {
  return (
    <LegalPageShell>
      <LegalHero title="Security Policy" />
      <LegalToc items={tocItems} />

      <main className="mx-auto max-w-3xl px-6 pb-20">
        {securitySections.map((section, index) => (
          <LegalSection
            key={section.id}
            section={section}
            isLast={index === securitySections.length - 1}
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
              html {
                scroll-behavior: smooth;
              }

              section[id] {
                scroll-margin-top: 6rem;
              }
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
        data-testid="security-title-heading"
      >
        {title}
      </h1>

      <p className="mt-4 text-sm text-slate-500" data-testid="security-last-updated-text">
        Last updated: {LAST_UPDATED}
      </p>

      <p className="mt-1 text-sm text-slate-500" data-testid="security-effective-date-text">
        Effective date: {EFFECTIVE_DATE}
      </p>
    </section>
  );
}

function LegalToc({
  items
}: {
  items: {
    href: string;
    label: string;
  }[];
}) {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-10">
      <div className="rounded-xl border border-gray-100 px-6 py-5">
        <p
          className="mb-3 text-sm font-semibold text-slate-900"
          data-testid="security-on-this-page-text"
        >
          On this page
        </p>

        <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
          {items.map((item) => (
            <li key={item.href} data-testid="security-toc-item">
              <a
                href={item.href}
                className="transition hover:text-amber-600"
                data-testid="security-toc-link"
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
        data-testid="security-section-title-heading"
      >
        {highlightBrands(section.title)}
      </h2>

      {section.body?.map((paragraph) => (
        <p
          key={paragraph}
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="security-paragraph-text"
        >
          {highlightBrands(paragraph)}
        </p>
      ))}

      {section.list ? (
        <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
          {section.list.map((item) => (
            <li key={`${item.label ?? ""}${item.text}`} data-testid="security-list-item">
              {item.label ? (
                <span className="font-medium text-slate-800" data-testid="security-list-label">
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
          data-testid="security-after-text"
        >
          {highlightBrands(section.after)}
        </p>
      ) : null}

      {section.afterNode ? (
        <div
          className="mt-4 text-base leading-relaxed text-slate-600"
          data-testid="security-after-node-text"
        >
          {section.afterNode}
        </div>
      ) : null}
    </section>
  );
}
