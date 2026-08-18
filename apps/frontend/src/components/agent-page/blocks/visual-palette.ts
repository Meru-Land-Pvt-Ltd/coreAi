/**
 * The Visual Results palette — every colour a stat card, chart or table paints,
 * derived from ONE input: the page accent.
 *
 * Two audiences share this component, so every neutral is written as
 * `var(--spec-*, <fallback>)`:
 *
 *   - inside a generated product page the Product Spec theme has already put
 *     `--spec-ink`, `--spec-card`, `--spec-border`… on the page root, so the
 *     cards pick up that page's light / dark / warm ramp for free;
 *   - inside the classic Result Viewer no such variables exist, and the
 *     fallback (a calm slate ramp) is what paints.
 *
 * Accent-derived colours cannot be a `var()` — an SVG gradient stop needs a
 * real colour — so those are computed here from the accent hex.
 */

export type VisualSurface = "base" | "dark";

// ---------------------------------------------------------------------------
// Colour maths. Small on purpose: parse, mix, and a legibility walk.
// ---------------------------------------------------------------------------

type Rgb = { r: number; g: number; b: number };

const HEX_RE = /^#?([0-9a-f]{6})$/i;
const FALLBACK_ACCENT: Rgb = { r: 245, g: 158, b: 11 }; // Triven amber
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const NEAR_BLACK: Rgb = { r: 12, g: 15, b: 22 };

