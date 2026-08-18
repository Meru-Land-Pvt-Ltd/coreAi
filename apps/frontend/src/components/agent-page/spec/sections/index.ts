/**
 * The professional sections library.
 *
 * One import for the core renderer:
 *
 *   import { renderSection, SiteHeader, SiteFooter } from "@/components/agent-page/spec/sections";
 *
 *   renderSection(block, ctx, { isFirstBlock: index === 0 }) ?? paintGenerically(block)
 *
 * `renderSection` returns null when a block is not one of the known
 * compositions, which is the signal to fall back to the generic node painter.
 */

export { CtaBandSection } from "./cta-band";
export { FaqAccordionSection } from "./faq-accordion";
export { FeatureGridSection } from "./feature-grid";
export { HeroSection } from "./hero-section";
export { PricingTableSection } from "./pricing-table";
export { StatsBandSection } from "./stats-band";
export { TestimonialRowSection } from "./testimonial-row";
export { SiteFooter } from "./site-footer";
export { SiteHeader } from "./site-header";

export {
  CHROME_REGISTRY,
  SECTION_KINDS,
  SECTION_REGISTRY,
  SectionView,
  headerCtaFromBlocks,
  renderSection
} from "./registry";
export type { SectionComponent } from "./registry";

export { pageSectionKinds, recognizePage, recognizeSection } from "./recognize";

export {
  ActionRow,
  Eyebrow,
  Headline,
  InteractiveSlot,
  Prose,
  SECTION_TEST_IDS,
  SectionIntroBlock,
  SectionShell,
  SpecButton,
  SpecImageBlock,
  SpecList,
  SpecStatBlock
} from "./primitives";

export { ICON_NAMES, SpecIcon, iconComponentFor, isKnownIconName } from "./icon";

export {
  contrastRatio,
  ensureContrast,
  mixHex,
  normalizeAccent,
  readableInk,
  relativeLuminance,
  sectionTokens,
  surfaceFor,
  withAlpha
} from "./tokens";
export type { SectionFont, SectionMode, SectionSurface, SectionTokens } from "./tokens";

export {
  CTA_BAND_EXAMPLE,
  EXAMPLE_HOME_BLOCKS,
  EXAMPLE_NAV,
  FAQ_ACCORDION_EXAMPLE,
  FEATURE_GRID_EXAMPLE,
  HERO_EXAMPLE,
  PRICING_TABLE_EXAMPLE,
  SECTION_EXAMPLES,
  STATS_BAND_EXAMPLE,
  TESTIMONIAL_ROW_EXAMPLE
} from "./examples";

export type {
  ChromeKind,
  ChromeProps,
  CtaBandParts,
  FaqAccordionParts,
  FaqItem,
  FeatureGridParts,
  FeatureItem,
  HeroParts,
  PricingPlan,
  PricingTableParts,
  RecognizeOptions,
  RecognizedSection,
  SectionContext,
  SectionIntro,
  SectionKind,
  SectionPartsMap,
  SectionProps,
  StatsBandParts,
  TestimonialRowParts
} from "./types";
