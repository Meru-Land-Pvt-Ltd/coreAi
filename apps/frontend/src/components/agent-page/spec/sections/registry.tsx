import type { ComponentType, ReactElement } from "react";
import type { ButtonNode, SpecNode } from "@coreai/shared";
import { CtaBandSection } from "./cta-band";
import { FaqAccordionSection } from "./faq-accordion";
import { FeatureGridSection } from "./feature-grid";
import { HeroSection } from "./hero-section";
import { PricingTableSection } from "./pricing-table";
import { recognizeSection } from "./recognize";
import { SiteFooter } from "./site-footer";
import { SiteHeader } from "./site-header";
import { StatsBandSection } from "./stats-band";
import { TestimonialRowSection } from "./testimonial-row";
import type {
  ChromeKind,
  ChromeProps,
  RecognizeOptions,
  RecognizedSection,
  SectionContext,
  SectionKind,
  SectionProps
} from "./types";

/**
 * The registry the core renderer talks to.
 *
 * `SECTION_REGISTRY` maps a recognized kind to its component, so the core can
 * render by type without importing nine files. `SectionView` is the same thing
 * as a switch, which is what you want inside JSX because TypeScript narrows the
 * parts for you. `renderSection` is the one-call path: give it a page block and
 * it returns either a finished professional section or null, and null means
 * "paint this the generic way".
 */

export type SectionComponent<K extends SectionKind> = ComponentType<SectionProps<K>>;

export const SECTION_REGISTRY: { [K in SectionKind]: SectionComponent<K> } = {
  hero: HeroSection,
  featureGrid: FeatureGridSection,
  statsBand: StatsBandSection,
  pricingTable: PricingTableSection,
  testimonialRow: TestimonialRowSection,
  faqAccordion: FaqAccordionSection,
  ctaBand: CtaBandSection
};

/** Page chrome. Fed by `ProductSpec.nav`, so it is keyed separately. */
export const CHROME_REGISTRY: { [K in ChromeKind]: ComponentType<ChromeProps> } = {
  siteHeader: SiteHeader,
  siteFooter: SiteFooter
};

export const SECTION_KINDS: readonly SectionKind[] = Object.keys(SECTION_REGISTRY) as SectionKind[];

/** Render an already-recognized section. */
export function SectionView({ section, ctx }: { section: RecognizedSection; ctx?: SectionContext }): ReactElement {
  switch (section.kind) {
    case "hero":
      return <HeroSection section={section} ctx={ctx} />;
    case "featureGrid":
      return <FeatureGridSection section={section} ctx={ctx} />;
    case "statsBand":
      return <StatsBandSection section={section} ctx={ctx} />;
    case "pricingTable":
      return <PricingTableSection section={section} ctx={ctx} />;
    case "testimonialRow":
      return <TestimonialRowSection section={section} ctx={ctx} />;
    case "faqAccordion":
      return <FaqAccordionSection section={section} ctx={ctx} />;
    case "ctaBand":
    default:
      return <CtaBandSection section={section} ctx={ctx} />;
  }
}

/**
 * The core renderer's entry point: try to paint this block as a professional
 * section. Returns null when the shape is not one of the known compositions.
 */
export function renderSection(
  node: SpecNode,
  ctx?: SectionContext,
  opts?: RecognizeOptions
): ReactElement | null {
  const match = recognizeSection(node, opts);
  if (!match) return null;
  return <SectionView section={match} ctx={ctx} />;
}

/**
 * The header's call to action. Real products repeat the hero's primary button
 * in the header, so that is where this looks first; a button that only
 * decorates (no wire, no href) is skipped.
 */
export function headerCtaFromBlocks(blocks: SpecNode[]): ButtonNode | null {
  const hero = blocks
    .map((block, index) => recognizeSection(block, { isFirstBlock: index === 0 }))
    .find((match): match is RecognizedSection<"hero"> => match?.kind === "hero");
  if (!hero) return null;
  const buttons = hero.parts.actions.filter((node): node is ButtonNode => node.type === "button");
  return buttons.find((button) => button.wire || button.href) ?? buttons[0] ?? null;
}
