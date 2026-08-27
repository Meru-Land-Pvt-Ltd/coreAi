/**
 * LOCAL PRICES — one base price, a real number in every market.
 *
 * Apple keeps ONE base price and generates every other storefront's number by
 * applying FX, then snapping the result onto a grid of allowed price endings,
 * so a buyer sees CHF 279 or ₹12,900 and never CHF 271.43. Amazon and Google
 * Play do the same. We copy it, because the alternative — converting at
 * display time with a live rate — produces a different number on the page than
 * on the card, which is chargeback material.
 *
 * Two rules here are not cosmetic:
 *
 *  - INDIA HAS A CEILING. Under the RBI e-mandate rules a recurring charge
 *    above ₹15,000 needs fresh authentication from the customer EVERY month,
 *    which stops the subscription being automatic at all. Any INR price this
 *    file produces stays below it, and the caller is told when that clamp bit.
 *    Without this, an Indian dentist's subscription silently breaks in month
 *    two — and India is a market the founder is selling into deliberately.
 *
 *  - ZERO-DECIMAL CURRENCIES ARE NOT CENTS. Stripe takes JPY, KRW and friends
 *    as whole units, so ¥1500 is `1500`, not `150000`. Treating every currency
 *    as two decimals overcharges by a hundred times, and it is the classic
 *    money bug — it does not show up until a real customer in Tokyo pays.
 */

/** Currencies Stripe expects in whole units rather than hundredths. */
export const ZERO_DECIMAL_CURRENCIES = [
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga",
  "pyg", "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf"
] as const;

export function isZeroDecimal(currency: string): boolean {
  return (ZERO_DECIMAL_CURRENCIES as readonly string[]).includes(currency.toLowerCase());
}

/**
 * India's automatic-payment ceiling, in rupees.
 *
 * Above this, every renewal needs the customer to authenticate again.
 */
export const INR_EMANDATE_CEILING = 15_000;

export type MarketPrice = {
  currency: string;
  /** In the currency's smallest unit, ready for Stripe. */
  unitAmount: number;
  /** The same number as a person reads it, for our own pages. */
  display: string;
  /** True when a rule moved the number away from the straight conversion. */
  adjusted: boolean;
  note?: string;
};

type MarketRule = {
  currency: string;
  /** Units per 1 USD. A published starting point, refreshed on a schedule. */
  rate: number;
  /** Round to this step, then apply the ending. */
  step: number;
  /** What the price should end in, the way this market expects to see it. */
  ending: number;
  symbol: string;
  /** Where the number is grouped for reading: 12,900 vs 1,29,00. */
  locale: string;
};

/**
 * The launch grid.
 *
 * These rates are a STARTING POINT, not a live feed. That is deliberate: a
 * price that moves with the market changes what a customer is quoted between
 * looking and paying. Apple republishes on a schedule with notice, and so
 * should we — see repriceNote() for what to tell the operator.
 */
export const MARKET_RULES: MarketRule[] = [
  { currency: "usd", rate: 1, step: 1, ending: 0, symbol: "$", locale: "en-US" },
  { currency: "eur", rate: 0.92, step: 1, ending: 0, symbol: "€", locale: "de-DE" },
  { currency: "gbp", rate: 0.79, step: 1, ending: 0, symbol: "£", locale: "en-GB" },
  { currency: "chf", rate: 0.88, step: 1, ending: 0, symbol: "CHF ", locale: "de-CH" },
  { currency: "dkk", rate: 6.9, step: 100, ending: 95, symbol: "kr ", locale: "da-DK" },
  { currency: "aed", rate: 3.67, step: 1, ending: 0, symbol: "AED ", locale: "en-AE" },
  { currency: "inr", rate: 84, step: 1000, ending: 900, symbol: "₹", locale: "en-IN" },
  { currency: "cad", rate: 1.37, step: 1, ending: 0, symbol: "C$", locale: "en-CA" },
  { currency: "aud", rate: 1.52, step: 1, ending: 0, symbol: "A$", locale: "en-AU" },
  { currency: "sgd", rate: 1.34, step: 1, ending: 0, symbol: "S$", locale: "en-SG" }
];

/** Snap a converted amount onto the ending this market expects. */
function snap(value: number, rule: MarketRule): number {
  if (rule.ending > 0) {
    // e.g. ₹12,900 / kr 1,995 — land on the nearest allowed ending.
    const base = Math.round((value - rule.ending) / rule.step) * rule.step;
    return Math.max(rule.step, base) + rule.ending;
  }
  return Math.max(1, Math.round(value / rule.step) * rule.step);
}

/**
 * Turn one USD price into the number a market should actually see.
 *
 * `baseUsdCents` is what the architect set. The result is ready to hand to
 * Stripe as `currency_options[<currency>][unit_amount]`.
 */
