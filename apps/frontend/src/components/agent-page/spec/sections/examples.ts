import type { ProductNav, SectionNode } from "@coreai/shared";
import type { SectionKind } from "./types";

/**
 * Canonical shapes — one ordinary spec tree per professional composition.
 *
 * These are the trees the recognizer is built around. They are ordinary spec
 * nodes: nothing here names a template, sets a flag, or asks for a component.
 * They exist so (a) the architect prompt can show the AI what "good" looks
 * like, (b) the builder preview has something real to draw, and (c) the tests
 * assert against the same trees the AI is being taught to write.
 *
 * Note the two normalized field names: a button's look is `variant` and a
 * list's bullet is `listStyle`. The AI may write `style:"primary"` /
 * `style:"check"` — the shared parser lifts those into these fields before a
 * spec ever reaches the renderer.
 */

export const HERO_EXAMPLE: SectionNode = {
  id: "hero",
  type: "section",
  padding: "xl",
  background: "gradient",
  children: [
    {
      id: "hero-stack",
      type: "stack",
      gap: "md",
      children: [
        { id: "hero-badge", type: "badge", text: "New", tone: "accent" },
        {
          id: "hero-title",
          type: "heading",
          level: 1,
          text: "A month of social posts in ten minutes"
        },
        {
          id: "hero-sub",
          type: "text",
          size: "lg",
          text: "Tell it about your business once. It writes the posts. You pick the ones you like."
        },
        {
          id: "hero-input",
          type: "input",
          placeholder: "What does your business do?",
          wire: { role: "input" }
        },
        {
          id: "hero-row",
          type: "row",
          gap: "sm",
          children: [
            { id: "hero-go", type: "button", label: "Write my posts", variant: "primary", wire: { role: "action" } },
            { id: "hero-example", type: "button", label: "See an example", variant: "secondary", href: "#features" }
          ]
        },
        { id: "hero-note", type: "text", size: "sm", text: "No card needed to try it." },
        { id: "hero-result", type: "result", variant: "auto", wire: { role: "output" } }
      ]
    }
  ]
};

export const FEATURE_GRID_EXAMPLE: SectionNode = {
  id: "features",
  type: "section",
  padding: "lg",
  children: [
    { id: "features-badge", type: "badge", text: "What you get", tone: "neutral" },
    { id: "features-title", type: "heading", level: 2, text: "Everything you need to sound like you" },
    {
      id: "features-sub",
      type: "text",
      text: "Set it up once, then it keeps working while you get on with the job."
    },
    {
      id: "features-grid",
      type: "grid",
      columns: 3,
      gap: "md",
      children: [
        {
          id: "feature-voice",
          type: "stack",
          gap: "sm",
          children: [
            { id: "feature-voice-icon", type: "icon", name: "sparkles" },
            { id: "feature-voice-title", type: "heading", level: 3, text: "Sounds like you" },
            { id: "feature-voice-body", type: "text", size: "sm", text: "It learns your words from a few examples and sticks to them." }
          ]
        },
        {
          id: "feature-speed",
          type: "stack",
          gap: "sm",
          children: [
            { id: "feature-speed-icon", type: "icon", name: "zap" },
            { id: "feature-speed-title", type: "heading", level: 3, text: "Ready in seconds" },
            { id: "feature-speed-body", type: "text", size: "sm", text: "Ask once and a full set of posts comes back straight away." }
          ]
        },
        {
          id: "feature-safe",
          type: "stack",
          gap: "sm",
          children: [
            { id: "feature-safe-icon", type: "icon", name: "shieldcheck" },
            { id: "feature-safe-title", type: "heading", level: 3, text: "Your words stay yours" },
            { id: "feature-safe-body", type: "text", size: "sm", text: "Nothing you write is shared with anyone else." }
          ]
        }
      ]
    }
  ]
};

