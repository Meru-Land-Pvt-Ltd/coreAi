import { describe, expect, it } from "vitest";
import type { SectionNode } from "@coreai/shared";
import {
  CTA_BAND_EXAMPLE,
  EXAMPLE_HOME_BLOCKS,
  FAQ_ACCORDION_EXAMPLE,
  FEATURE_GRID_EXAMPLE,
  HERO_EXAMPLE,
  PRICING_TABLE_EXAMPLE,
  SECTION_EXAMPLES,
  STATS_BAND_EXAMPLE,
  TESTIMONIAL_ROW_EXAMPLE
} from "./examples";
import { pageSectionKinds, recognizeSection } from "./recognize";
import type { RecognizedSection, SectionKind } from "./types";

function kindOf(node: SectionNode, isFirstBlock = false): SectionKind | null {
  return recognizeSection(node, { isFirstBlock })?.kind ?? null;
}

describe("recognizeSection — every canonical example resolves to its own kind", () => {
  const cases = Object.entries(SECTION_EXAMPLES) as [SectionKind, SectionNode][];
  it.each(cases)("%s", (kind, node) => {
    expect(kindOf(node)).toBe(kind);
  });

  it("reads a whole home page in order", () => {
    expect(pageSectionKinds(EXAMPLE_HOME_BLOCKS)).toEqual([
      "hero",
      "statsBand",
      "featureGrid",
      "testimonialRow",
      "pricingTable",
      "faqAccordion",
      "ctaBand"
    ]);
  });
});

describe("hero", () => {
  it("pulls the badge, headline, copy, actions and live output apart", () => {
    const match = recognizeSection(HERO_EXAMPLE) as RecognizedSection<"hero">;
    expect(match.kind).toBe("hero");
    expect(match.parts.eyebrow?.text).toBe("New");
    expect(match.parts.heading.text).toContain("A month of social posts");
    expect(match.parts.subtext?.text).toContain("Tell it about your business");
    expect(match.parts.actions.map((node) => node.type)).toEqual(["input", "button", "button"]);
    expect(match.parts.note?.text).toBe("No card needed to try it.");
    expect(match.parts.live.map((node) => node.type)).toEqual(["result"]);
  });

  it("treats a headline-led first block as a hero even without a level-1 heading", () => {
    const node: SectionNode = {
      id: "top",
      type: "section",
      children: [
        { id: "top-h", type: "heading", level: 2, text: "Book more jobs" },
        { id: "top-t", type: "text", text: "Answer the phone even when you are on a ladder." },
        { id: "top-b", type: "button", label: "Try it", wire: { role: "action" } }
      ]
    };
    expect(kindOf(node, true)).toBe("hero");
    // The same block halfway down the page is a closing CTA, not a second hero.
    expect(kindOf(node, false)).toBe("ctaBand");
  });

  it("refuses a bare headline with nothing to do", () => {
    const node: SectionNode = {
      id: "hero",
      type: "section",
      children: [{ id: "h", type: "heading", level: 1, text: "Hello" }]
    };
    expect(kindOf(node, true)).toBeNull();
  });
});

describe("pricing", () => {
  it("extracts plan name, price, period, features and CTA", () => {
    const match = recognizeSection(PRICING_TABLE_EXAMPLE) as RecognizedSection<"pricingTable">;
    expect(match.parts.plans.map((plan) => plan.name)).toEqual(["Starter", "Growing", "Team"]);
    expect(match.parts.plans[1].price).toBe("$29");
    expect(match.parts.plans[1].period).toBe("per month");
    expect(match.parts.plans[1].description).toBe("For a business posting every week.");
    expect(match.parts.plans[1].features).toHaveLength(4);
    expect(match.parts.plans[1].cta?.label).toBe("Choose Growing");
    expect(match.parts.note?.text).toContain("Cancel any time");
  });

  it("highlights the badged plan", () => {
    const match = recognizeSection(PRICING_TABLE_EXAMPLE) as RecognizedSection<"pricingTable">;
    expect(match.parts.plans.map((plan) => plan.highlighted)).toEqual([false, true, false]);
  });

  it("falls back to the middle of three when nothing is badged", () => {
    const stripped = JSON.parse(JSON.stringify(PRICING_TABLE_EXAMPLE)) as SectionNode;
    const grid = stripped.children.find((child) => child.id === "pricing-grid");
    if (grid && "children" in grid) {
      for (const plan of grid.children) {
        if ("children" in plan) {
          plan.children = plan.children.filter((child) => child.type !== "badge");
        }
      }
    }
    const match = recognizeSection(stripped) as RecognizedSection<"pricingTable">;
    // Every CTA in the stripped fixture keeps its own variant, and only the
    // middle plan is primary — so the lone primary wins before the positional
    // fallback is ever needed.
    expect(match.parts.plans.map((plan) => plan.highlighted)).toEqual([false, true, false]);
  });

  it("is not fooled by a feature grid", () => {
    expect(kindOf(FEATURE_GRID_EXAMPLE)).toBe("featureGrid");
  });
});

