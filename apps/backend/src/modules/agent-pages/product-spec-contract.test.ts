import { describe, expect, it } from "vitest";
import {
  PRODUCT_SPEC_LIMITS,
  collectWires,
  defaultProductSpec,
  findPage,
  productSpecSchema,
  sanitizeProductSpec,
  specNodeCount,
  type ProductSpec,
  type SpecNode
} from "@coreai/shared";

/**
 * The Product Spec contract: the sanitizer is the door every AI-written and
 * every stored spec comes through, so these tests are mostly about what it
 * REFUSES to pass on — and about what it manages to save anyway.
 */

const minimalSpec = (blocks: unknown[]): unknown => ({
  version: 1,
  pages: [{ id: "home", title: "Home", path: "", blocks }],
  nav: { links: [], footerLinks: [] }
});

function flatten(nodes: SpecNode[]): SpecNode[] {
  const out: SpecNode[] = [];
  const walk = (list: SpecNode[]) => {
    for (const node of list) {
      out.push(node);
      if ("children" in node) walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

const homeBlocks = (spec: ProductSpec): SpecNode[] => flatten(spec.pages[0].blocks);

describe("sanitizeProductSpec — per-node salvage", () => {
  it("drops only the broken nodes and keeps the rest of the page", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "good", type: "heading", text: "Real headline" },
        { id: "blank", type: "heading", text: "   " },
        { id: "alien", type: "carousel", slides: 4 },
        { id: "nope", type: "image", url: "javascript:alert(1)", alt: "x" },
        { id: "keep", type: "text", text: "Still here" }
      ])
    );

    expect(spec).not.toBeNull();
    expect(homeBlocks(spec as ProductSpec).map((node) => node.id)).toEqual(["good", "keep"]);
  });

  it("strips invisible control characters out of every kind of text", () => {
    // These arrive from copy-paste and from an LLM that echoed a raw byte.
    // They are invisible in the builder and can break the rendered page, so
    // the sanitizer removes them rather than refusing the node.
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "h", type: "heading", text: "Clean\u0000head\u001fline" },
        { id: "t", type: "text", text: "Body\u0008copy\u007f here" },
        { id: "l", type: "list", items: ["First\u000bitem", "Second\u000citem"] }
      ])
    );

    const blocks = homeBlocks(spec as ProductSpec);
    expect((blocks[0] as { text: string }).text).toBe("Cleanheadline");
    expect((blocks[1] as { text: string }).text).toBe("Bodycopy here");
    expect((blocks[2] as { items: string[] }).items).toEqual(["Firstitem", "Seconditem"]);

    // Newlines and tabs are real formatting and must survive.
    const kept = sanitizeProductSpec(
      minimalSpec([{ id: "t2", type: "text", text: "line one\nline two\tindented" }])
    );
    expect((homeBlocks(kept as ProductSpec)[0] as { text: string }).text).toBe(
      "line one\nline two\tindented"
    );
  });

  it("keeps a node whose optional tokens are nonsense, defaulting them away", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "h", type: "heading", text: "Hello", level: 9, align: "diagonal", style: { textTone: "neon" } }
      ])
    );

    expect(homeBlocks(spec as ProductSpec)[0]).toEqual({ id: "h", type: "heading", text: "Hello" });
  });

  it("rewrites duplicate and unusable node ids instead of dropping the nodes", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "same", type: "text", text: "first" },
        { id: "same", type: "text", text: "second" },
        { type: "text", text: "no id at all" }
      ])
    );

    const ids = homeBlocks(spec as ProductSpec).map((node) => node.id);
    expect(ids[0]).toBe("same");
    expect(new Set(ids).size).toBe(3);
  });

  it("drops a container that ends up with nothing in it", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "empty", type: "section", children: [{ id: "bad", type: "heading", text: "" }] },
        { id: "full", type: "section", children: [{ id: "ok", type: "heading", text: "Kept" }] }
      ])
    );

    expect((spec as ProductSpec).pages[0].blocks.map((node) => node.id)).toEqual(["full"]);
  });

  it("never lets a decoration node smuggle in a wire", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([{ id: "deco", type: "heading", text: "Pretend button", wire: { role: "action" } }])
    );

    expect(homeBlocks(spec as ProductSpec)[0]).not.toHaveProperty("wire");
    expect(collectWires(spec as ProductSpec)).toEqual([]);
  });

  it("accepts the AI-facing `style` spelling for button and list", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "b", type: "button", label: "Go", style: "primary" },
        { id: "l", type: "list", items: ["one", "two"], style: "check" }
      ])
    );

    const [button, list] = homeBlocks(spec as ProductSpec);
    expect(button).toMatchObject({ type: "button", variant: "primary" });
    expect(list).toMatchObject({ type: "list", listStyle: "check", items: ["one", "two"] });
  });

  it("strips unsafe hrefs but keeps the button", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "b1", type: "button", label: "Evil", href: "javascript:alert(1)" },
        { id: "b2", type: "button", label: "Fine", href: "/pricing" },
        { id: "b3", type: "button", label: "Mail", href: "mailto:hi@example.com" }
      ])
    );

    const buttons = homeBlocks(spec as ProductSpec);
    expect(buttons[0]).not.toHaveProperty("href");
    expect(buttons[1]).toMatchObject({ href: "/pricing" });
    expect(buttons[2]).toMatchObject({ href: "mailto:hi@example.com" });
  });

  it("returns null when nothing at all is salvageable", () => {
    expect(sanitizeProductSpec(null)).toBeNull();
    expect(sanitizeProductSpec("a string")).toBeNull();
    expect(sanitizeProductSpec({ version: 1, pages: [] })).toBeNull();
    expect(sanitizeProductSpec({ version: 1, pages: [{ id: "home", title: "H", blocks: [] }] })).toBeNull();
  });
});

