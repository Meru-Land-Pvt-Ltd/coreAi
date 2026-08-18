import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import {
  defaultProductSpec,
  sanitizeProductSpec,
  type PageSpec,
  type ProductTheme,
  type SpecNode
} from "@coreai/shared";
import { SpecRenderer, groupPageBands, paintsSomething, type SpecNodeRenderer } from "./spec-renderer";
import { buildSpecTheme, hexContrast, surfaceInk, textToneColor } from "./spec-theme";
import { normalizeIconName, resolveIcon, FALLBACK_ICON, hasIcon } from "./spec-icon";
import { childAlign, childSurface, nodeShell } from "./node-shell";
import { deltaTone } from "./nodes/content-nodes";

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------

/**
 * A page that exercises every layout and content primitive at once, nested
 * four levels deep, across a plain band and a dark band. If this renders, the
 * walker handles the whole decorative half of the contract.
 */
function nestedPage(): PageSpec {
  return {
    id: "home",
    title: "Ledger",
    path: "",
    blocks: [
      {
        id: "hero",
        type: "section",
        padding: "xl",
        background: "gradient",
        children: [
          {
            id: "hero-stack",
            type: "stack",
            gap: "md",
            align: "center",
            children: [
              { id: "hero-badge", type: "badge", text: "Live now", tone: "accent" },
              { id: "hero-title", type: "heading", level: 1, text: "Books that close themselves" },
              {
                id: "hero-copy",
                type: "text",
                size: "lg",
                text: "Send it a receipt. Get a clean ledger back.",
                style: { textTone: "muted", maxWidth: "md" }
              },
              {
                id: "hero-row",
                type: "row",
                gap: "sm",
                align: "center",
                children: [
                  { id: "hero-divider", type: "divider" },
                  { id: "hero-spacer", type: "spacer", size: "sm" }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "proof",
        type: "section",
        padding: "lg",
        background: "tint",
        children: [
          {
            id: "proof-grid",
            type: "grid",
            columns: 3,
            gap: "md",
            children: [
              {
                id: "proof-card",
                type: "stack",
                gap: "sm",
                align: "start",
                style: { bgTone: "tint" },
                children: [
                  { id: "proof-icon", type: "icon", name: "ShieldCheck", size: "md" },
                  { id: "proof-card-title", type: "heading", level: 3, text: "Audit ready" },
                  {
                    id: "proof-list",
                    type: "list",
                    listStyle: "check",
                    items: ["Every entry sourced", "Exports to your accountant"]
                  }
                ]
              },
              { id: "proof-stat", type: "stat", label: "Hours saved", value: "1,280", delta: "+18%" },
              { id: "proof-stat-down", type: "stat", label: "Errors", value: "3", delta: "-64%" },
              {
                id: "proof-quote",
                type: "quote",
                text: "It closed our month in an afternoon.",
                author: "Rina Patel",
                role: "Head of Finance"
              },
              {
                id: "proof-image",
                type: "image",
                url: "https://cdn.example.com/ledger.png",
                alt: "The ledger view",
                ratio: "wide"
              }
            ]
          }
        ]
      },
      {
        id: "cta",
        type: "section",
        padding: "lg",
        background: "dark",
        children: [
          {
            id: "cta-stack",
            type: "stack",
            gap: "sm",
            align: "center",
            children: [{ id: "cta-title", type: "heading", level: 2, text: "Start tonight" }]
          }
        ]
      }
    ]
  };
}

function pageOf(blocks: SpecNode[]): PageSpec {
  return { id: "home", title: "Test", path: "", blocks };
}

function testid(id: string) {
  return screen.getByTestId(`spec-node-${id}`);
}

// ---------------------------------------------------------------------------
// 1. The nested fixture.
// ---------------------------------------------------------------------------

describe("SpecRenderer — nested fixture", () => {
  it("paints every layout and content primitive in the tree", () => {
    render(<SpecRenderer page={nestedPage()} />);

    expect(screen.getByTestId("spec-page").getAttribute("data-spec-page")).toBe("home");

    for (const id of [
      "hero",
      "hero-stack",
      "hero-badge",
      "hero-title",
      "hero-copy",
      "hero-row",
      "hero-divider",
      "hero-spacer",
      "proof",
      "proof-grid",
      "proof-card",
      "proof-icon",
      "proof-card-title",
      "proof-list",
      "proof-stat",
      "proof-quote",
      "proof-image",
      "cta",
      "cta-stack",
      "cta-title"
    ]) {
      expect(testid(id)).toBeTruthy();
    }

    expect(screen.getByText("Books that close themselves").tagName).toBe("H1");
    expect(screen.getByText("Audit ready").tagName).toBe("H3");
    expect(screen.getByText("Start tonight").tagName).toBe("H2");
    expect(screen.getByText("Every entry sourced")).toBeTruthy();
    expect(screen.getByText("It closed our month in an afternoon.")).toBeTruthy();
    expect(screen.getByText("Rina Patel")).toBeTruthy();
  });

  it("keeps nesting: the deepest node is inside its grandparent section", () => {
    render(<SpecRenderer page={nestedPage()} />);
    const section = testid("proof");
    expect(within(section).getByTestId("spec-node-proof-icon")).toBeTruthy();
    expect(within(section).getByText("Audit ready")).toBeTruthy();
  });

  it("tags every painted node with its spec type", () => {
    render(<SpecRenderer page={nestedPage()} />);
    expect(testid("proof-grid").getAttribute("data-spec-type")).toBe("grid");
    expect(testid("proof-stat").getAttribute("data-spec-type")).toBe("stat");
    expect(testid("hero-badge").getAttribute("data-spec-type")).toBe("badge");
  });
});

// ---------------------------------------------------------------------------
// 2. Invalid, unknown and wired nodes.
// ---------------------------------------------------------------------------

describe("SpecRenderer — nodes it will not paint", () => {
  it("skips an unknown node type in silence and keeps its siblings", () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    const blocks = [
      { id: "before", type: "heading", level: 2, text: "Before" },
      { id: "alien", type: "carousel-3d", text: "nope" },
      { id: "after", type: "heading", level: 2, text: "After" }
    ] as unknown as SpecNode[];

    expect(() => render(<SpecRenderer page={pageOf(blocks)} />)).not.toThrow();
    expect(screen.getByText("Before")).toBeTruthy();
    expect(screen.getByText("After")).toBeTruthy();
    expect(screen.queryByTestId("spec-node-alien")).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    onError.mockRestore();
  });

  it("skips wired nodes when no renderer is mounted, leaving decoration intact", () => {
    const blocks: SpecNode[] = [
      { id: "copy", type: "text", text: "The product sits here." },
      { id: "go", type: "button", label: "Run it", wire: { role: "action" } },
      { id: "out", type: "result", variant: "auto", wire: { role: "output" } }
    ];

    render(<SpecRenderer page={pageOf(blocks)} />);
    expect(screen.getByText("The product sits here.")).toBeTruthy();
    expect(screen.queryByTestId("spec-node-go")).toBeNull();
    expect(screen.queryByTestId("spec-node-out")).toBeNull();
  });

  it("drops the nodes the sanitizer rejects and paints what survived", () => {
    const raw = {
      version: 1,
      pages: [
        {
          id: "home",
          title: "Salvage",
          path: "",
          blocks: [
            { id: "good", type: "heading", level: 2, text: "Survivor" },
            { id: "empty-heading", type: "heading", text: "   " },
            { id: "bad-image", type: "image", url: "javascript:alert(1)", alt: "x" },
            { id: "hollow", type: "section", children: [] },
            { id: "good-list", type: "list", items: ["kept", 42, ""], style: "bullet" }
          ]
        }
      ],
      nav: { links: [], footerLinks: [] }
    };

    const spec = sanitizeProductSpec(raw);
    expect(spec).not.toBeNull();
    render(<SpecRenderer page={spec!.pages[0]} theme={spec!.theme} />);

    expect(screen.getByText("Survivor")).toBeTruthy();
    expect(screen.getByText("kept")).toBeTruthy();
    expect(screen.queryByTestId("spec-node-bad-image")).toBeNull();
    expect(screen.queryByTestId("spec-node-hollow")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders nothing but the shell for a page with no blocks", () => {
    render(<SpecRenderer page={pageOf([])} />);
    expect(screen.getByTestId("spec-page").children.length).toBe(1); // the <style> only
  });

  it("drops a band that would paint nothing rather than leaving empty air", () => {
    const blocks: SpecNode[] = [
      {
        id: "wired-only",
        type: "section",
        padding: "xl",
        children: [
          {
            id: "wired-stack",
            type: "stack",
            children: [{ id: "go", type: "button", label: "Run", wire: { role: "action" } }]
          }
        ]
      },
      {
        id: "real",
        type: "section",
        children: [{ id: "rt", type: "heading", level: 2, text: "Still here" }]
      }
    ];

    render(<SpecRenderer page={pageOf(blocks)} />);
    expect(screen.queryByTestId("spec-node-wired-only")).toBeNull();
    expect(screen.queryByTestId("spec-node-wired-stack")).toBeNull();
    expect(testid("real")).toBeTruthy();
    expect(paintsSomething(blocks[0], false)).toBe(false);
  });

  it("prunes nothing once a wire renderer is mounted", () => {
    const blocks: SpecNode[] = [
      {
        id: "wired-only",
        type: "section",
        children: [{ id: "go", type: "button", label: "Run", wire: { role: "action" } }]
      }
    ];
    expect(paintsSomething(blocks[0], true)).toBe(true);

    render(
      <SpecRenderer
        page={pageOf(blocks)}
        renderNode={({ node }) =>
          node.type === "button" ? <button data-testid="wired">{node.label}</button> : undefined
        }
      />
    );
    expect(testid("wired-only")).toBeTruthy();
    expect(screen.getByTestId("wired")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Mobile.
// ---------------------------------------------------------------------------

describe("SpecRenderer — mobile first", () => {
  it("collapses every grid to one column and steps up at breakpoints", () => {
    const blocks: SpecNode[] = [
      { id: "g2", type: "grid", columns: 2, children: [{ id: "g2a", type: "text", text: "a" }] },
      { id: "g3", type: "grid", columns: 3, children: [{ id: "g3a", type: "text", text: "b" }] },
      { id: "g4", type: "grid", columns: 4, children: [{ id: "g4a", type: "text", text: "c" }] }
    ];
    render(<SpecRenderer page={pageOf(blocks)} />);

    expect(testid("g2").className).toContain("grid-cols-1");
    expect(testid("g2").className).toContain("sm:grid-cols-2");
    expect(testid("g3").className).toContain("grid-cols-1");
    expect(testid("g3").className).toContain("lg:grid-cols-3");
    expect(testid("g4").className).toContain("grid-cols-1");
    expect(testid("g4").className).toContain("lg:grid-cols-4");
  });

  it("wraps rows instead of letting them overflow the viewport", () => {
    const blocks: SpecNode[] = [
      { id: "r", type: "row", gap: "md", align: "center", children: [{ id: "rb", type: "badge", text: "x" }] }
    ];
    render(<SpecRenderer page={pageOf(blocks)} />);
    expect(testid("r").className).toContain("flex-wrap");
    expect(testid("r").className).toContain("justify-center");
  });

  it("gives sections responsive padding and a padded content column", () => {
    const blocks: SpecNode[] = [
      { id: "s", type: "section", padding: "lg", children: [{ id: "st", type: "text", text: "x" }] }
    ];
    render(<SpecRenderer page={pageOf(blocks)} />);

    expect(testid("s").className).toContain("py-16");
    expect(testid("s").className).toContain("sm:py-24");
    const container = testid("s").firstElementChild as HTMLElement;
    expect(container.className).toContain("px-5");
    expect(container.className).toContain("sm:px-8");
    // The cap is the page's measure and only applies from lg up, so a phone
    // and a tablet always use the full width they have, minus the gutter.
    expect(container.className).toContain("lg:max-w-[var(--spec-measure,72rem)]");
    expect(container.className).not.toContain("sm:max-w");
  });

  it("never lets the page scroll sideways", () => {
    render(<SpecRenderer page={nestedPage()} />);
    expect(screen.getByTestId("spec-page").className).toContain("overflow-x-clip");
  });

  it("steps the heading scale up rather than down", () => {
    const blocks: SpecNode[] = [{ id: "h", type: "heading", level: 1, text: "Big" }];
    render(<SpecRenderer page={pageOf(blocks)} />);
    const heading = testid("h");
    expect(heading.className).toContain("sm:text-5xl");
    expect(heading.className).toContain("lg:text-6xl");
  });
});

// ---------------------------------------------------------------------------
// 4. No HTML from the spec.
// ---------------------------------------------------------------------------

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      // `sections/` belongs to another builder; this suite owns the walker,
      // the tokens and the node components.
      if (entry === "sections") continue;
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.tsx")) out.push(full);
  }
  return out;
}

/** Comments talk ABOUT the rule; only real code can break it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("SpecRenderer — the spec can never become markup", () => {
  const files = sourceFiles(__dirname);

  it("finds the renderer sources to scan", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("uses no dangerouslySetInnerHTML anywhere", () => {
    const offenders = files.filter((file) =>
      /dangerouslySetInnerHTML/.test(stripComments(readFileSync(file, "utf8")))
    );
    expect(offenders).toEqual([]);
  });

  it("escapes spec text instead of interpreting it", () => {
    const blocks: SpecNode[] = [
      { id: "x", type: "text", text: "<img src=x onerror=alert(1)> & <b>bold</b>" }
    ];
    render(<SpecRenderer page={pageOf(blocks)} />);

    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(testid("x").textContent).toBe("<img src=x onerror=alert(1)> & <b>bold</b>");
  });
});

// ---------------------------------------------------------------------------
// 5. Theme.
// ---------------------------------------------------------------------------

describe("buildSpecTheme", () => {
  it("falls back to the Triven amber in light mode", () => {
    const theme = buildSpecTheme(undefined);
    expect(theme.accent).toBe("#f59e0b");
    expect(theme.mode).toBe("light");
    expect(theme.font).toBe("sans");
  });

  it("keeps the architect's accent as the fill color", () => {
    expect(buildSpecTheme({ accent: "#6d28d9" }).accent).toBe("#6d28d9");
  });

  it("darkens a pale accent until accent TEXT clears WCAG AA", () => {
    const theme = buildSpecTheme({ accent: "#fef08a", mode: "light" });
    expect(theme.accent).toBe("#fef08a");
    expect(hexContrast(theme.accentInk, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("lightens a near-black accent for text on a dark page", () => {
    const theme = buildSpecTheme({ accent: "#101010", mode: "dark" });
    const vars = theme.vars as Record<string, string>;
    expect(hexContrast(vars["--spec-accent-ink-inverse"], "#05090f")).toBeGreaterThanOrEqual(4.5);
  });

  it("picks readable ink to sit on top of an accent fill", () => {
    expect(hexContrast(buildSpecTheme({ accent: "#fef08a" }).accentContrast, "#fef08a")).toBeGreaterThan(4.5);
    expect(hexContrast(buildSpecTheme({ accent: "#1e1b4b" }).accentContrast, "#1e1b4b")).toBeGreaterThan(4.5);
  });

  it("gives each mode its own ground and font stack", () => {
    const warm = buildSpecTheme({ mode: "warm", font: "serif" }).vars as Record<string, string>;
    const dark = buildSpecTheme({ mode: "dark" }).vars as Record<string, string>;
    expect(warm["--spec-ground"]).toBe("#fdfaf3");
    expect(warm["--spec-font"]).toContain("serif");
    expect(dark["--spec-ground"]).toBe("#0b1120");
  });

  it("survives a malformed accent without losing the palette", () => {
    const theme = buildSpecTheme({ accent: "not-a-color" } as unknown as ProductTheme);
    expect(theme.accent).toBe("#f59e0b");
  });

  it("publishes the palette as custom properties on the page root", () => {
    render(<SpecRenderer page={pageOf([{ id: "t", type: "text", text: "hi" }])} theme={{ accent: "#6d28d9" }} />);
    const root = screen.getByTestId("spec-page");
    expect(root.style.getPropertyValue("--spec-accent")).toBe("#6d28d9");
    expect(root.style.getPropertyValue("--spec-ground")).toBe("#ffffff");
  });
});

describe("surfaces", () => {
  it("flips ink inside a dark section", () => {
    expect(surfaceInk("base").ink).toBe("var(--spec-ink)");
    expect(surfaceInk("dark").ink).toBe("var(--spec-inverse-ink)");
  });

  it("hands the dark surface down to a dark section's children", () => {
    const dark: SpecNode = { id: "s", type: "section", background: "dark", children: [] };
    const plain: SpecNode = { id: "s2", type: "section", background: "tint", children: [] };
    expect(childSurface(dark, "base")).toBe("dark");
    expect(childSurface(plain, "dark")).toBe("base");
  });

  it("flips ink inside an accent or dark card", () => {
    const card: SpecNode = { id: "c", type: "stack", style: { bgTone: "accent" }, children: [] };
    expect(childSurface(card, "base")).toBe("dark");
    expect(nodeShell(card, "base", "left").isCard).toBe(true);
  });

  it("paints a heading in the inverse ink inside a dark band", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "s",
            type: "section",
            background: "dark",
            children: [{ id: "h", type: "heading", level: 2, text: "Dark" }]
          }
        ])}
      />
    );
    expect(testid("h").style.color).toBe("var(--spec-inverse-ink)");
  });

  it("resolves textTone tokens against the surface", () => {
    expect(textToneColor("muted", "base")).toBe("var(--spec-ink-muted)");
    expect(textToneColor("muted", "dark")).toBe("var(--spec-inverse-ink-muted)");
    expect(textToneColor("accent", "dark")).toBe("var(--spec-accent-ink-inverse)");
    expect(textToneColor(undefined, "base", "muted")).toBe("var(--spec-ink-muted)");
  });
});

// ---------------------------------------------------------------------------
// 6. Icons.
// ---------------------------------------------------------------------------

describe("icons", () => {
  it("accepts whatever spelling the AI wrote", () => {
    expect(normalizeIconName("ShieldCheck")).toBe("shield-check");
    expect(normalizeIconName("shield_check")).toBe("shield-check");
    expect(normalizeIconName("Shield Check")).toBe("shield-check");
    expect(resolveIcon("ShieldCheck")).toBe(resolveIcon("shield-check"));
  });

  it("falls back instead of leaving a hole", () => {
    expect(resolveIcon("definitely-not-an-icon")).toBe(FALLBACK_ICON);
    expect(resolveIcon(undefined)).toBe(FALLBACK_ICON);
    expect(hasIcon("definitely-not-an-icon")).toBe(false);
    expect(hasIcon("rocket")).toBe(true);
  });

  it("renders an svg for an unknown name and hides it from screen readers", () => {
    render(<SpecRenderer page={pageOf([{ id: "i", type: "icon", name: "🙈", size: "lg" }])} />);
    const icon = testid("i");
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.querySelector("svg")).toBeTruthy();
    expect(icon.className).toContain("h-14");
  });
});

// ---------------------------------------------------------------------------
// 7. Alignment, width and cards.
// ---------------------------------------------------------------------------

describe("alignment and the style token bag", () => {
  it("hands a centered stack's alignment to its children", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "s",
            type: "stack",
            align: "center",
            children: [{ id: "h", type: "heading", level: 2, text: "Centered" }]
          }
        ])}
      />
    );
    expect(testid("h").className).toContain("text-center");
  });

  it("lets an inner card reset alignment back to the left", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "outer",
            type: "stack",
            align: "center",
            children: [
              {
                id: "inner",
                type: "stack",
                align: "start",
                children: [{ id: "h", type: "heading", level: 3, text: "Left" }]
              }
            ]
          }
        ])}
      />
    );
    expect(testid("h").className).toContain("text-left");
  });

  it("lets a node override the inherited alignment", () => {
    expect(childAlign({ id: "s", type: "stack", align: "center", children: [] }, "left")).toBe("center");
    expect(childAlign({ id: "s", type: "stack", children: [] }, "center")).toBe("center");
    expect(
      childAlign({ id: "s", type: "stack", align: "center", style: { align: "right" }, children: [] }, "left")
    ).toBe("right");
  });

  it("gives a container the alignment it hands down, not the one it received", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "outer",
            type: "stack",
            align: "center",
            children: [
              {
                id: "card",
                type: "stack",
                align: "start",
                children: [{ id: "h", type: "heading", level: 3, text: "Left" }]
              }
            ]
          }
        ])}
      />
    );
    // The centered stack advertises `text-center`; the card that resets to the
    // left advertises `text-left`, so any stray text lands where it should.
    expect(testid("outer").className).toContain("text-center");
    expect(testid("card").className).toContain("text-left");
    expect(testid("card").className).not.toContain("text-center");
  });

  it("caps and centers a width-limited node", () => {
    render(
      <SpecRenderer
        page={pageOf([{ id: "t", type: "text", text: "narrow", style: { maxWidth: "md", align: "center" } }])}
      />
    );
    expect(testid("t").className).toContain("max-w-2xl");
    expect(testid("t").className).toContain("mx-auto");
  });

  it("turns a bgTone into a rounded card with a soft shadow", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "card",
            type: "stack",
            style: { bgTone: "dark" },
            children: [{ id: "ct", type: "text", text: "in a card" }]
          }
        ])}
      />
    );
    const card = testid("card");
    expect(card.className).toContain("rounded-2xl");
    expect(card.style.background).toBe("var(--spec-inverse-ground)");
    expect(card.style.boxShadow).toBe("var(--spec-shadow)");
    expect(testid("ct").style.color).toBe("var(--spec-inverse-ink-muted)");
  });
});

// ---------------------------------------------------------------------------
// 8. Individual primitives worth pinning down.
// ---------------------------------------------------------------------------

describe("content primitives", () => {
  it("renders an image with a ratio box, object-cover, lazy loading and alt", () => {
    render(
      <SpecRenderer
        page={pageOf([
          { id: "im", type: "image", url: "https://cdn.example.com/a.png", alt: "A screenshot", ratio: "square" }
        ])}
      />
    );
    const frame = testid("im");
    expect(frame.className).toContain("aspect-square");
    expect(frame.className).toContain("rounded-2xl");

    const img = frame.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("alt")).toBe("A screenshot");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.className).toContain("object-cover");
  });

  it("keeps a decorative image accessible with an empty alt", () => {
    render(
      <SpecRenderer
        page={pageOf([{ id: "im", type: "image", url: "/local.png", alt: "" }])}
      />
    );
    expect((testid("im").querySelector("img") as HTMLImageElement).getAttribute("alt")).toBe("");
  });

  it("renders stat values in tabular figures and reads the delta's direction", () => {
    render(
      <SpecRenderer
        page={pageOf([
          { id: "s1", type: "stat", label: "Revenue", value: "1,204", delta: "+12%" },
          { id: "s2", type: "stat", label: "Churn", value: "0.8%", delta: "-4%" },
          { id: "s3", type: "stat", label: "Plan", value: "Pro", delta: "same as last week" }
        ])}
      />
    );
    expect(within(testid("s1")).getByText("1,204").className).toContain("tabular-nums");
    expect(deltaTone("+12%")).toEqual({ tone: "success", direction: "up" });
    expect(deltaTone("-4%")).toEqual({ tone: "danger", direction: "down" });
    expect(deltaTone("same as last week")).toEqual({ tone: "neutral", direction: "flat" });
    expect(within(testid("s3")).getByText("same as last week")).toBeTruthy();
  });

  it("centers the list block but never the list items", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "s",
            type: "stack",
            align: "center",
            children: [{ id: "l", type: "list", items: ["one", "two"] }]
          },
          { id: "l2", type: "list", items: ["three"] }
        ])}
      />
    );
    expect(testid("l").className).toContain("text-left");
    expect(testid("l").className).toContain("mx-auto");
    expect(testid("l").className).toContain("w-fit");
    expect(testid("l2").className).toContain("w-full");
    expect(testid("l2").className).not.toContain("mx-auto");
  });

  it("lifts a tint card off the band it sits on", () => {
    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "band",
            type: "section",
            background: "tint",
            children: [
              {
                id: "card",
                type: "stack",
                style: { bgTone: "tint" },
                children: [{ id: "ct", type: "text", text: "raised" }]
              }
            ]
          }
        ])}
      />
    );
    const card = testid("card");
    // Not the same fill as the band, and it casts a shadow, so it reads as a
    // card even when the section behind it is already tinted.
    expect(card.style.background).toBe("var(--spec-tint-strong)");
    expect(card.style.boxShadow).toBe("var(--spec-shadow-sm)");
  });

  it("numbers a numbered list and marks a checked one", () => {
    render(
      <SpecRenderer
        page={pageOf([
          { id: "n", type: "list", listStyle: "number", items: ["first", "second"] },
          { id: "c", type: "list", listStyle: "check", items: ["done"] }
        ])}
      />
    );
    expect(testid("n").tagName).toBe("OL");
    expect(testid("c").tagName).toBe("UL");
    expect(within(testid("n")).getByText("1")).toBeTruthy();
    expect(testid("c").querySelector("svg")).toBeTruthy();
  });

  it("hides a spacer and a divider from the accessibility tree", () => {
    render(
      <SpecRenderer
        page={pageOf([
          { id: "sp", type: "spacer", size: "xl" },
          { id: "dv", type: "divider" }
        ])}
      />
    );
    expect(testid("sp").getAttribute("aria-hidden")).toBe("true");
    expect(testid("sp").className).toContain("h-20");
    expect(testid("dv").tagName).toBe("HR");
  });

  it("renders a quote as a figure with its attribution", () => {
    render(
      <SpecRenderer
        page={pageOf([{ id: "q", type: "quote", text: "Worth it.", author: "Sam", role: "CTO" }])}
      />
    );
    expect(testid("q").tagName).toBe("FIGURE");
    expect(within(testid("q")).getByText("Sam")).toBeTruthy();
    expect(within(testid("q")).getByText("CTO")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 9. Page assembly and the extension point.
// ---------------------------------------------------------------------------

describe("page assembly", () => {
  it("groups loose top-level nodes into one implicit band", () => {
    const blocks: SpecNode[] = [
      { id: "a", type: "heading", level: 2, text: "A" },
      { id: "b", type: "text", text: "B" },
      { id: "s", type: "section", children: [{ id: "c", type: "text", text: "C" }] },
      { id: "d", type: "text", text: "D" }
    ];
    const bands = groupPageBands(blocks);
    expect(bands.map((band) => band.kind)).toEqual(["loose", "section", "loose"]);

    render(<SpecRenderer page={pageOf(blocks)} />);
    expect(screen.getAllByTestId("spec-implicit-section")).toHaveLength(2);
    expect(screen.getByTestId("spec-page").querySelectorAll("[data-spec-band]")).toHaveLength(3);
  });

  it("staggers the bands' reveal and caps the delay on long pages", () => {
    const blocks: SpecNode[] = Array.from({ length: 9 }, (_, index) => ({
      id: `s${index}`,
      type: "section" as const,
      children: [{ id: `t${index}`, type: "text" as const, text: `band ${index}` }]
    }));
    render(<SpecRenderer page={pageOf(blocks)} />);
    const bands = Array.from(
      screen.getByTestId("spec-page").querySelectorAll<HTMLElement>("[data-spec-band]")
    );
    expect(bands[0].style.getPropertyValue("--spec-band-delay")).toBe("0ms");
    expect(bands[8].style.getPropertyValue("--spec-band-delay")).toBe("350ms");
  });

  it("guards the reveal behind prefers-reduced-motion", () => {
    render(<SpecRenderer page={pageOf([{ id: "t", type: "text", text: "x" }])} />);
    const style = screen.getByTestId("spec-page").querySelector("style");
    expect(style?.textContent).toContain("prefers-reduced-motion: no-preference");
  });
});

describe("the starter every new agent gets", () => {
  it("paints defaultProductSpec end to end", () => {
    const spec = defaultProductSpec({
      name: "Ledger",
      tagline: "Send it a receipt. Get clean books back.",
      highlights: ["Closes a month in an afternoon", "Every entry traces to a source", "Exports to Xero"],
      accent: "#6d28d9"
    });
    const home = spec.pages.find((page) => page.id === "home")!;

    render(
      <SpecRenderer
        page={home}
        theme={spec.theme}
        renderNode={({ node }) =>
          node.type === "input" || node.type === "button" || node.type === "result" ? (
            <div data-testid={`wired-${node.type}`} />
          ) : undefined
        }
      />
    );

    expect(screen.getByText("Ledger").tagName).toBe("H1");
    expect(screen.getByText("Send it a receipt. Get clean books back.")).toBeTruthy();
    expect(screen.getByText("What it does")).toBeTruthy();
    expect(screen.getByText("Closes a month in an afternoon")).toBeTruthy();
    expect(screen.getByText("Try Ledger now")).toBeTruthy();
    expect(screen.getByTestId("spec-page").style.getPropertyValue("--spec-accent")).toBe("#6d28d9");
    expect(screen.getAllByTestId("wired-button")).toHaveLength(2);
    expect(screen.getByTestId("wired-input")).toBeTruthy();
    expect(screen.getByTestId("wired-result")).toBeTruthy();
  });
});

describe("the wire extension point", () => {
  it("hands wired nodes to the renderer that owns them", () => {
    const seen: string[] = [];
    const renderNode: SpecNodeRenderer = ({ node }) => {
      if (node.type !== "button") return undefined;
      seen.push(node.id);
      return <button data-testid={`wired-${node.id}`}>{node.label}</button>;
    };

    render(
      <SpecRenderer
        page={pageOf([
          { id: "h", type: "heading", level: 2, text: "Kept" },
          { id: "go", type: "button", label: "Run it", wire: { role: "action", nodeId: "brain-1" } }
        ])}
        renderNode={renderNode}
      />
    );

    expect(seen).toEqual(["go"]);
    expect(screen.getByTestId("wired-go").textContent).toBe("Run it");
    expect(screen.getByText("Kept")).toBeTruthy();
  });

  it("passes painted children and the surface down to the extension", () => {
    const surfaces: string[] = [];
    const renderNode: SpecNodeRenderer = ({ node, surface, children }) => {
      if (node.type !== "stack") return undefined;
      surfaces.push(surface);
      return <div data-testid={`ext-${node.id}`}>{children}</div>;
    };

    render(
      <SpecRenderer
        page={pageOf([
          {
            id: "sec",
            type: "section",
            background: "dark",
            children: [
              { id: "st", type: "stack", children: [{ id: "t", type: "text", text: "inside" }] }
            ]
          }
        ])}
        renderNode={renderNode}
      />
    );

    expect(surfaces).toEqual(["dark"]);
    expect(within(screen.getByTestId("ext-st")).getByText("inside")).toBeTruthy();
  });

  it("falls back to the built-in painter when the extension declines", () => {
    const renderNode: SpecNodeRenderer = () => undefined;
    render(
      <SpecRenderer page={pageOf([{ id: "h", type: "heading", level: 1, text: "Built in" }])} renderNode={renderNode} />
    );
    expect(screen.getByText("Built in").tagName).toBe("H1");
  });
});

// ---------------------------------------------------------------------------
// The width dial — how wide a generated product page runs.
// ---------------------------------------------------------------------------

/**
 * One measure, set once on the page root, read by every content column: the
 * shared band container, the recognized sections, and the site chrome. The
 * "standard" measure is 72rem — exactly the width these pages have always
 * used — so a page with no dial saved looks the same as it did before the
 * dial existed.
 */
describe("SpecRenderer — how wide the page runs", () => {
  function measureOf(): string {
    return screen.getByTestId("spec-page").style.getPropertyValue("--spec-measure");
  }

  it("puts the picked measure on the page root", () => {
    for (const [contentWidth, measure] of [
      ["compact", "56rem"],
      ["standard", "72rem"],
      ["wide", "80rem"],
      ["full", "100vw"]
    ] as const) {
      cleanup();
      render(<SpecRenderer page={pageOf([{ id: "t", type: "text", text: "x" }])} contentWidth={contentWidth} />);
      expect(measureOf()).toBe(measure);
      expect(screen.getByTestId("spec-page").getAttribute("data-spec-width")).toBe(contentWidth);
    }
  });

  it("keeps the standard measure when no dial is passed — today's pages are untouched", () => {
    render(<SpecRenderer page={pageOf([{ id: "t", type: "text", text: "x" }])} />);
    expect(measureOf()).toBe("72rem");
  });

  it("caps a band at the measure, and only from lg up", () => {
    render(
      <SpecRenderer
        page={pageOf([
          { id: "s", type: "section", children: [{ id: "st", type: "text", text: "x" }] }
        ])}
        contentWidth="full"
      />
    );

    const container = testid("s").firstElementChild as HTMLElement;
    expect(container.className).toContain("lg:max-w-[var(--spec-measure,72rem)]");
    // Below lg there is no cap at all — a phone and a tablet always use the
    // full width they have, minus the gutter.
    expect(container.className).not.toMatch(/(^|\s)max-w-/);
    expect(container.className).toContain("px-5");
  });

  it("gives a loose-node band the same column", () => {
    render(<SpecRenderer page={pageOf([{ id: "t", type: "text", text: "x" }])} contentWidth="wide" />);

    const band = screen.getByTestId("spec-implicit-section").firstElementChild as HTMLElement;
    expect(band.className).toContain("lg:max-w-[var(--spec-measure,72rem)]");
  });

  it("leaves a node's own prose cap alone — paragraphs stay readable at any width", () => {
    render(
      <SpecRenderer
        page={pageOf([{ id: "t", type: "text", text: "narrow", style: { maxWidth: "md" } }])}
        contentWidth="full"
      />
    );

    // The node cap is unprefixed on purpose: a line of prose is capped on
    // every screen, however wide the page around it runs.
    expect(testid("t").className).toContain("max-w-2xl");
  });
});