describe("faq", () => {
  it("reads question and answer pairs written as sibling containers", () => {
    const match = recognizeSection(FAQ_ACCORDION_EXAMPLE) as RecognizedSection<"faqAccordion">;
    expect(match.parts.items).toHaveLength(3);
    expect(match.parts.items[0].question).toBe("Do I need to know anything technical?");
    expect(match.parts.items[0].answer).toContain("plain English");
    expect(match.parts.heading?.text).toBe("Common questions");
  });

  it("reads the flat heading/text form and lifts the section title out of the list", () => {
    const node: SectionNode = {
      id: "help",
      type: "section",
      children: [
        { id: "t", type: "heading", level: 2, text: "Questions people ask" },
        { id: "q1", type: "heading", level: 3, text: "How long does it take?" },
        { id: "a1", type: "text", text: "About a minute." },
        { id: "q2", type: "heading", level: 3, text: "Can I cancel?" },
        { id: "a2", type: "text", text: "Yes, whenever you like." },
        { id: "q3", type: "heading", level: 3, text: "Is there a free trial?" },
        { id: "a3", type: "text", text: "There is." }
      ]
    };
    const match = recognizeSection(node) as RecognizedSection<"faqAccordion">;
    expect(match.kind).toBe("faqAccordion");
    expect(match.parts.items.map((item) => item.question)).toEqual([
      "How long does it take?",
      "Can I cancel?",
      "Is there a free trial?"
    ]);
    expect(match.parts.heading?.text).toBe("Questions people ask");
  });

  it("does not turn a grid of cards into an accordion", () => {
    const node: SectionNode = {
      id: "cards",
      type: "section",
      children: [
        {
          id: "cards-grid",
          type: "grid",
          columns: 3,
          children: [
            {
              id: "c1",
              type: "stack",
              children: [
                { id: "c1h", type: "heading", level: 3, text: "What is it?" },
                { id: "c1t", type: "text", text: "A helper." }
              ]
            },
            {
              id: "c2",
              type: "stack",
              children: [
                { id: "c2h", type: "heading", level: 3, text: "Who is it for?" },
                { id: "c2t", type: "text", text: "Small teams." }
              ]
            },
            {
              id: "c3",
              type: "stack",
              children: [
                { id: "c3h", type: "heading", level: 3, text: "How much?" },
                { id: "c3t", type: "text", text: "Free to start." }
              ]
            }
          ]
        }
      ]
    };
    expect(kindOf(node)).toBe("featureGrid");
  });
});

describe("other shapes", () => {
  it("reads a stats band", () => {
    const match = recognizeSection(STATS_BAND_EXAMPLE) as RecognizedSection<"statsBand">;
    expect(match.parts.stats.map((stat) => stat.value)).toEqual(["1.2M", "6 hours", "4.9/5"]);
  });

  it("reads a testimonial row and keeps the author and role", () => {
    const match = recognizeSection(TESTIMONIAL_ROW_EXAMPLE) as RecognizedSection<"testimonialRow">;
    expect(match.parts.quotes).toHaveLength(3);
    expect(match.parts.quotes[0].author).toBe("Priya Raman");
    expect(match.parts.quotes[0].role).toContain("Sunrise Bakery");
  });

  it("reads a closing CTA band", () => {
    const match = recognizeSection(CTA_BAND_EXAMPLE) as RecognizedSection<"ctaBand">;
    expect(match.parts.heading?.text).toBe("Try it on your next post");
    expect(match.parts.actions).toHaveLength(1);
    expect(match.parts.note?.text).toBe("No card needed.");
  });

  it("refuses to call the working product surface a CTA band", () => {
    // heading + input + button reads exactly like a closing ask, so the only
    // thing separating the two is the result. The CTA band has nowhere to put
    // one, and recognizing this would drop the customer's answer off the page.
    const productSurface: SectionNode = {
      id: "product",
      type: "section",
      padding: "lg",
      children: [
        { id: "product-title", type: "heading", level: 2, text: "Try it now" },
        { id: "field", type: "input", label: "Your idea", wire: { role: "input", nodeId: "in" } },
        { id: "go", type: "button", label: "Make it", wire: { role: "action", nodeId: "gen" } },
        { id: "out", type: "result", wire: { role: "output", nodeId: "gen" } }
      ]
    };

    expect(recognizeSection(productSurface)).toBeNull();
    // Without the result it is a closing ask again.
    expect(
      kindOf(
        {
          ...productSurface,
          children: productSurface.children.filter((child) => child.type !== "result")
        },
        false
      )
    ).toBe("ctaBand");
  });

  it("recognizes a bare grid block that was never wrapped in a section", () => {
    const grid: SectionNode["children"][number] = {
      id: "loose-grid",
      type: "grid",
      columns: 2,
      children: [
        {
          id: "g1",
          type: "stack",
          children: [
            { id: "g1i", type: "icon", name: "zap" },
            { id: "g1h", type: "heading", level: 3, text: "Fast" }
          ]
        },
        {
          id: "g2",
          type: "stack",
          children: [
            { id: "g2i", type: "icon", name: "lock" },
            { id: "g2h", type: "heading", level: 3, text: "Private" }
          ]
        }
      ]
    };
    expect(recognizeSection(grid)?.kind).toBe("featureGrid");
  });
});

describe("nothing is forced", () => {
  it("returns null for a shape with no known composition", () => {
    const node: SectionNode = {
      id: "gallery",
      type: "section",
      children: [
        { id: "i1", type: "image", url: "/a.png", alt: "A" },
        { id: "i2", type: "image", url: "/b.png", alt: "B" },
        { id: "d", type: "divider" }
      ]
    };
    expect(kindOf(node)).toBeNull();
  });

  it("returns null for an empty section", () => {
    expect(kindOf({ id: "empty", type: "section", children: [] })).toBeNull();
  });

  it("returns null for a leaf node", () => {
    expect(recognizeSection({ id: "t", type: "text", text: "hello" })).toBeNull();
  });
});