export const STATS_BAND_EXAMPLE: SectionNode = {
  id: "stats",
  type: "section",
  padding: "md",
  background: "tint",
  children: [
    {
      id: "stats-row",
      type: "grid",
      columns: 3,
      gap: "lg",
      children: [
        { id: "stat-posts", type: "stat", label: "Posts written", value: "1.2M" },
        { id: "stat-time", type: "stat", label: "Average time saved a week", value: "6 hours" },
        { id: "stat-rating", type: "stat", label: "Customer rating", value: "4.9/5" }
      ]
    }
  ]
};

export const PRICING_TABLE_EXAMPLE: SectionNode = {
  id: "pricing",
  type: "section",
  padding: "lg",
  children: [
    { id: "pricing-title", type: "heading", level: 2, text: "Simple pricing" },
    { id: "pricing-sub", type: "text", text: "Start free. Move up when it is paying for itself." },
    {
      id: "pricing-grid",
      type: "grid",
      columns: 3,
      gap: "md",
      children: [
        {
          id: "plan-free",
          type: "stack",
          gap: "sm",
          children: [
            { id: "plan-free-name", type: "heading", level: 3, text: "Starter" },
            { id: "plan-free-price", type: "text", text: "Free" },
            { id: "plan-free-desc", type: "text", size: "sm", text: "Enough to see if it works for you." },
            {
              id: "plan-free-list",
              type: "list",
              listStyle: "check",
              items: ["10 posts a month", "One brand voice", "Email support"]
            },
            { id: "plan-free-cta", type: "button", label: "Start free", variant: "secondary", href: "#start" }
          ]
        },
        {
          id: "plan-pro",
          type: "stack",
          gap: "sm",
          children: [
            { id: "plan-pro-badge", type: "badge", text: "Most popular", tone: "accent" },
            { id: "plan-pro-name", type: "heading", level: 3, text: "Growing" },
            { id: "plan-pro-price", type: "text", text: "$29" },
            { id: "plan-pro-period", type: "text", size: "sm", text: "per month" },
            { id: "plan-pro-desc", type: "text", size: "sm", text: "For a business posting every week." },
            {
              id: "plan-pro-list",
              type: "list",
              listStyle: "check",
              items: ["Unlimited posts", "Three brand voices", "Image ideas", "Priority support"]
            },
            { id: "plan-pro-cta", type: "button", label: "Choose Growing", variant: "primary", href: "#start" }
          ]
        },
        {
          id: "plan-team",
          type: "stack",
          gap: "sm",
          children: [
            { id: "plan-team-name", type: "heading", level: 3, text: "Team" },
            { id: "plan-team-price", type: "text", text: "$79" },
            { id: "plan-team-period", type: "text", size: "sm", text: "per month" },
            { id: "plan-team-desc", type: "text", size: "sm", text: "For a few people working together." },
            {
              id: "plan-team-list",
              type: "list",
              listStyle: "check",
              items: ["Everything in Growing", "Five seats", "Shared library", "Phone support"]
            },
            { id: "plan-team-cta", type: "button", label: "Choose Team", variant: "secondary", href: "#start" }
          ]
        }
      ]
    },
    { id: "pricing-note", type: "text", size: "sm", text: "Cancel any time. No long contract." }
  ]
};

export const TESTIMONIAL_ROW_EXAMPLE: SectionNode = {
  id: "testimonials",
  type: "section",
  padding: "lg",
  background: "tint",
  children: [
    { id: "testimonials-title", type: "heading", level: 2, text: "What people say" },
    {
      id: "testimonials-grid",
      type: "grid",
      columns: 3,
      gap: "md",
      children: [
        {
          id: "quote-1-wrap",
          type: "stack",
          children: [
            {
              id: "quote-1",
              type: "quote",
              text: "I used to lose a whole Sunday to this. Now it is done before my coffee.",
              author: "Priya Raman",
              role: "Owner, Sunrise Bakery"
            }
          ]
        },
        {
          id: "quote-2-wrap",
          type: "stack",
          children: [
            {
              id: "quote-2",
              type: "quote",
              text: "It actually sounds like us. That was the part I did not expect.",
              author: "Dan Whitlock",
              role: "Marketing lead, Northsea Gear"
            }
          ]
        },
        {
          id: "quote-3-wrap",
          type: "stack",
          children: [
            {
              id: "quote-3",
              type: "quote",
              text: "Set it up in an afternoon and never touched it again.",
              author: "Amara Osei",
              role: "Founder, Little Green Studio"
            }
          ]
        }
      ]
    }
  ]
};

