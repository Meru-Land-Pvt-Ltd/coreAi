import { sanitizeProductSpec, type PageSpec, type SpecNode } from "@coreai/shared";

/**
 * Privacy + Terms generator for a Product Spec site.
 *
 * Pure functions. No LLM, no network, no database — the same input always
 * produces the same pages, so an architect can regenerate them after changing
 * a detail and get a clean diff instead of freshly hallucinated wording.
 *
 * The writing rules, in order of importance:
 *   1. Plain English. Short sentences. No "hereinafter", no "the Company".
 *   2. Honest. It never promises something the platform cannot deliver
 *      (an AI provider's internal use, perfect uptime, guaranteed accuracy).
 *   3. Complete. Nothing is left as a blank to fill in — every value either
 *      comes from the architect or has an honest plain-English stand-in, so a
 *      generated page is never published with a placeholder still in it.
 *
 * This is NOT legal advice. `reviewNote` says so in words the builder shows
 * the architect; the pages themselves carry the ordinary public disclaimer.
 */

export type LegalPagesInput = {
  /** The legal entity or person selling the product. */
  businessName: string;
  /** Where a customer writes about their data. Shown publicly. */
  contactEmail: string;
  /** The product's public name. */
  productName: string;
  /** Country or region whose law applies. Omitted = honest stand-in wording. */
  country?: string | null;
  /** What the product collects, in the architect's own words. */
  dataUsed?: string[] | null;
  /** Named third parties (AI providers, hosts). Omitted = generic honest list. */
  thirdParties?: string[] | null;
  /** False drops the payment and refund sections entirely. Default true. */
  paymentsEnabled?: boolean | null;
  /** Refund window in days. Default 14. */
  refundDays?: number | null;
  /** "Last updated" date. Default: today. */
  effectiveDate?: Date | string | null;
};

export type GeneratedLegalPages = {
  privacy: PageSpec;
  terms: PageSpec;
  /**
   * Architect-facing, never rendered on the customer's site: the one line the
   * builder must show before these pages go live.
   */
  reviewNote: string;
};

export const LEGAL_REVIEW_NOTE =
  "These pages were written from your answers, in plain English. They are a solid starting point, not legal advice — read them, make sure every line is true for your business, and have a lawyer check them before you take money.";

/** The public disclaimer that ships on the pages themselves. */
const PUBLIC_DISCLAIMER =
  "This page is written in plain English so it is easy to read. It describes how we actually work, and it is not a substitute for legal advice.";

const DEFAULT_REFUND_DAYS = 14;

// ---------------------------------------------------------------------------
// Input cleaning. Everything here is architect-typed, so nothing is trusted.
// ---------------------------------------------------------------------------

function clean(value: unknown, max: number, fallback: string): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return text || fallback;
}

function cleanList(value: unknown, max: number, itemCap: number): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const entry of value) {
    if (items.length >= max) break;
    const text = typeof entry === "string" ? entry.replace(/\s+/g, " ").trim().slice(0, itemCap) : "";
    if (text) items.push(text);
  }
  return items;
}