/**
 * MARKETS PRICED ON THEIR OWN TERMS.
 *
 * Apple lets a developer set a base price and then override individual
 * storefronts, because a straight conversion is not always the right business
 * answer. India is ours: converting the $199 plan lands at about ₹16,700,
 * which is over the ₹15,000 line where RBI makes the customer re-authorise
 * every single month — the subscription stops being automatic and the market
 * is effectively closed. The founder's decision is to sell there at $149,
 * which lands at ₹12,900: comfortably under the line, and the difference
 * between selling in India and not.
 *
 * A currency listed here is priced from ITS OWN anchor, not from the base.
 */
export const MARKET_USD_ANCHORS: Record<string, number> = {
  inr: 14_900
};

export function priceForMarket(baseUsdCents: number, currency: string): MarketPrice | null {
  const rule = MARKET_RULES.find((entry) => entry.currency === currency.toLowerCase());
  if (!rule || baseUsdCents <= 0) return null;

  const anchor = MARKET_USD_ANCHORS[rule.currency];
  /* An override only ever LOWERS the price. If an architect prices their agent
     below the India anchor, India pays the lower number — a market override
     must never quietly charge someone more than the headline price.

     WHAT THIS COSTS THE ARCHITECT, said plainly: an agent priced above the
     anchor sells in India AT the anchor, and the architect's share is worked
     out from what was actually charged. A $499 agent earns them 70% of ~$153
     there, not of $499. That is the founder's decision about the Indian
     market, not an accident — but nothing on the architect's pricing screen
     tells them, and it should. */
  const effectiveUsdCents = anchor ? Math.min(anchor, baseUsdCents) : baseUsdCents;

  const whole = (effectiveUsdCents / 100) * rule.rate;
  let major = snap(whole, rule);
  let adjusted = major !== Math.round(whole);
  let note: string | undefined;

  if (rule.currency === "inr" && major >= INR_EMANDATE_CEILING) {
    /* A BACKSTOP THAT SHOULD NEVER FIRE, AND SAYS SO.
       The anchor above already holds every Indian price at ₹12,900, under the
       line, so nothing reaches here today. This used to carry a comment saying
       the opposite of what the code does — that a $499 agent must never be
       clamped, while the line above clamps it — which would have sent the next
       reader looking for a bug that is actually a decision.

       It stays as a backstop because the rupee rate is a constant in this
       file: if it moves, or the anchor is raised, a price that cannot renew on
       its own must be refused rather than sold. */
    return null;
  }

  const unitAmount = isZeroDecimal(rule.currency) ? major : major * 100;

  return {
    currency: rule.currency,
    unitAmount,
    display: `${rule.symbol}${major.toLocaleString(rule.locale)}`,
    adjusted,
    note
  };
}

/**
 * Why a market produced no price. Empty when everything converted cleanly.
 *
 * A missing currency must never be a silent gap: the operator has to know that
 * India is unreachable at this price BEFORE they launch there, not after a
 * month of failed renewals.
 */
export function marketWarnings(baseUsdCents: number): string[] {
  const warnings: string[] = [];
  const inr = MARKET_RULES.find((rule) => rule.currency === "inr");
  const inrUsd = Math.min(MARKET_USD_ANCHORS.inr ?? baseUsdCents, baseUsdCents);
  if (inr && (inrUsd / 100) * inr.rate >= INR_EMANDATE_CEILING) {
    warnings.push(
      `At this price an Indian subscription would be about ₹${Math.round((inrUsd / 100) * inr.rate).toLocaleString("en-IN")} a month, which is over India's ₹15,000 automatic-payment limit. Indian customers would have to re-authorise every single month. Price the plan lower, or sell it in India as a manual invoice.`
    );
  }
  return warnings;
}

/** Every market's number for one base price. */
export function priceGrid(baseUsdCents: number): MarketPrice[] {
  return MARKET_RULES.map((rule) => priceForMarket(baseUsdCents, rule.currency)).filter(
    (price): price is MarketPrice => price !== null
  );
}

/**
 * Payment methods worth offering in a market, beyond cards.
 *
 * This is the other half of selling abroad: an Indian debit card fails on
 * international rails constantly, which is why a Mumbai clinic cannot pay a US
 * company today. UPI is how India actually pays, and it needs the charge in
 * rupees — a converted display price is not enough.
 */
export const LOCAL_PAYMENT_METHODS: Record<string, string[]> = {
  inr: ["upi"],
  eur: ["sepa_debit", "ideal", "bancontact"],
  gbp: ["bacs_debit"],
  chf: [],
  dkk: [],
  aed: [],
  usd: [],
  cad: [],
  aud: [],
  sgd: []
};

/** What an operator should be told before republishing a grid. */
export function repriceNote(): string {
  return [
    "Prices are generated from one base price and a stored rate — never from a live rate at the moment someone looks.",
    "Republishing changes the price for NEW subscribers only. Anyone already paying keeps the number they agreed to.",
    "Give 27 days' notice on monthly plans before changing an existing subscriber's price."
  ].join(" ");
}