export const FAQ_ACCORDION_EXAMPLE: SectionNode = {
  id: "faq",
  type: "section",
  padding: "lg",
  children: [
    { id: "faq-title", type: "heading", level: 2, text: "Common questions" },
    {
      id: "faq-list",
      type: "stack",
      gap: "sm",
      children: [
        {
          id: "faq-1",
          type: "stack",
          children: [
            { id: "faq-1-q", type: "heading", level: 3, text: "Do I need to know anything technical?" },
            { id: "faq-1-a", type: "text", text: "No. You answer a few questions in plain English and it does the rest." }
          ]
        },
        {
          id: "faq-2",
          type: "stack",
          children: [
            { id: "faq-2-q", type: "heading", level: 3, text: "Can I change the words it writes?" },
            { id: "faq-2-a", type: "text", text: "Yes. Everything it gives you can be edited before you post it." }
          ]
        },
        {
          id: "faq-3",
          type: "stack",
          children: [
            { id: "faq-3-q", type: "heading", level: 3, text: "What happens to my information?" },
            { id: "faq-3-a", type: "text", text: "It stays in your account. It is never sold and never shown to other customers." }
          ]
        }
      ]
    }
  ]
};

export const CTA_BAND_EXAMPLE: SectionNode = {
  id: "cta",
  type: "section",
  padding: "lg",
  background: "dark",
  children: [
    { id: "cta-title", type: "heading", level: 2, text: "Try it on your next post" },
    { id: "cta-sub", type: "text", text: "It takes about a minute to see whether it fits how you write." },
    { id: "cta-go", type: "button", label: "Start writing", variant: "primary", wire: { role: "action" } },
    { id: "cta-note", type: "text", size: "sm", text: "No card needed." }
  ]
};

export const SECTION_EXAMPLES: Record<SectionKind, SectionNode> = {
  hero: HERO_EXAMPLE,
  featureGrid: FEATURE_GRID_EXAMPLE,
  statsBand: STATS_BAND_EXAMPLE,
  pricingTable: PRICING_TABLE_EXAMPLE,
  testimonialRow: TESTIMONIAL_ROW_EXAMPLE,
  faqAccordion: FAQ_ACCORDION_EXAMPLE,
  ctaBand: CTA_BAND_EXAMPLE
};

/** A full home page in canonical order. */
export const EXAMPLE_HOME_BLOCKS: SectionNode[] = [
  HERO_EXAMPLE,
  STATS_BAND_EXAMPLE,
  FEATURE_GRID_EXAMPLE,
  TESTIMONIAL_ROW_EXAMPLE,
  PRICING_TABLE_EXAMPLE,
  FAQ_ACCORDION_EXAMPLE,
  CTA_BAND_EXAMPLE
];

export const EXAMPLE_NAV: ProductNav = {
  brand: { text: "Postcraft" },
  links: [
    { label: "Home", pageId: "home" },
    { label: "Pricing", pageId: "pricing" },
    { label: "About", pageId: "about" }
  ],
  footerLinks: [
    { label: "Home", pageId: "home" },
    { label: "Pricing", pageId: "pricing" },
    { label: "About", pageId: "about" },
    { label: "Contact", pageId: "contact" },
    { label: "Privacy", pageId: "privacy" },
    { label: "Terms", pageId: "terms" }
  ],
  footerNote: "Made for small businesses that would rather be doing the work than writing about it."
};
