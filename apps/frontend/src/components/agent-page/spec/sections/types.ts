import type { ReactNode } from "react";
import type {
  BadgeNode,
  ButtonNode,
  HeadingNode,
  IconNode,
  ImageNode,
  ListNode,
  ProductNav,
  QuoteNode,
  SectionNode,
  SpecNode,
  StatNode,
  TextNode
} from "@coreai/shared";
import type { SectionFont, SectionMode } from "./tokens";

/**
 * The professional sections library.
 *
 * Doctrine: the AI writes an ORDINARY spec tree — a section holding a badge, a
 * headline, some copy and two buttons. It does not name a template and it does
 * not know these components exist. The recognizer reads the shape of the tree
 * and, when it matches a known composition, hands it to a hand-built section
 * that is guaranteed to look like a real SaaS page at 375px, 768px and 1440px.
 *
 * Nothing is lost when a tree is not recognized: `recognizeSection` returns
 * null and the core renderer paints the nodes generically.
 */

/** Body compositions recognized from a `section` spec node. */
export type SectionKind =
  | "hero"
  | "featureGrid"
  | "statsBand"
  | "pricingTable"
  | "testimonialRow"
  | "faqAccordion"
  | "ctaBand";

/** Page chrome, driven by `ProductSpec.nav` rather than by a spec node. */
export type ChromeKind = "siteHeader" | "siteFooter";

/**
 * What a section needs from the core renderer.
 *
 * `renderNode` is the seam that keeps this library pure: only the core knows
 * how to run the agent's graph, so any node carrying a wire is handed back to
 * it. When it returns nothing (or is absent, as in tests and previews) the
 * section paints its own static, non-functional version so the layout is still
 * correct and still beautiful.
 */
export type SectionContext = {
  accent?: string | null;
  mode?: SectionMode | null;
  font?: SectionFont | null;
  /** Paint a wired node. Return null/undefined to accept the static fallback. */
  renderNode?: (node: SpecNode) => ReactNode;
  /** Turn a nav link's `pageId` into an href. Defaults to "#". */
  hrefForPage?: (pageId: string) => string;
  /** Client-side page switch. When present, nav links call this instead of navigating. */
  onNavigate?: (pageId: string) => void;
  /** Highlights the current link in the header. */
  currentPageId?: string;
};

/** Header/footer props — chrome is fed by nav, not by a section node. */
export type ChromeProps = {
  nav: ProductNav;
  ctx?: SectionContext;
  /** A CTA for the header's right side. Usually the home hero's primary button. */
  cta?: ButtonNode | null;
};

// ---------------------------------------------------------------------------
// Extracted parts. Each section receives its content already pulled apart, so
// the component is pure layout and never re-walks the tree.
// ---------------------------------------------------------------------------

/** The lead-in every section shares: small badge, headline, one line of copy. */
export type SectionIntro = {
  eyebrow?: BadgeNode;
  heading?: HeadingNode;
  subtext?: TextNode;
};

export type HeroParts = SectionIntro & {
  heading: HeadingNode;
  bullets?: ListNode;
  /** Buttons, inputs, uploads and choices, in spec order. */
  actions: SpecNode[];
  /** The product shot, when the AI supplied one. */
  media?: ImageNode;
  /** Result/history nodes — the working product living inside the hero. */
  live: SpecNode[];
  /** Small print under the buttons. */
  note?: TextNode;
};

export type FeatureItem = {
  id: string;
  icon?: IconNode;
  badge?: BadgeNode;
  title?: HeadingNode;
  body?: TextNode;
  bullets?: ListNode;
  action?: ButtonNode;
};

export type FeatureGridParts = SectionIntro & {
  columns: 2 | 3 | 4;
  items: FeatureItem[];
};

export type StatsBandParts = SectionIntro & {
  stats: StatNode[];
};

export type PricingPlan = {
  id: string;
  name: string;
  /** "$29", "Free" — whatever the AI wrote, verbatim. */
  price?: string;
  /** "per month", "billed yearly". */
  period?: string;
  description?: string;
  badge?: BadgeNode;
  features: string[];
  cta?: ButtonNode;
  highlighted: boolean;
};

export type PricingTableParts = SectionIntro & {
  plans: PricingPlan[];
  /** Reassurance line under the table ("Cancel any time."). */
  note?: TextNode;
};

export type TestimonialRowParts = SectionIntro & {
  quotes: QuoteNode[];
};

export type FaqItem = { id: string; question: string; answer: string };

export type FaqAccordionParts = SectionIntro & {
  items: FaqItem[];
};

export type CtaBandParts = SectionIntro & {
  actions: SpecNode[];
  note?: TextNode;
};

export type SectionPartsMap = {
  hero: HeroParts;
  featureGrid: FeatureGridParts;
  statsBand: StatsBandParts;
  pricingTable: PricingTableParts;
  testimonialRow: TestimonialRowParts;
  faqAccordion: FaqAccordionParts;
  ctaBand: CtaBandParts;
};

/** What `recognizeSection` returns: the kind, the original node, the parts. */
export type RecognizedSection<K extends SectionKind = SectionKind> = {
  [Kind in K]: {
    kind: Kind;
    node: SectionNode;
    parts: SectionPartsMap[Kind];
    /** 0-100. How sure the matcher is. Useful for debugging a spec, not for rendering. */
    confidence: number;
  };
}[K];

/** Props every recognized-section component takes. */
export type SectionProps<K extends SectionKind = SectionKind> = {
  section: RecognizedSection<K>;
  ctx?: SectionContext;
};

/** Hints the core renderer can pass so ambiguous shapes resolve correctly. */
export type RecognizeOptions = {
  /** True for a page's first block — makes a headline-led section a hero. */
  isFirstBlock?: boolean;
};
