import {
  isContainerNode,
  type BadgeNode,
  type ButtonNode,
  type ContainerNode,
  type HeadingNode,
  type IconNode,
  type ImageNode,
  type ListNode,
  type QuoteNode,
  type SectionNode,
  type SpecNode,
  type StatNode,
  type TextNode
} from "@coreai/shared";
import type {
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
  SectionIntro,
  SectionKind,
  StatsBandParts,
  TestimonialRowParts
} from "./types";

/**
 * The recognizer. Pure, synchronous, no React.
 *
 * It reads the SHAPE of an ordinary spec tree and decides which professional
 * composition it is. The AI is never asked to name a template — a section with
 * three columns that each hold a price, a check list and a button IS a pricing
 * table, whatever the AI called it.
 *
 * Two safety rules:
 *   - Matchers are conservative. Anything ambiguous returns null and the core
 *     renderer paints the nodes generically; a missed match costs polish, a
 *     wrong match costs correctness.
 *   - The section's `id` is only ever a TIE-BREAKER. `id: "faq"` cannot turn a
 *     pricing table into an accordion; it can only settle a shape that already
 *     reads both ways.
 */

// ---------------------------------------------------------------------------
// Tree helpers
// ---------------------------------------------------------------------------

function childrenOf(node: SpecNode): SpecNode[] {
  return isContainerNode(node) ? node.children : [];
}

/** Every descendant, document order, containers included. */
function walk(nodes: SpecNode[], out: SpecNode[] = []): SpecNode[] {
  for (const node of nodes) {
    out.push(node);
    if (isContainerNode(node)) walk(node.children, out);
  }
  return out;
}

/** Every non-container descendant, document order. */
function leavesOf(node: SpecNode): SpecNode[] {
  return walk(childrenOf(node)).filter((child) => !isContainerNode(child));
}

/** A node's own leaves, or itself when it is already a leaf. */
function flattenLeaves(node: SpecNode): SpecNode[] {
  return isContainerNode(node) ? leavesOf(node) : [node];
}

function containsNode(root: SpecNode, target: SpecNode): boolean {
  if (root === target) return true;
  return walk(childrenOf(root)).includes(target);
}

/**
 * The section's real content level. A section wrapping one stack wrapping one
 * stack is the same page as a section holding its content directly, so those
 * pass-through wrappers are peeled away. A `grid` is never peeled — a grid is
 * always a deliberate layout decision.
 */
function sectionBody(section: SectionNode): SpecNode[] {
  let list: SpecNode[] = section.children;
  for (let guard = 0; guard < 6; guard += 1) {
    if (list.length !== 1) break;
    const only = list[0];
    if (!isContainerNode(only) || only.type === "grid") break;
    list = only.children;
  }
  return list;
}

/** First grid/row in the tree that holds at least two container children. */
function findCardContainer(section: SectionNode): ContainerNode | null {
  const queue: SpecNode[] = [...section.children];
  while (queue.length > 0) {
    const node = queue.shift();
    if (!node) break;
    if (isContainerNode(node)) {
      const containerKids = node.children.filter(isContainerNode);
      if ((node.type === "grid" || node.type === "row") && containerKids.length >= 2) {
        return node;
      }
      queue.push(...node.children);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Node predicates
// ---------------------------------------------------------------------------

const isHeading = (n: SpecNode): n is HeadingNode => n.type === "heading";
const isText = (n: SpecNode): n is TextNode => n.type === "text";
const isBadge = (n: SpecNode): n is BadgeNode => n.type === "badge";
const isList = (n: SpecNode): n is ListNode => n.type === "list";
const isImage = (n: SpecNode): n is ImageNode => n.type === "image";
const isIcon = (n: SpecNode): n is IconNode => n.type === "icon";
const isQuote = (n: SpecNode): n is QuoteNode => n.type === "quote";
const isStat = (n: SpecNode): n is StatNode => n.type === "stat";
const isButton = (n: SpecNode): n is ButtonNode => n.type === "button";

const INTERACTIVE_TYPES = new Set(["button", "input", "upload", "choice"]);
const LIVE_TYPES = new Set(["result", "history"]);

const isInteractive = (n: SpecNode): boolean => INTERACTIVE_TYPES.has(n.type);
const isLive = (n: SpecNode): boolean => LIVE_TYPES.has(n.type);

function idHint(node: SpecNode, words: string[]): boolean {
  const id = String(node.id ?? "").toLowerCase();
  if (!id) return false;
  return words.some((word) => id.includes(word));
}

function endsWithQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim());
}

const PRICE_PATTERN =
  /(^|\s)(free|custom|[$€£₹¥]\s?\d|\d+\s?(usd|eur|gbp|inr|aed|cad|aud))|\d\s*\/\s*(mo|month|yr|year|seat|user)/i;

function looksLikePrice(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > 40) return false;
  return PRICE_PATTERN.test(trimmed);
}

