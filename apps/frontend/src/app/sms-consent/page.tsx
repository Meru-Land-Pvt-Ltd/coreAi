"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import type { Route } from "next";
import {
  SMS_CONSENT_DISCLOSURE_VERSION,
  verbalSmsConsentDisclosure,
  webFormSmsConsentDisclosure
} from "@coreai/shared";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";

const PRIVACY_ROUTE = "/privacy" as Route;
const TERMS_ROUTE = "/terms" as Route;

const LAST_UPDATED = "July 2026";

// The literal template shown to reviewers — the live system substitutes the
// actual business name for {{business_name}} at call/form time.
const VERBAL_DISCLOSURE = verbalSmsConsentDisclosure("{{business_name}}");
const CHECKBOX_DISCLOSURE = webFormSmsConsentDisclosure("{{business_name}}");

const tocItems = [
  { href: "#program", label: "Triven.ai SMS Messaging Program" },
  { href: "#message-types", label: "Types of Messages" },
  { href: "#verbal-consent", label: "Verbal Consent During an Inbound Call" },
  { href: "#example-affirmative", label: "Example Affirmative Conversation" },
  { href: "#example-decline", label: "Example Decline Conversation" },
  { href: "#web-consent", label: "Website or App Consent" },
  { href: "#consent-records", label: "Consent Records" },
  { href: "#frequency-charges", label: "Message Frequency and Charges" },
  { href: "#opt-out", label: "Opt-Out and Help" },
  { href: "#business-specific", label: "Business-Specific Consent" },
  { href: "#privacy", label: "Privacy" },
  { href: "#links", label: "Links" }
];