describe("sanitizeProductSpec — caps", () => {
  it("caps nodes per page at 120", () => {
    const many = Array.from({ length: 500 }, (_, index) => ({
      id: `t${index}`,
      type: "text",
      text: `row ${index}`
    }));
    const spec = sanitizeProductSpec(minimalSpec(many)) as ProductSpec;

    expect(specNodeCount(spec)).toBe(PRODUCT_SPEC_LIMITS.maxNodesPerPage);
  });

  it("caps nesting at 8 levels and keeps everything above the line", () => {
    let deepest: Record<string, unknown> = { id: "d9", type: "stack", children: [{ id: "buried", type: "text", text: "too deep" }] };
    for (let level = 8; level >= 1; level -= 1) {
      deepest = {
        id: `d${level}`,
        type: "stack",
        children: [{ id: `shallow-${level}`, type: "text", text: `level ${level}` }, deepest]
      };
    }

    const spec = sanitizeProductSpec(minimalSpec([deepest])) as ProductSpec;
    const ids = homeBlocks(spec).map((node) => node.id);

    // d1..d8 sit at depths 1..8, so shallow-7 is the deepest leaf allowed.
    expect(ids).toContain("shallow-7");
    expect(ids).not.toContain("shallow-8");
    // d8's only surviving children were past the limit, so d8 goes too.
    expect(ids).not.toContain("d8");
    expect(ids).not.toContain("d9");
    expect(ids).not.toContain("buried");
  });

  it("caps pages at 12", () => {
    const pages = Array.from({ length: 40 }, (_, index) => ({
      id: `p${index}`,
      title: `Page ${index}`,
      blocks: [{ id: `h${index}`, type: "heading", text: `Page ${index}` }]
    }));
    const spec = sanitizeProductSpec({ version: 1, pages, nav: { links: [], footerLinks: [] } }) as ProductSpec;

    expect(spec.pages).toHaveLength(PRODUCT_SPEC_LIMITS.maxPages);
  });

  it("caps list items and choice options", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "l", type: "list", items: Array.from({ length: 40 }, (_, i) => `item ${i}`) },
        { id: "c", type: "choice", options: Array.from({ length: 40 }, (_, i) => `option ${i}`) }
      ])
    ) as ProductSpec;

    const [list, choice] = homeBlocks(spec);
    expect((list as { items: string[] }).items).toHaveLength(PRODUCT_SPEC_LIMITS.maxListItems);
    expect((choice as { options: string[] }).options).toHaveLength(PRODUCT_SPEC_LIMITS.maxChoiceOptions);
  });
});