function formatDate(value: Date | string | null | undefined): string {
  const date = value instanceof Date ? value : value ? new Date(value) : new Date();
  const safe = Number.isNaN(date.getTime()) ? new Date() : date;
  return safe.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Section → nodes.
// ---------------------------------------------------------------------------

type LegalSection = {
  title: string;
  /** Paragraphs, in order. */
  body?: string[];
  /** A checked list under the paragraphs. */
  items?: string[];
};

function sectionNodes(pageId: string, section: LegalSection, index: number): SpecNode[] {
  const base = `${pageId}-s${index + 1}`;
  const nodes: SpecNode[] = [
    { id: `${base}-title`, type: "heading", level: 2, text: section.title }
  ];
  (section.body ?? []).forEach((paragraph, bodyIndex) => {
    nodes.push({ id: `${base}-p${bodyIndex + 1}`, type: "text", text: paragraph });
  });
  if (section.items && section.items.length > 0) {
    nodes.push({ id: `${base}-list`, type: "list", items: section.items, listStyle: "check" });
  }
  return nodes;
}

/** Hero + one readable column of sections. Same skeleton for both pages. */
function buildLegalPage(args: {
  id: string;
  path: string;
  title: string;
  intro: string;
  updated: string;
  sections: LegalSection[];
}): PageSpec {
  const body: SpecNode[] = [];
  args.sections.forEach((section, index) => {
    body.push(...sectionNodes(args.id, section, index));
  });
  body.push({
    id: `${args.id}-disclaimer`,
    type: "text",
    text: PUBLIC_DISCLAIMER,
    size: "sm",
    style: { textTone: "muted" }
  });

  const page: PageSpec = {
    id: args.id,
    title: args.title,
    path: args.path,
    seo: { description: args.intro.slice(0, 300) },
    blocks: [
      {
        id: `${args.id}-hero`,
        type: "section",
        padding: "lg",
        background: "tint",
        children: [
          {
            id: `${args.id}-hero-stack`,
            type: "stack",
            gap: "sm",
            align: "start",
            children: [
              { id: `${args.id}-hero-title`, type: "heading", level: 1, text: args.title },
              {
                id: `${args.id}-hero-updated`,
                type: "text",
                text: `Last updated ${args.updated}`,
                size: "sm",
                style: { textTone: "muted" }
              },
              { id: `${args.id}-hero-intro`, type: "text", text: args.intro, size: "lg" }
            ]
          }
        ]
      },
      {
        id: `${args.id}-body`,
        type: "section",
        padding: "lg",
        background: "plain",
        children: [
          {
            id: `${args.id}-body-stack`,
            type: "stack",
            gap: "lg",
            align: "start",
            style: { maxWidth: "lg" },
            children: body
          }
        ]
      }
    ]
  };
  return page;
}

// ---------------------------------------------------------------------------
// The generator.
// ---------------------------------------------------------------------------

/**
 * Ready-to-publish privacy and terms pages for a Product Spec site.
 *
 * Both are complete PageSpec objects: append them to `spec.pages` and add the
 * matching footer links. Nothing in them needs filling in afterwards.
 */
export function generateLegalPages(input: LegalPagesInput): GeneratedLegalPages {
  const business = clean(input.businessName, 80, "this business");
  const product = clean(input.productName, 80, "this product");
  const email = clean(input.contactEmail, 120, "");
  const updated = formatDate(input.effectiveDate);
  const paymentsEnabled = input.paymentsEnabled !== false;
  const refundDays =
    typeof input.refundDays === "number" && Number.isFinite(input.refundDays)
      ? Math.min(Math.max(Math.round(input.refundDays), 1), 365)
      : DEFAULT_REFUND_DAYS;

  // Jurisdiction: the architect's country when they gave one, otherwise a
  // sentence that is true either way — never a blank to fill in later.
  const country = clean(input.country, 60, "");
  const jurisdiction = country
    ? `The laws of ${country} apply to these terms, and disputes are handled by the courts of ${country}.`
    : `The laws of the country where ${business} is registered apply to these terms, and disputes are handled by the courts of that country.`;
  const wherePrivacy = country
    ? `${business} operates from ${country}. Your information may be processed there and in other countries where our providers run their servers.`
    : `${business} operates from the country where it is registered. Your information may be processed there and in other countries where our providers run their servers.`;

  // Contact wording degrades honestly if no email was given.
  const contactLine = email
    ? `Email ${email} and a person will reply.`
    : `Use the contact details shown on the ${product} website and a person will reply.`;
  const contactShort = email ? `Email ${email}.` : `Use the contact details shown on the ${product} website.`;

  const collected = cleanList(input.dataUsed, 12, 200);
  const dataItems =
    collected.length > 0
      ? collected
      : [
          "What you type into the product",
          "Any file you choose to upload",
          "Your email address, if you give it to us",
          "Basic technical details your browser sends, such as your IP address and browser type"
        ];

  const named = cleanList(input.thirdParties, 8, 120);
  const providerItems =
    named.length > 0
      ? named
      : [
          "AI model providers, which receive your request and return the result",
          "Hosting and infrastructure providers, which run the servers",
          ...(paymentsEnabled ? ["A payment provider, which handles your card details"] : [])
        ];

  const privacySections: LegalSection[] = [
    {
      title: "Who we are",
      body: [
        `${product} is run by ${business}. This policy covers ${product} and anything you do inside it.`,
        `If you have a question about your information, get in touch. ${contactLine}`
      ]
    },
    {
      title: "What we collect",
      body: ["We only collect what the product needs to work:"],
      items: dataItems
    },
    {
      title: "Why we collect it",
      body: ["Each piece of information has a job:"],
      items: [
        "To run your request and give you a result",
        "To keep the service working and to stop abuse",
        "To reply when you contact us",
        ...(paymentsEnabled ? ["To take payment and keep the records the law requires"] : [])
      ]
    },
    {
      title: "How AI is used",
      body: [
        `${product} uses artificial intelligence to do its work. What you type or upload is sent to an AI model, which reads it and produces your result.`,
        "Because your content leaves our servers to be processed, please do not put anything into the product that you would not be comfortable sending to another company: passwords, card numbers, health records, or anyone else's private details.",
        "AI results are generated, not looked up. They can be wrong. Check anything important before you act on it."
      ]
    },
    {
      title: "Who else sees your information",
      body: [
        "We do not sell your information and we do not share it for advertising. We do pass what is needed to the companies that help us run the product:"
      ],
      items: providerItems
    },
    {
      title: "Where your information is handled",
      body: [wherePrivacy]
    },
    ...(paymentsEnabled
      ? [
          {
            title: "Payments",
            body: [
              `When you pay, your card details go straight to our payment provider. ${business} never sees or stores your full card number. We keep a record of what you bought, when, and how much you paid, because we have to.`
            ]
          }
        ]
      : []),
    {
      title: "How long we keep it",
      body: [
        `We keep your requests and results while your account is active, and for a short period afterwards so we can fix problems and meet our record-keeping duties.${
          paymentsEnabled ? " Payment records are kept for as long as tax rules require." : ""
        }`,
        "You can ask us to delete your information at any time."
      ]
    },
    {
      title: "Your choices",
      body: ["You can ask us to:"],
      items: [
        "Send you a copy of the information we hold about you",
        "Correct anything that is wrong",
        "Delete your information",
        "Stop using your information for a particular purpose"
      ]
    },
    {
      title: "Cookies",
      body: [
        "We use small files called cookies to keep you signed in and to remember your settings. We do not use them to follow you around other websites."
      ]
    },
    {
      title: "Children",
      body: [
        `${product} is not built for children under 13, and we do not knowingly collect their information. If you believe a child has given us information, contact us and we will remove it.`
      ]
    },
    {
      title: "Changes to this policy",
      body: [
        "If we change how we handle your information, we will update this page and change the date at the top. If the change is significant, we will tell you directly."
      ]
    },
    {
      title: "Contact",
      body: [`Questions about your information go to ${business}. ${contactShort}`]
    }
  ];

  const termsSections: LegalSection[] = [
    {
      title: "The agreement",
      body: [
        `These terms are between you and ${business}, the company behind ${product}. By using ${product} you agree to them. If you do not agree, please do not use the product.`
      ]
    },
    {
      title: `What ${product} does`,
      body: [
        `${product} takes what you ask for, sends it to an AI model, and gives you back a result. It is a tool that helps you do work faster.`
      ]
    },
    {
      title: "AI results are not guaranteed",
      body: [
        "AI can be wrong, out of date, or unsuitable for your situation. It can also produce results that look confident and are not correct.",
        `${business} does not promise that any result will be accurate, complete, or fit for a particular purpose. Check anything important before you rely on it, and never use ${product} as a substitute for professional advice.`
      ]
    },
    {
      title: "What we ask of you",
      body: ["Using the product means agreeing to:"],
      items: [
        "Use it lawfully, and only for what it is meant for",
        "Only upload content you have the right to use",
        "Not use it to create illegal, harmful, or deliberately misleading material",
        "Not try to break, overload, copy, or reverse-engineer the service",
        "Keep your account details to yourself"
      ]
    },
    {
      title: "Your content stays yours",
      body: [
        `You keep ownership of everything you put into ${product} and of the results it gives you. You give ${business} permission to process your content only so far as it takes to produce your result and to run the service.`
      ]
    },
    ...(paymentsEnabled
      ? [
          {
            title: "Paying for the product",
            body: [
              "The price is shown before you pay. Subscriptions renew at the end of each period until you cancel, and you can cancel at any time from your account. Taxes are added where they apply."
            ]
          },
          {
            title: "Refunds",
            body: [
              `If ${product} does not do what this website says it does, ask for a refund within ${refundDays} days of paying and ${business} will give your money back. ${contactShort}`,
              "Refunds are not given for usage you have already had, and heavy use before a refund request may reduce what is returned. Where the law gives you a stronger right to a refund, that law wins."
            ]
          }
        ]
      : []),
    {
      title: "Keeping the service running",
      body: [
        `${business} works to keep ${product} available, but does not promise it will never be down. Features may change, improve, or be removed as the product develops. If a change removes something you paid for, ${business} will tell you.`
      ]
    },
    {
      title: "Ending your access",
      body: [
        `You can stop using ${product} at any time. ${business} can suspend or close an account that breaks these terms or puts the service or other people at risk, and will explain why where it is able to.`
      ]
    },
    {
      title: "Limits of responsibility",
      body: [
        `As far as the law allows, ${business} is not responsible for lost profits, lost data, or knock-on losses that follow from using ${product} or from a result it produced.`,
        `Where ${business} is found responsible, that responsibility is limited to the amount you paid in the twelve months before the problem arose. Nothing here removes rights the law does not allow to be removed.`
      ]
    },
    {
      title: "Which law applies",
      body: [jurisdiction]
    },
    {
      title: "Changes to these terms",
      body: [
        "If these terms change, we will update this page and change the date at the top. Continuing to use the product after a change means accepting the new terms."
      ]
    },
    {
      title: "Contact",
      body: [`These terms are issued by ${business}. ${contactShort}`]
    }
  ];

  const privacy = buildLegalPage({
    id: "privacy",
    path: "privacy",
    title: "Privacy Policy",
    intro: `This page explains what ${product} collects, why it collects it, and what happens to it. No jargon.`,
    updated,
    sections: privacySections
  });

  const terms = buildLegalPage({
    id: "terms",
    path: "terms",
    title: "Terms of Service",
    intro: `These are the rules for using ${product}, written so you can actually read them.`,
    updated,
    sections: termsSections
  });

  return { privacy, terms, reviewNote: LEGAL_REVIEW_NOTE };
}

/**
 * Both legal pages plus the footer links that point at them — the shape the
 * caller merges into an existing ProductSpec. Pages already present under the
 * same id are replaced rather than duplicated.
 */
export function withLegalPages<T extends { pages: PageSpec[]; nav: { footerLinks: { label: string; pageId: string }[] } }>(
  spec: T,
  input: LegalPagesInput
): T {
  const { privacy, terms } = generateLegalPages(input);
  const kept = spec.pages.filter((page) => page.id !== "privacy" && page.id !== "terms");
  const footerLinks = spec.nav.footerLinks.filter(
    (link) => link.pageId !== "privacy" && link.pageId !== "terms"
  );

  const merged = {
    ...spec,
    pages: [...kept, privacy, terms],
    nav: {
      ...spec.nav,
      footerLinks: [
        ...footerLinks,
        { label: "Privacy", pageId: "privacy" },
        { label: "Terms", pageId: "terms" }
      ]
    }
  };

  // The merge goes through the same door as everything else: caps, ids and
  // nav links are re-checked so appending legal pages can never produce an
  // invalid spec.
  return (sanitizeProductSpec(merged) as unknown as T) ?? (merged as T);
}