function parseHex(value: string | null | undefined): Rgb | null {
  const match = HEX_RE.exec((value ?? "").trim());
  if (!match) return null;
  const int = Number.parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(rgb: Rgb): string {
  const part = (value: number) => clamp255(value).toString(16).padStart(2, "0");
  return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
}

function rgba(rgb: Rgb, alpha: number): string {
  return `rgba(${clamp255(rgb.r)}, ${clamp255(rgb.g)}, ${clamp255(rgb.b)}, ${Math.max(
    0,
    Math.min(1, alpha)
  )})`;
}

function mix(from: Rgb, to: Rgb, amount: number): Rgb {
  const t = Math.max(0, Math.min(1, amount));
  return {
    r: from.r + (to.r - from.r) * t,
    g: from.g + (to.g - from.g) * t,
    b: from.b + (to.b - from.b) * t
  };
}

function luminance(rgb: Rgb): number {
  const channel = (raw: number) => {
    const c = clamp255(raw) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Walks the accent toward black (light grounds) or white (dark grounds) until
 * it is legible AS TEXT on that ground. A pale yellow accent stays pale as a
 * chart fill and darkens as a label — which is what a designer would do.
 */
function readableOn(accent: Rgb, ground: Rgb, target = 4.5): Rgb {
  if (contrast(accent, ground) >= target) return accent;
  const toward = luminance(ground) > 0.4 ? NEAR_BLACK : WHITE;
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mix(accent, toward, step * 0.05);
    if (contrast(candidate, ground) >= target) return candidate;
  }
  return toward;
}

// ---------------------------------------------------------------------------
// HSL, used only to spin a multi-slice ramp out of a single accent.
// ---------------------------------------------------------------------------

type Hsl = { h: number; s: number; l: number };

function toHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return { h: 0, s: 0, l };
  const s = delta / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / delta) % 6;
  else if (max === gn) h = (bn - rn) / delta + 2;
  else h = (rn - gn) / delta + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

function fromHsl({ h, s, l }: Hsl): Rgb {
  const sat = Math.max(0, Math.min(1, s));
  const light = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hue = ((h % 360) + 360) % 360;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/**
 * The slice ramp for a pie. Mostly lightness with a small hue drift, so eight
 * slices stay recognisably ONE brand family instead of turning into a rainbow.
 * Fed the Triven amber this lands almost exactly on the hand-picked amber ramp
 * the component used to hard-code — but it now works for any accent.
 */
const RAMP_STEPS: Array<{ l: number; h: number; s: number }> = [
  { l: 0, h: 0, s: 0 },
  { l: -0.13, h: -8, s: 0.04 },
  { l: 0.14, h: 7, s: -0.04 },
  { l: -0.24, h: -16, s: 0.06 },
  { l: 0.05, h: 20, s: 0.02 },
  { l: -0.31, h: -22, s: -0.02 },
  { l: 0.25, h: 13, s: -0.1 },
  { l: -0.07, h: 30, s: 0.04 }
];

function accentRamp(accent: Rgb, surface: VisualSurface): string[] {
  const base = toHsl(accent);
  // On a dark ground the whole family lifts, or the darkest slices vanish.
  const lift = surface === "dark" ? 0.12 : 0;
  return RAMP_STEPS.map((step) =>
    toHex(
      fromHsl({
        h: base.h + step.h,
        s: base.s + step.s,
        l: Math.max(0.22, Math.min(0.82, base.l + step.l + lift))
      })
    )
  );
}

// ---------------------------------------------------------------------------
// The palette.
// ---------------------------------------------------------------------------

export type TonePaint = { fg: string; bg: string; border: string };

export type VisualPalette = {
  /** Card ground — the spec card colour where one exists. */
  card: string;
  /** A very faint accent wash laid over the card, as a `background-image`. */
  cardWash: string;
  /** Hairline round a card / under a table header. */
  border: string;
  /** Faintest hairline — row rules inside a table. */
  borderSoft: string;
  /** Primary text. */
  ink: string;
  /** Secondary text — labels, axis values. */
  muted: string;
  /** Tertiary text — captions. */
  subtle: string;
  /** The lift under a card. */
  shadow: string;
  /** Table row hover tint (fed to CSS as a custom property). */
  rowHover: string;
  /** Quiet ground behind a table header row. */
  headerBg: string;

  /** The architect's exact accent — fills, bars, dots. */
  accent: string;
  /** The accent after the legibility walk — safe as TEXT on this surface. */
  accentInk: string;
  /** Lighter accent, the far end of every gradient. */
  accentLight: string;
  /** Accent at low alpha, for area fills and soft chips. */
  accentSoft: string;
  accentFaint: string;
  /** Ink that reads on top of a solid accent fill. */
  onAccent: string;
  /** Eight on-brand slice colours for a pie. */
  ramp: string[];

  /** Delta pills — one green and one red for the whole product. */
  up: TonePaint;
  down: TonePaint;
  flat: TonePaint;
};

const UP_ON_BASE: TonePaint = {
  fg: "#047857",
  bg: "rgba(16, 185, 129, 0.12)",
  border: "rgba(16, 185, 129, 0.28)"
};
const DOWN_ON_BASE: TonePaint = {
  fg: "#b91c1c",
  bg: "rgba(239, 68, 68, 0.10)",
  border: "rgba(239, 68, 68, 0.26)"
};
const UP_ON_DARK: TonePaint = {
  fg: "#6ee7b7",
  bg: "rgba(16, 185, 129, 0.20)",
  border: "rgba(110, 231, 183, 0.34)"
};
const DOWN_ON_DARK: TonePaint = {
  fg: "#fca5a5",
  bg: "rgba(239, 68, 68, 0.20)",
  border: "rgba(252, 165, 165, 0.32)"
};

/**
 * Resolve the page accent into everything Visual Results paints.
 * `surface` is "dark" only inside a dark section of a generated product page.
 */
export function visualPalette(accent: string, surface: VisualSurface = "base"): VisualPalette {
  const rgb = parseHex(accent) ?? FALLBACK_ACCENT;
  const onDark = surface === "dark";

  // The ground we assume when no spec variable is present. It only drives the
  // legibility walk and the shadow weight, never what gets painted.
  const ground: Rgb = onDark ? { r: 11, g: 17, b: 32 } : WHITE;
  const accentInkRgb = readableOn(rgb, ground);

  const v = (name: string, fallback: string) => `var(${name}, ${fallback})`;

  return {
    card: onDark ? v("--spec-inverse-card", "#151f33") : v("--spec-card", "#ffffff"),
    // Two stops, both accent, both nearly invisible — this is the "faint tinted
    // background" that stops a card reading as a plain white slab.
    cardWash: `linear-gradient(158deg, ${rgba(rgb, onDark ? 0.14 : 0.07)} 0%, ${rgba(
      rgb,
      0
    )} 58%)`,
    border: onDark ? v("--spec-inverse-border", "#22304a") : v("--spec-border", "#e2e8f0"),
    borderSoft: onDark ? v("--spec-inverse-border", "#1a2438") : v("--spec-border-soft", "#f1f5f9"),
    ink: onDark ? v("--spec-inverse-ink", "#f8fafc") : v("--spec-ink", "#0f172a"),
    muted: onDark ? v("--spec-inverse-ink-muted", "#a9b6c9") : v("--spec-ink-muted", "#475569"),
    subtle: onDark ? v("--spec-inverse-ink-muted", "#94a3b8") : v("--spec-ink-subtle", "#64748b"),
    shadow: onDark
      ? v(
          "--spec-shadow",
          "0 1px 2px rgba(2, 6, 16, 0.35), 0 16px 32px -20px rgba(2, 6, 16, 0.75)"
        )
      : v(
          "--spec-shadow",
          "0 1px 2px rgba(15, 23, 42, 0.05), 0 12px 28px -18px rgba(15, 23, 42, 0.28)"
        ),
    rowHover: onDark ? rgba(rgb, 0.1) : rgba(rgb, 0.055),
    headerBg: onDark ? "rgba(255, 255, 255, 0.035)" : "rgba(15, 23, 42, 0.025)",

    accent: toHex(rgb),
    accentInk: toHex(accentInkRgb),
    accentLight: toHex(mix(rgb, WHITE, onDark ? 0.24 : 0.38)),
    accentSoft: rgba(rgb, onDark ? 0.22 : 0.16),
    accentFaint: rgba(rgb, onDark ? 0.12 : 0.08),
    onAccent: toHex(contrast(rgb, WHITE) >= contrast(rgb, NEAR_BLACK) ? WHITE : NEAR_BLACK),
    ramp: accentRamp(rgb, surface),

    up: onDark ? UP_ON_DARK : UP_ON_BASE,
    down: onDark ? DOWN_ON_DARK : DOWN_ON_BASE,
    flat: {
      fg: onDark ? v("--spec-inverse-ink-muted", "#a9b6c9") : v("--spec-ink-muted", "#475569"),
      bg: onDark ? "rgba(255, 255, 255, 0.06)" : "rgba(15, 23, 42, 0.045)",
      border: onDark ? "rgba(255, 255, 255, 0.12)" : "rgba(15, 23, 42, 0.09)"
    }
  };
}