export default function SmsConsentPage() {
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

      <section className="mx-auto max-w-3xl px-6 pb-8 pt-32 md:pt-36">
        <h1
          className="text-4xl font-extrabold tracking-tight text-slate-900"
          data-testid="sms-consent-title-heading"
        >
          SMS Consent &amp; Messaging Program
        </h1>
        <p className="mt-4 text-sm text-slate-500" data-testid="sms-consent-last-updated-text">
          Last updated: {LAST_UPDATED} · Disclosure version: {SMS_CONSENT_DISCLOSURE_VERSION}
        </p>
      </section>

      <section className="mx-auto max-w-3xl px-6 pb-10">
        <div className="rounded-xl border border-gray-100 px-6 py-5">
          <p className="mb-3 text-sm font-semibold text-slate-900">On this page</p>
          <ol className="grid list-inside list-decimal gap-x-6 gap-y-2 text-sm text-slate-600 sm:grid-cols-2">
            {tocItems.map((item) => (
              <li key={item.href} data-testid="sms-consent-toc-item">
                <a href={item.href} className="transition hover:text-amber-600" data-testid="sms-consent-toc-link">
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <main className="mx-auto max-w-3xl px-6 pb-20">
        <PageSection id="program" title="1. Triven.ai SMS Messaging Program">
          <Paragraph>
            Triven.ai is operated by CollabGlam LLC. Triven.ai provides an AI-agent platform that
            enables businesses to answer calls, take booking and service requests, and — only after
            a customer's affirmative consent — send transactional appointment, booking, service,
            and customer-support text messages related to that customer's own request.
          </Paragraph>
          <Paragraph>
            Consent is collected in one of two auditable ways: verbally, during an inbound call
            answered by a Triven.ai-powered AI receptionist, or through a separate optional
            checkbox on a public booking or service-request form. Triven.ai never sends
            transactional SMS without a recorded opt-in, and consent is never a condition of
            booking or receiving services.
          </Paragraph>
        </PageSection>

        <PageSection id="message-types" title="2. Types of Messages">
          <Paragraph>Customers who opt in may receive the following transactional messages:</Paragraph>
          <BulletList
            items={[
              "Appointment confirmations",
              "Appointment reminders",
              "Booking updates",
              "Rescheduling notices",
              "Cancellations",
              "Service-request updates",
              "Customer-support messages"
            ]}
          />
          <Paragraph>
            These messages are transactional only. Promotional or marketing content is not part of
            this program.
          </Paragraph>
        </PageSection>

        <PageSection id="verbal-consent" title="3. Verbal Consent During an Inbound Call">
          <Paragraph>
            A customer calls a business's phone number. The business's Triven.ai-powered AI
            receptionist answers, helps with the customer's question, appointment, booking, or
            service request, and — when a text message would be useful and no valid consent is
            already on record — reads the following disclosure aloud, replacing{" "}
            <code className="rounded bg-slate-100 px-1 py-0.5 text-sm">{"{{business_name}}"}</code>{" "}
            with the actual business the customer called:
          </Paragraph>
          <Quote testId="sms-consent-verbal-disclosure-text">{VERBAL_DISCLOSURE}</Quote>
          <Paragraph>
            The AI waits for an explicit answer. Only a clear affirmative response (for example,
            "yes" or "yes please") is recorded as consent. A "no", silence, an interruption, or an
            unclear or ambiguous answer is treated as no consent, and no text messages are sent.
            The appointment, booking, or service request is completed either way — consent is
            never required to finish.
          </Paragraph>
        </PageSection>

        <PageSection id="example-affirmative" title="4. Example Affirmative Conversation">
          <Dialogue
            turns={[
              { speaker: "AI", text: VERBAL_DISCLOSURE },
              { speaker: "Customer", text: "Yes, please send me the confirmation." },
              { speaker: "AI", text: "Thank you. Your SMS consent has been recorded." }
            ]}
          />
        </PageSection>

        <PageSection id="example-decline" title="5. Example Decline Conversation">
          <Dialogue
            turns={[
              { speaker: "Customer", text: "No." },
              {
                speaker: "AI",
                text: "No problem. Your appointment is still confirmed, and no SMS will be sent."
              }
            ]}
          />
        </PageSection>

        <PageSection id="web-consent" title="6. Website or App Consent">
          <Paragraph>
            On a business's public booking or service-request form, customers may optionally agree
            to transactional SMS by ticking a separate checkbox with the following wording:
          </Paragraph>
          <Quote testId="sms-consent-checkbox-disclosure-text">{CHECKBOX_DISCLOSURE}</Quote>
          <BulletList
            items={[
              "The checkbox is unchecked by default.",
              "The checkbox is optional and is never bundled into Terms acceptance.",
              "The booking or service request can be submitted and completed without checking the box — no SMS is sent in that case."
            ]}
          />
        </PageSection>

        <PageSection id="consent-records" title="7. Consent Records">
          <Paragraph>
            For each opt-in, Triven may store an auditable consent record containing:
          </Paragraph>
          <BulletList
            items={[
              "The customer's mobile phone number",
              "The specific business the consent applies to",
              "The date and time of consent",
              "The consent method (verbal during a call, or website form)",
              "The call identifier or booking/service-request identifier",
              "The version (and integrity hash) of the disclosure that was presented",
              "Opt-out status and opt-out history"
            ]}
          />
          <Paragraph>
            Consent records are compliance evidence and are not used for marketing. This page
            contains no real customer information.
          </Paragraph>
        </PageSection>

        <PageSection id="frequency-charges" title="8. Message Frequency and Charges">
          <Paragraph>Message frequency varies.</Paragraph>
          <Paragraph>Message and data rates may apply.</Paragraph>
        </PageSection>

        <PageSection id="opt-out" title="9. Opt-Out and Help">
          <Paragraph>
            Reply <strong data-testid="sms-consent-stop-bold">STOP</strong> to opt out.
          </Paragraph>
          <Paragraph>
            Reply <strong data-testid="sms-consent-help-bold">HELP</strong> for assistance.
          </Paragraph>
          <Paragraph>
            Opting out stops future messages for that business's messaging program. Opt-out
            requests are honored automatically and synchronized with our consent records.
          </Paragraph>
        </PageSection>

        <PageSection id="business-specific" title="10. Business-Specific Consent">
          <Paragraph testId="sms-consent-business-specific-text">
            Consent is specific to the identified business and Triven.ai messaging program and
            applies only to transactional messages related to the customer's appointment, booking,
            service request, or customer-support interaction.
          </Paragraph>
        </PageSection>

        <PageSection id="privacy" title="11. Privacy">
          <Paragraph testId="sms-consent-privacy-text">
            Mobile phone numbers, SMS opt-in information, and consent records are not sold,
            rented, transferred, or shared with third parties, affiliates, or lead generators for
            marketing or promotional purposes.
          </Paragraph>
        </PageSection>

        <PageSection id="links" title="12. Links" isLast>
          <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
            <li>
              <Link href={PRIVACY_ROUTE} className="underline transition hover:text-amber-600" data-testid="sms-consent-privacy-link">
                https://triven.ai/privacy
              </Link>
            </li>
            <li>
              <Link href={TERMS_ROUTE} className="underline transition hover:text-amber-600" data-testid="sms-consent-terms-link">
                https://triven.ai/terms
              </Link>
            </li>
            <li>
              <a href="mailto:info@triven.ai" className="underline transition hover:text-amber-600" data-testid="sms-consent-support-email-link">
                info@triven.ai
              </a>
            </li>
          </ul>

          <h3 className="mt-10 text-lg font-bold text-slate-900" data-testid="sms-consent-flow-heading">
            How consent works
          </h3>
          <FlowDiagram
            steps={[
              "Customer calls or opens the booking form",
              "Consent disclosure shown or read aloud",
              "Customer says yes or checks the optional box",
              "Consent stored",
              "Transactional SMS may be sent"
            ]}
          />
        </PageSection>
      </main>

      <CoreFooter />
    </div>
  );
}

function PageSection({
  id,
  title,
  children,
  isLast = false
}: {
  id: string;
  title: string;
  children: ReactNode;
  isLast?: boolean;
}) {
  return (
    <section id={id} className={`pb-8 ${isLast ? "" : "border-b border-gray-100"}`}>
      <h2 className="mt-10 text-xl font-bold text-slate-900" data-testid="sms-consent-section-title-heading">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Paragraph({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <p
      className="mt-4 text-base leading-relaxed text-slate-600"
      data-testid={testId ?? "sms-consent-paragraph-text"}
    >
      {children}
    </p>
  );
}

function BulletList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="mt-4 list-outside list-disc space-y-3 pl-6 text-base leading-relaxed text-slate-600">
      {items.map((item) => (
        <li key={item} data-testid="sms-consent-list-item">
          {item}
        </li>
      ))}
    </ul>
  );
}

function Quote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <blockquote
      className="mt-4 rounded-xl border-l-4 border-amber-400 bg-slate-50 px-5 py-4 text-base italic leading-relaxed text-slate-700"
      data-testid={testId ?? "sms-consent-quote-text"}
    >
      “{children}”
    </blockquote>
  );
}

function Dialogue({ turns }: { turns: { speaker: string; text: string }[] }) {
  return (
    <div className="mt-4 space-y-3">
      {turns.map((turn, index) => (
        <div
          key={`${turn.speaker}-${index}`}
          className="rounded-xl border border-gray-100 bg-white px-5 py-4"
          data-testid="sms-consent-dialogue-turn"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-600">{turn.speaker}</p>
          <p className="mt-1 text-base leading-relaxed text-slate-600">“{turn.text}”</p>
        </div>
      ))}
    </div>
  );
}

/** Simple, non-interactive vertical flow diagram. Contains no PII. */
function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <div className="mt-4 flex flex-col items-center" data-testid="sms-consent-flow-diagram">
      {steps.map((step, index) => (
        <div key={step} className="flex w-full max-w-md flex-col items-center">
          <div className="w-full rounded-xl border border-gray-200 bg-slate-50 px-5 py-3 text-center text-sm font-medium text-slate-700">
            {step}
          </div>
          {index < steps.length - 1 ? (
            <div className="py-1 text-lg leading-none text-amber-500" aria-hidden="true">
              ↓
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