describe("sanitizeProductSpec — pages, nav and theme", () => {
  it("promotes the first page to home when the author never wrote one", () => {
    const spec = sanitizeProductSpec({
      version: 1,
      pages: [
        { id: "landing", title: "Landing", path: "landing", blocks: [{ id: "a", type: "heading", text: "Hi" }] },
        { id: "pricing", title: "Pricing", path: "pricing", blocks: [{ id: "b", type: "heading", text: "Plans" }] }
      ],
      nav: { links: [{ label: "Start", pageId: "landing" }], footerLinks: [] }
    }) as ProductSpec;

    expect(spec.pages[0]).toMatchObject({ id: "home", path: "" });
    expect(spec.pages[1]).toMatchObject({ id: "pricing", path: "pricing" });
    // The nav link followed the page it pointed at.
    expect(spec.nav.links).toEqual([{ label: "Start", pageId: "home" }]);
  });

  it("drops nav links that point at a page which does not exist", () => {
    const spec = sanitizeProductSpec({
      version: 1,
      pages: [{ id: "home", title: "Home", path: "", blocks: [{ id: "a", type: "heading", text: "Hi" }] }],
      nav: {
        links: [
          { label: "Home", pageId: "home" },
          { label: "Ghost", pageId: "missing" }
        ],
        footerLinks: "not an array"
      }
    }) as ProductSpec;

    expect(spec.nav.links).toEqual([{ label: "Home", pageId: "home" }]);
    expect(spec.nav.footerLinks).toEqual([]);
  });

  it("makes page ids and paths slug-safe and unique", () => {
    const spec = sanitizeProductSpec({
      version: 1,
      pages: [
        { id: "home", title: "Home", path: "/", blocks: [{ id: "a", type: "text", text: "x" }] },
        { id: "About Us!!", title: "About", path: "/About Us/", blocks: [{ id: "b", type: "text", text: "y" }] },
        { id: "about-us", title: "Dupe", path: "about-us", blocks: [{ id: "c", type: "text", text: "z" }] }
      ],
      nav: { links: [], footerLinks: [] }
    }) as ProductSpec;

    expect(spec.pages.map((page) => page.path)).toEqual(["", "about-us", "about-us-3"]);
    expect(new Set(spec.pages.map((page) => page.id)).size).toBe(spec.pages.length);
  });

  it("keeps only a real hex accent and known theme tokens", () => {
    const spec = sanitizeProductSpec({
      ...(minimalSpec([{ id: "a", type: "text", text: "x" }]) as object),
      theme: { accent: "cornflower blue", mode: "dark", font: "comic" }
    }) as ProductSpec;

    expect(spec.theme).toEqual({ mode: "dark" });
  });
});

describe("helpers", () => {
  it("collectWires reports every socket with its page and node", () => {
    const spec = sanitizeProductSpec(
      minimalSpec([
        { id: "in", type: "input", wire: { role: "input", nodeId: "graph-1" } },
        { id: "go", type: "button", label: "Run", wire: { role: "action", nodeId: "graph-2" } },
        { id: "out", type: "result", wire: { role: "output" } },
        { id: "deco", type: "text", text: "no wire" }
      ])
    ) as ProductSpec;

    expect(collectWires(spec)).toEqual([
      { pageId: "home", pagePath: "", specNodeId: "in", nodeType: "input", wire: { role: "input", nodeId: "graph-1" } },
      { pageId: "home", pagePath: "", specNodeId: "go", nodeType: "button", wire: { role: "action", nodeId: "graph-2" } },
      { pageId: "home", pagePath: "", specNodeId: "out", nodeType: "result", wire: { role: "output" } }
    ]);
  });

  it("findPage resolves the home aliases and 404s honestly", () => {
    const spec = sanitizeProductSpec({
      version: 1,
      pages: [
        { id: "home", title: "Home", path: "", blocks: [{ id: "a", type: "text", text: "x" }] },
        { id: "pricing", title: "Pricing", path: "pricing", blocks: [{ id: "b", type: "text", text: "y" }] }
      ],
      nav: { links: [], footerLinks: [] }
    }) as ProductSpec;

    for (const alias of ["", "/", "home", "/home/"]) {
      expect(findPage(spec, alias)?.id).toBe("home");
    }
    expect(findPage(spec, "/pricing")?.id).toBe("pricing");
    expect(findPage(spec, "nowhere")).toBeNull();
    expect(findPage(spec, null)?.id).toBe("home");
  });
});

describe("defaultProductSpec", () => {
  it("produces a spec that is already clean, valid and wired", () => {
    const spec = defaultProductSpec({
      name: "Thumbnail Genie",
      tagline: "Great thumbnails in one click.",
      wires: { inputNodeId: "n1", actionNodeId: "n2", outputNodeId: "n3" }
    });

    expect(productSpecSchema.safeParse(spec).success).toBe(true);
    // Sanitizing an already-clean spec must not change a single thing.
    expect(sanitizeProductSpec(JSON.parse(JSON.stringify(spec)))).toEqual(spec);

    const roles = collectWires(spec).map((ref) => ref.wire.role);
    expect(roles).toContain("input");
    expect(roles).toContain("action");
    expect(roles).toContain("output");
    expect(spec.pages[0]).toMatchObject({ id: "home", path: "" });
  });

  it("stays valid with no information at all", () => {
    const spec = defaultProductSpec();
    expect(productSpecSchema.safeParse(spec).success).toBe(true);
    expect(specNodeCount(spec)).toBeLessThanOrEqual(PRODUCT_SPEC_LIMITS.maxNodesPerPage);
  });

  it("falls back to the amber brand when the accent is not a hex colour", () => {
    expect(defaultProductSpec({ accent: "amber" }).theme?.accent).toBe("#f59e0b");
    expect(defaultProductSpec({ accent: "#22C55E" }).theme?.accent).toBe("#22c55e");
  });
});