const PERIOD_PATTERN = /(per|\/)\s*(month|mo|year|yr|seat|user|week|day)|monthly|yearly|annually|billed/i;

function clampColumns(count: number): 2 | 3 | 4 {
  if (count <= 2) return 2;
  if (count === 4) return 4;
  return 3;
}

// ---------------------------------------------------------------------------
// Intro extraction — the badge / headline / one-line-of-copy every section has
// ---------------------------------------------------------------------------

function pickIntro(
  candidates: SpecNode[],
  opts?: { skipQuestionHeadings?: boolean }
): { intro: SectionIntro; used: Set<SpecNode> } {
  const intro: SectionIntro = {};
  const used = new Set<SpecNode>();
  for (const node of candidates) {
    if (isBadge(node) && !intro.eyebrow && !intro.heading) {
      intro.eyebrow = node;
      used.add(node);
      continue;
    }
    if (isHeading(node) && !intro.heading) {
      if (opts?.skipQuestionHeadings && endsWithQuestion(node.text)) continue;
      intro.heading = node;
      used.add(node);
      continue;
    }
    if (isText(node) && intro.heading && !intro.subtext) {
      intro.subtext = node;
      used.add(node);
    }
  }
  return { intro, used };
}

/** Top-level leaves that sit OUTSIDE the card container — i.e. the section's own intro. */
function outerLeaves(body: SpecNode[], container: SpecNode | null): SpecNode[] {
  const out: SpecNode[] = [];
  for (const node of body) {
    if (container && (node === container || containsNode(node, container))) continue;
    out.push(...flattenLeaves(node));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matchers. Order matters — see `recognizeSection`.
// ---------------------------------------------------------------------------

function matchHero(section: SectionNode, opts: RecognizeOptions): RecognizedSection<"hero"> | null {
  const leaves = leavesOf(section);
  const headings = leaves.filter(isHeading);
  if (headings.length === 0) return null;

  const hasGrid = walk(section.children).some((node) => node.type === "grid");
  const bigHeading = headings.find((heading) => heading.level === 1);
  const hinted = idHint(section, ["hero", "masthead", "banner", "headline"]);

  let confidence = 0;
  if (bigHeading) confidence = 92;
  else if (hinted) confidence = 78;
  else if (opts.isFirstBlock && !hasGrid && headings.length === 1) confidence = 64;
  if (confidence === 0) return null;

  const heading = bigHeading ?? headings[0];
  const actions: SpecNode[] = [];
  const live: SpecNode[] = [];
  const parts: HeroParts = { heading, actions, live };
  let seenAction = false;

  for (const node of leaves) {
    if (node === heading) continue;
    if (isBadge(node)) {
      if (!parts.eyebrow) parts.eyebrow = node;
      continue;
    }
    if (isText(node)) {
      if (!seenAction && !parts.subtext) parts.subtext = node;
      else if (seenAction && !parts.note) parts.note = node;
      continue;
    }
    if (isList(node)) {
      if (!parts.bullets) parts.bullets = node;
      continue;
    }
    if (isImage(node)) {
      if (!parts.media) parts.media = node;
      continue;
    }
    if (isInteractive(node)) {
      actions.push(node);
      seenAction = true;
      continue;
    }
    if (isLive(node)) live.push(node);
  }

  const substantial =
    Boolean(parts.subtext) || actions.length > 0 || live.length > 0 || Boolean(parts.media);
  if (!substantial) return null;

  return { kind: "hero", node: section, parts, confidence };
}

function matchPricingTable(section: SectionNode, body: SpecNode[]): RecognizedSection<"pricingTable"> | null {
  const container = findCardContainer(section);
  if (!container) return null;
  const cards = container.children.filter(isContainerNode);
  if (cards.length < 2 || cards.length > 4) return null;

  // Every column must read as a plan: something to buy (a button) plus a body
  // of terms (a check list, a couple of lines, or a price stat).
  const planShaped = cards.every((card) => {
    const leaves = leavesOf(card);
    const hasCta = leaves.some(isButton);
    const hasTerms =
      leaves.some(isList) || leaves.some(isStat) || leaves.filter(isText).length >= 2;
    return hasCta && hasTerms;
  });
  if (!planShaped) return null;

  const cardsWithPrice = cards.filter((card) => {
    const leaves = leavesOf(card);
    return leaves.some(isStat) || leaves.filter(isText).some((t) => looksLikePrice(t.text));
  });
  const hinted = idHint(section, ["pricing", "price", "plan", "tier", "package"]);
  if (!hinted && cardsWithPrice.length * 2 < cards.length) return null;

  const plans: PricingPlan[] = cards.map((card) => {
    const leaves = leavesOf(card);
    const heading = leaves.find(isHeading);
    const badge = leaves.find(isBadge);
    const stat = leaves.find(isStat);
    const texts = leaves.filter(isText);
    const buttons = leaves.filter(isButton);
    const list = leaves.find(isList);

    const priceText = stat ? undefined : texts.find((t) => looksLikePrice(t.text));
    const price = stat ? stat.value : priceText?.text;
    const periodText = texts.find(
      (t) => t !== priceText && t.text.length <= 40 && PERIOD_PATTERN.test(t.text)
    );
    const period = stat ? (stat.label || undefined) : periodText?.text;
    const description = texts.find((t) => t !== priceText && t !== periodText)?.text;

    const features = list
      ? [...list.items]
      : texts
          .filter((t) => t !== priceText && t !== periodText && t.text !== description)
          .map((t) => t.text);

    return {
      id: card.id,
      name: heading?.text ?? badge?.text ?? "Plan",
      price,
      period,
      description,
      badge,
      features,
      cta: buttons[buttons.length - 1],
      highlighted: false
    };
  });

  const highlightIndex = pickHighlight(plans);
  if (highlightIndex >= 0) plans[highlightIndex].highlighted = true;

  const outer = outerLeaves(body, container);
  const { intro, used } = pickIntro(outer);
  const note = outer.filter(isText).find((t) => !used.has(t));

  const parts: PricingTableParts = { ...intro, plans, note };
  return { kind: "pricingTable", node: section, parts, confidence: hinted ? 95 : 85 };
}

/** Which column gets the ring: an explicit badge, then a lone primary CTA, then the middle of three. */
function pickHighlight(plans: PricingPlan[]): number {
  const badged = plans.findIndex((plan) => Boolean(plan.badge));
  if (badged >= 0) return badged;
  const primaries = plans
    .map((plan, index) => (plan.cta?.variant === "primary" ? index : -1))
    .filter((index) => index >= 0);
  if (primaries.length === 1) return primaries[0];
  if (plans.length === 3) return 1;
  return -1;
}

function matchTestimonialRow(
  section: SectionNode,
  body: SpecNode[]
): RecognizedSection<"testimonialRow"> | null {
  const quotes = leavesOf(section).filter(isQuote);
  const hinted = idHint(section, ["testimonial", "review", "quote", "customer", "love"]);
  if (quotes.length === 0) return null;
  if (quotes.length < 2 && !hinted) return null;

  const quoteSet = new Set<SpecNode>(quotes);
  const outer = body
    .flatMap(flattenLeaves)
    .filter((node) => !quoteSet.has(node));
  const { intro } = pickIntro(outer);

  const parts: TestimonialRowParts = { ...intro, quotes };
  return { kind: "testimonialRow", node: section, parts, confidence: hinted ? 95 : 88 };
}

/** Pairs where each child container holds one question heading and its answer. */
function pairsFromContainers(nodes: SpecNode[]): FaqItem[] {
  const items: FaqItem[] = [];
  for (const node of nodes) {
    if (!isContainerNode(node)) continue;
    const leaves = leavesOf(node);
    if (leaves.length === 0 || leaves.length > 4) continue;
    const heading = leaves.find(isHeading);
    const texts = leaves.filter(isText);
    if (!heading || texts.length === 0) continue;
    if (leaves.some((leaf) => isInteractive(leaf) || isStat(leaf) || isImage(leaf))) continue;
    items.push({
      id: node.id,
      question: heading.text,
      answer: texts.map((t) => t.text).join("\n\n")
    });
  }
  return items;
}

/** Pairs written flat: heading, text, heading, text… */
function pairsFromSequence(nodes: SpecNode[]): { head: HeadingNode; body: TextNode }[] {
  const pairs: { head: HeadingNode; body: TextNode }[] = [];
  let index = 0;
  while (index < nodes.length - 1) {
    const head = nodes[index];
    const body = nodes[index + 1];
    if (isHeading(head) && isText(body)) {
      pairs.push({ head, body });
      index += 2;
      continue;
    }
    index += 1;
  }
  return pairs;
}

function pairToItem(pair: { head: HeadingNode; body: TextNode }): FaqItem {
  return { id: pair.head.id, question: pair.head.text, answer: pair.body.text };
}

function matchFaqAccordion(
  section: SectionNode,
  body: SpecNode[]
): RecognizedSection<"faqAccordion"> | null {
  const hinted = idHint(section, ["faq", "question", "answer", "help", "support"]);

  // Prefer the deepest container that actually holds pairs, so a section >
  // stack > [item, item, item] is found as easily as a flat body.
  const candidates: { parent: SpecNode | null; items: FaqItem[] }[] = [];
  candidates.push({ parent: null, items: pairsFromContainers(body) });
  for (const node of walk(section.children)) {
    if (!isContainerNode(node)) continue;
    const items = pairsFromContainers(node.children);
    if (items.length > 0) candidates.push({ parent: node, items });
  }

  let best = candidates.reduce(
    (acc, candidate) => (candidate.items.length > acc.items.length ? candidate : acc),
    { parent: null as SpecNode | null, items: [] as FaqItem[] }
  );

  let intro: SectionIntro = {};
  let flat = false;
  if (best.items.length < 2) {
    // Flat form. The first heading/text pair is usually the section's own
    // title, so promote it out of the list when the rest are clearly questions.
    const leaves = body.flatMap(flattenLeaves);
    const sequence = pairsFromSequence(leaves);
    if (sequence.length >= 2) {
      flat = true;
      const [first, ...rest] = sequence;
      const restAreQuestions =
        rest.length >= 2 &&
        rest.filter((pair) => endsWithQuestion(pair.head.text)).length * 2 >= rest.length;
      if (!endsWithQuestion(first.head.text) && restAreQuestions) {
        best = { parent: null, items: rest.map(pairToItem) };
        intro = {
          eyebrow: leaves.filter(isBadge)[0],
          heading: first.head,
          subtext: first.body
        };
      } else {
        best = { parent: null, items: sequence.map(pairToItem) };
        const paired = new Set<SpecNode>(sequence.flatMap((pair) => [pair.head, pair.body]));
        intro = pickIntro(
          leaves.filter((leaf) => !paired.has(leaf)),
          { skipQuestionHeadings: true }
        ).intro;
      }
    }
  } else {
    const outer = outerLeaves(body, best.parent);
    intro = pickIntro(outer, { skipQuestionHeadings: true }).intro;
  }

  if (best.items.length < 2) return null;

  let score = 0;
  if (hinted) score += 2;
  const questionMarks = best.items.filter((item) => endsWithQuestion(item.question)).length;
  if (questionMarks * 2 >= best.items.length) score += 2;
  const parentIsGrid = best.parent !== null && best.parent.type === "grid";
  if (parentIsGrid) score -= 3;
  else if (!flat) score += 1;
  if (score < 2) return null;

  const parts: FaqAccordionParts = { ...intro, items: best.items };
  return { kind: "faqAccordion", node: section, parts, confidence: Math.min(95, 60 + score * 10) };
}

function matchStatsBand(section: SectionNode, body: SpecNode[]): RecognizedSection<"statsBand"> | null {
  const stats = leavesOf(section).filter(isStat);
  if (stats.length < 2) return null;
  const statSet = new Set<SpecNode>(stats);
  const outer = body.flatMap(flattenLeaves).filter((node) => !statSet.has(node));
  const { intro } = pickIntro(outer);
  const parts: StatsBandParts = { ...intro, stats };
  const hinted = idHint(section, ["stat", "metric", "number", "proof", "result"]);
  return { kind: "statsBand", node: section, parts, confidence: hinted ? 95 : 86 };
}

function matchFeatureGrid(
  section: SectionNode,
  body: SpecNode[]
): RecognizedSection<"featureGrid"> | null {
  const container = findCardContainer(section);
  if (!container) return null;
  const cards = container.children.filter(isContainerNode);
  if (cards.length < 2) return null;

  const cardIsFeature = (card: ContainerNode) => {
    const leaves = leavesOf(card);
    if (leaves.length === 0) return false;
    if (leaves.some(isQuote) || leaves.some(isStat)) return false;
    return leaves.some(isHeading) || leaves.some(isIcon);
  };
  if (!cards.every(cardIsFeature)) return null;

  const items: FeatureItem[] = cards.map((card) => {
    const leaves = leavesOf(card);
    return {
      id: card.id,
      icon: leaves.find(isIcon),
      badge: leaves.find(isBadge),
      title: leaves.find(isHeading),
      body: leaves.find(isText),
      bullets: leaves.find(isList),
      action: leaves.find(isButton)
    };
  });

  const columns =
    container.type === "grid" && container.columns
      ? container.columns
      : clampColumns(cards.length);

  const outer = outerLeaves(body, container);
  const { intro } = pickIntro(outer);
  const parts: FeatureGridParts = { ...intro, columns, items };
  const hinted = idHint(section, ["feature", "benefit", "how", "capab", "what"]);
  return { kind: "featureGrid", node: section, parts, confidence: hinted ? 92 : 82 };
}

function matchCtaBand(section: SectionNode): RecognizedSection<"ctaBand"> | null {
  const leaves = leavesOf(section);
  if (leaves.length === 0 || leaves.length > 8) return null;
  if (!leaves.some(isInteractive)) return null;
  // A section that shows an answer is the working product, not a closing ask.
  // The CTA band has no place to put a result, so recognizing one here would
  // silently drop the most important element on the page. Declining sends it
  // to the generic painter, which renders every socket it is given.
  if (leaves.some(isLive)) return null;
  if (walk(section.children).some((node) => node.type === "grid")) return null;
  if (leaves.some((node) => isQuote(node) || isStat(node) || isImage(node))) return null;

  const headings = leaves.filter(isHeading);
  if (headings.length > 1) return null;
  if (headings[0]?.level === 1) return null;

  const actions = leaves.filter(isInteractive);
  const texts = leaves.filter(isText);
  const parts: CtaBandParts = {
    eyebrow: leaves.find(isBadge),
    heading: headings[0],
    subtext: texts[0],
    actions,
    note: texts[1]
  };
  const hinted = idHint(section, ["cta", "signup", "sign-up", "start", "getstarted", "get-started"]);
  return { kind: "ctaBand", node: section, parts, confidence: hinted ? 90 : 72 };
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/**
 * A container that is not a `section` still gets recognized — the AI often
 * writes a bare grid as a page block. It is wrapped in a synthetic section so
 * every matcher sees the same shape.
 */
function asSectionNode(node: SpecNode): SectionNode | null {
  if (node.type === "section") return node;
  if (!isContainerNode(node)) return null;
  return { id: node.id, type: "section", children: [node], style: node.style };
}

/**
 * Recognize one page block. Returns null when the shape is not a known
 * composition — the core renderer then paints the nodes generically.
 */
export function recognizeSection(
  node: SpecNode,
  opts: RecognizeOptions = {}
): RecognizedSection | null {
  const section = asSectionNode(node);
  if (!section) return null;
  const body = sectionBody(section);
  if (body.length === 0) return null;

  return (
    matchHero(section, opts) ??
    matchPricingTable(section, body) ??
    matchTestimonialRow(section, body) ??
    matchFaqAccordion(section, body) ??
    matchStatsBand(section, body) ??
    matchFeatureGrid(section, body) ??
    matchCtaBand(section)
  );
}

/** Recognize a whole page's blocks; the first block gets the hero benefit of the doubt. */
export function recognizePage(blocks: SpecNode[]): (RecognizedSection | null)[] {
  return blocks.map((block, index) => recognizeSection(block, { isFirstBlock: index === 0 }));
}

/** Debug helper: which kinds a page resolves to, in order. */
export function pageSectionKinds(blocks: SpecNode[]): (SectionKind | null)[] {
  return recognizePage(blocks).map((match) => match?.kind ?? null);
}

export const __recognizeInternals = {
  sectionBody,
  findCardContainer,
  leavesOf,
  looksLikePrice,
  pickHighlight
};
