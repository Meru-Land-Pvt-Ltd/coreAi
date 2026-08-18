import { describe, expect, it } from "vitest";
import { productSpecSchema, sanitizeProductSpec, type PageSpec, type SpecNode } from "@coreai/shared";
import { LEGAL_REVIEW_NOTE, generateLegalPages, withLegalPages } from "./legal-pages";

/**
 * The legal generator. Two things matter most: the pages are COMPLETE (a
 * generated page must never ship with a blank still in it) and they are
 * HONEST (they say what the product actually does with a customer's data).
 */

const BASE = {
  businessName: "Ray Studio Ltd",
  contactEmail: "privacy@raystudio.com",
  productName: "Thumbnail Genie",
  effectiveDate: new Date("2026-08-16T00:00:00.000Z")
};

/** Every visible word on a page, joined. */
function allText(page: PageSpec): string {
  const parts: string[] = [page.title, page.seo?.description ?? ""];
  const walk = (nodes: SpecNode[]) => {
    for (const node of nodes) {
      if ("children" in node) {
        walk(node.children);
        continue;
      }
      if (node.type === "heading" || node.type === "text") parts.push(node.text);
      if (node.type === "list") parts.push(node.items.join(" "));
    }
  };
  walk(page.blocks);
  return parts.join("\n");
}

/** Wraps a page in a spec so the real contract validator can check it. */
function asSpec(...pages: PageSpec[]) {
  return {
    version: 1 as const,
    pages: [
      { id: "home", title: "Home", path: "", blocks: [{ id: "h", type: "heading" as const, text: "Home" }] },
      ...pages
    ],
    nav: { links: [], footerLinks: [] }
  };
}

describe("generateLegalPages — shape", () => {
  it("returns pages the Product Spec contract accepts unchanged", () => {
    const { privacy, terms } = generateLegalPages(BASE);

    expect(privacy).toMatchObject({ id: "privacy", path: "privacy", title: "Privacy Policy" });
    expect(terms).toMatchObject({ id: "terms", path: "terms", title: "Terms of Service" });

    const spec = asSpec(privacy, terms);
    expect(productSpecSchema.safeParse(spec).success).toBe(true);
    // Nothing is dropped or rewritten on the way through the sanitizer.
    expect(sanitizeProductSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);
  });

  it("is a pure function — same input, identical output", () => {
    expect(generateLegalPages(BASE)).toEqual(generateLegalPages(BASE));
  });

  it("hands the architect a review note that is never on the customer's page", () => {
    const { privacy, terms, reviewNote } = generateLegalPages(BASE);

    expect(reviewNote).toBe(LEGAL_REVIEW_NOTE);
    expect(reviewNote.toLowerCase()).toContain("not legal advice");
    expect(reviewNote.toLowerCase()).toContain("lawyer");
    expect(allText(privacy)).not.toContain(LEGAL_REVIEW_NOTE);
    expect(allText(terms)).not.toContain(LEGAL_REVIEW_NOTE);
  });
});

describe("generateLegalPages — nothing left to fill in", () => {
  const cases: Array<[string, Parameters<typeof generateLegalPages>[0]]> = [
    ["full details", { ...BASE, country: "United Kingdom", dataUsed: ["Your video title"], refundDays: 30 }],
    ["no country", BASE],
    ["payments off", { ...BASE, paymentsEnabled: false }],
    ["nothing at all", { businessName: "", contactEmail: "", productName: "" }]
  ];

  for (const [name, input] of cases) {
    it(`leaves no placeholder behind (${name})`, () => {
      const { privacy, terms } = generateLegalPages(input);

      for (const page of [privacy, terms]) {
        const text = allText(page);
        for (const marker of ["{", "}", "[", "]", "TODO", "TBD", "XXX", "Lorem", "undefined", "NaN", "null"]) {
          expect(text, `${name}: found "${marker}"`).not.toContain(marker);
        }
        expect(text).not.toMatch(/\byour (business|company) name\b/i);
        expect(text.trim().length).toBeGreaterThan(500);
      }
    });
  }

  it("stays valid when every optional field is missing", () => {
    const { privacy, terms } = generateLegalPages({
      businessName: "",
      contactEmail: "",
      productName: ""
    });

    expect(productSpecSchema.safeParse(asSpec(privacy, terms)).success).toBe(true);
    // Honest stand-ins, not empty gaps.
    expect(allText(privacy)).toContain("this business");
    expect(allText(terms)).toContain("this product");
  });
});

describe("generateLegalPages — privacy content", () => {
  it("covers data collected, AI processing, third parties, retention and contact", () => {
    const text = allText(generateLegalPages(BASE).privacy);

    expect(text).toContain("What we collect");
    expect(text).toContain("How AI is used");
    expect(text).toContain("Who else sees your information");
    expect(text).toContain("How long we keep it");
    expect(text).toContain("Contact");
    expect(text).toContain("privacy@raystudio.com");
    expect(text).toContain("Ray Studio Ltd");
    expect(text).toContain("Thumbnail Genie");
    expect(text).toContain("Last updated 16 August 2026");
  });

  it("is honest about content leaving the product for an AI model", () => {
    const text = allText(generateLegalPages(BASE).privacy).toLowerCase();

    expect(text).toContain("sent to an ai model");
    expect(text).toContain("can be wrong");
    expect(text).toContain("we do not sell your information");
  });

  it("uses the architect's own list of what is collected", () => {
    const text = allText(
      generateLegalPages({ ...BASE, dataUsed: ["The video title you type", "The channel name"] }).privacy
    );

    expect(text).toContain("The video title you type");
    expect(text).toContain("The channel name");
    // The generic default list is replaced, not appended to.
    expect(text).not.toContain("Any file you choose to upload");
  });

  it("names the third parties the architect listed", () => {
    const text = allText(generateLegalPages({ ...BASE, thirdParties: ["OpenAI, for image generation"] }).privacy);
    expect(text).toContain("OpenAI, for image generation");
  });
});

describe("generateLegalPages — terms content", () => {
  it("covers the agreement, AI limits, payments, refunds, liability and law", () => {
    const text = allText(generateLegalPages({ ...BASE, country: "England and Wales", refundDays: 30 }).terms);

    expect(text).toContain("The agreement");
    expect(text).toContain("AI results are not guaranteed");
    expect(text).toContain("Paying for the product");
    expect(text).toContain("Refunds");
    expect(text).toContain("within 30 days");
    expect(text).toContain("Limits of responsibility");
    expect(text).toContain("The laws of England and Wales apply");
    expect(text).toContain("Your content stays yours");
  });

  it("defaults to a 14 day refund window", () => {
    expect(allText(generateLegalPages(BASE).terms)).toContain("within 14 days");
  });

  it("writes an honest jurisdiction line when no country is given", () => {
    const text = allText(generateLegalPages(BASE).terms);

    expect(text).toContain("the country where Ray Studio Ltd is registered");
    expect(text).not.toContain("The laws of  apply");
  });

  it("drops payment and refund sections when the product is free", () => {
    const free = generateLegalPages({ ...BASE, paymentsEnabled: false });

    expect(allText(free.terms)).not.toContain("Refunds");
    expect(allText(free.terms)).not.toContain("Paying for the product");
    expect(allText(free.privacy)).not.toContain("Payments");
    expect(allText(free.privacy)).not.toContain("Payment records");
    // The "do not paste your card number into an AI" warning always stays.
    expect(allText(free.privacy)).toContain("card numbers, health records");
  });

  it("clamps a silly refund window instead of printing it", () => {
    expect(allText(generateLegalPages({ ...BASE, refundDays: -5 }).terms)).toContain("within 1 day");
    expect(allText(generateLegalPages({ ...BASE, refundDays: 99999 }).terms)).toContain("within 365 days");
  });
});

describe("withLegalPages", () => {
  it("appends both pages and their footer links to an existing spec", () => {
    const merged = withLegalPages(asSpec(), BASE);

    expect(merged.pages.map((page) => page.id)).toEqual(["home", "privacy", "terms"]);
    expect(merged.nav.footerLinks).toEqual([
      { label: "Privacy", pageId: "privacy" },
      { label: "Terms", pageId: "terms" }
    ]);
  });

  it("replaces the old legal pages instead of duplicating them", () => {
    const once = withLegalPages(asSpec(), BASE);
    const twice = withLegalPages(once, { ...BASE, country: "Ireland" });

    expect(twice.pages.filter((page) => page.id === "privacy")).toHaveLength(1);
    expect(twice.nav.footerLinks).toHaveLength(2);
    expect(allText(twice.pages.find((page) => page.id === "terms") as PageSpec)).toContain(
      "The laws of Ireland apply"
    );
  });
});
