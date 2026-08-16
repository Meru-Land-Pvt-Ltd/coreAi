import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Product Spec storage and public resolution. Prisma is mocked — these are
 * contract tests for the load/save round-trip and, most importantly, for the
 * backward-compatibility path: an agent published before the Product Spec
 * existed must still resolve to a complete, wired product.
 */

const { pageFindUniqueMock, pageUpdateMock, workflowFindUniqueMock } = vi.hoisted(() => ({
  pageFindUniqueMock: vi.fn(),
  pageUpdateMock: vi.fn(),
  workflowFindUniqueMock: vi.fn()
}));

vi.mock("../../lib/prisma", () => ({
  prisma: {
    publishedAgentPage: { findUnique: pageFindUniqueMock, update: pageUpdateMock },
    workflowDefinition: { findUnique: workflowFindUniqueMock }
  }
}));

import { collectWires, defaultProductSpec, productSpecSchema, type ProductSpec } from "@coreai/shared";
import {
  ProductSpecRejectedError,
  getProductSpec,
  productSpecFromBlueprint,
  resolveProductForPublic,
  saveProductSpec,
  starterProductSpec
} from "./product-spec-service";

const listingRow = {
  id: "listing-1",
  name: "Thumbnail Genie",
  tagline: "Great thumbnails in one click.",
  shortDescription: "Turns a rough idea into a finished YouTube thumbnail.",
  iconUrl: "https://cdn.example.com/icon.png",
  category: "Creative",
  pricingModel: "SUBSCRIPTION",
  priceCents: 1900,
  freeTrialEnabled: true,
  trialDays: 7,
  status: "APPROVED",
  architect: {
    fullName: "Dana Ray",
    architectProfile: { displayName: "Dana R.", marketplacePhotoUrl: "https://cdn.example.com/dana.png" }
  }
};

const pageRow = {
  id: "page-1",
  slug: "thumbnail-genie-abc123",
  listingId: "listing-1",
  workflowId: "workflow-1",
  architectUserId: "architect-1",
  template: "media",
  headline: "Thumbnails that get clicked",
  welcomeMessage: "Describe the video and get three thumbnails.",
  suggestedPrompts: ["A cooking video about ramen"],
  accentColor: "#22c55e",
  designJson: null as unknown,
  productJson: null as unknown,
  status: "LIVE",
  listing: listingRow
};

/** A real builder graph: block.* nodes carry their slug on data.type. */
const blockWorkflowJson = {
  nodes: [
    {
      id: "composer-1",
      type: "coreNode",
      position: { x: 0, y: 0 },
      data: { type: "block.prompt_composer", placeholder: "Describe your video" }
    },
    {
      id: "picker-1",
      type: "coreNode",
      position: { x: 0, y: 100 },
      data: { type: "block.model_picker", options: [{ id: "fast", label: "Fast" }, { id: "pro", label: "Pro" }] }
    },
    {
      id: "run-1",
      type: "coreNode",
      position: { x: 0, y: 200 },
      data: { type: "block.action_button", label: "Make thumbnails" }
    },
    {
      id: "again-1",
      type: "coreNode",
      position: { x: 0, y: 260 },
      data: { type: "block.continue_chain", label: "Try again" }
    },
    {
      id: "stage-1",
      type: "coreNode",
      position: { x: 0, y: 320 },
      data: { type: "block.output_stage", kind: "image" }
    }
  ],
  edges: []
};

beforeEach(() => {
  vi.clearAllMocks();
  pageFindUniqueMock.mockResolvedValue({ ...pageRow });
  workflowFindUniqueMock.mockResolvedValue({ workflowJson: blockWorkflowJson });
  pageUpdateMock.mockImplementation(async ({ data }: { data: { productJson: unknown } }) => ({
    ...pageRow,
    productJson: data.productJson
  }));
});

describe("getProductSpec", () => {
  it("returns null when the page has no spec", () => {
    expect(getProductSpec(null)).toBeNull();
    expect(getProductSpec(undefined)).toBeNull();
    expect(getProductSpec({ productJson: null })).toBeNull();
    expect(getProductSpec({})).toBeNull();
  });

  it("parses, sanitizes and returns a stored spec", () => {
    const stored = {
      version: 1,
      pages: [
        {
          id: "home",
          title: "Home",
          path: "",
          blocks: [
            { id: "h", type: "heading", text: "Hello", level: 42 },
            { id: "junk", type: "wormhole" }
          ]
        }
      ],
      nav: { links: [], footerLinks: [] }
    };

    const spec = getProductSpec({ productJson: stored }) as ProductSpec;
    expect(spec.pages[0].blocks).toEqual([{ id: "h", type: "heading", text: "Hello" }]);
  });

  it("recovers a spec that was stored as a JSON string", () => {
    const spec = getProductSpec({ productJson: JSON.stringify(defaultProductSpec({ name: "X" })) });
    expect(spec?.pages[0].id).toBe("home");
  });

  it("returns null for stored garbage instead of throwing", () => {
    expect(getProductSpec({ productJson: "not json at all" })).toBeNull();
    expect(getProductSpec({ productJson: 42 })).toBeNull();
    expect(getProductSpec({ productJson: { pages: "nope" } })).toBeNull();
  });
});

describe("saveProductSpec", () => {
  it("round-trips: what is saved is exactly what reads back", async () => {
    const spec = defaultProductSpec({ name: "Thumbnail Genie", wires: { actionNodeId: "run-1" } });

    const saved = await saveProductSpec("page-1", spec);

    expect(saved).toEqual(spec);
    expect(pageUpdateMock).toHaveBeenCalledWith({
      where: { id: "page-1" },
      data: { productJson: saved }
    });
    expect(getProductSpec({ productJson: pageUpdateMock.mock.calls[0][0].data.productJson })).toEqual(spec);
  });

  it("stores the cleaned spec, not the raw one", async () => {
    const saved = await saveProductSpec("page-1", {
      version: 99,
      pages: [
        {
          id: "Home Page",
          title: "Home",
          blocks: [
            { id: "keep", type: "heading", text: "Kept" },
            { id: "drop", type: "heading", text: "  " }
          ]
        }
      ],
      nav: { links: [{ label: "Nowhere", pageId: "ghost" }], footerLinks: [] }
    });

    expect(saved.version).toBe(1);
    expect(saved.pages[0]).toMatchObject({ id: "home", path: "" });
    expect(saved.pages[0].blocks).toHaveLength(1);
    expect(saved.nav.links).toEqual([]);
  });

  it("refuses to overwrite a working product with an empty one", async () => {
    await expect(saveProductSpec("page-1", { version: 1, pages: [] })).rejects.toBeInstanceOf(
      ProductSpecRejectedError
    );
    expect(pageUpdateMock).not.toHaveBeenCalled();
  });
});

describe("productSpecFromBlueprint", () => {
  it("wires every canvas block to the node it came from", () => {
    const spec = productSpecFromBlueprint({
      template: "media",
      headline: "Thumbnails that get clicked",
      listingName: "Thumbnail Genie",
      shortDescription: listingRow.shortDescription,
      blueprint: {
        blocks: [
          { nodeId: "composer-1", type: "block.prompt_composer", config: { placeholder: "Describe your video" } },
          { nodeId: "run-1", type: "block.action_button", config: { label: "Make thumbnails" } },
          { nodeId: "stage-1", type: "block.output_stage", config: { kind: "image" } }
        ]
      }
    });

    expect(productSpecSchema.safeParse(spec).success).toBe(true);
    expect(collectWires(spec).map((ref) => [ref.nodeType, ref.wire.role, ref.wire.nodeId])).toEqual([
      ["input", "input", "composer-1"],
      ["button", "action", "run-1"],
      ["result", "output", "stage-1"]
    ]);
  });

  it("gives an agent with no blocks a working default surface", () => {
    const spec = productSpecFromBlueprint({
      template: "chat",
      listingName: "Front Desk",
      suggestedPrompts: ["Book me in for Tuesday"],
      blueprint: null
    });

    const wires = collectWires(spec);
    expect(wires.map((ref) => ref.wire.role)).toEqual(["input", "input", "action", "output"]);
    // No canvas node id: the wire means "the agent's main chain".
    expect(wires.every((ref) => ref.wire.nodeId === undefined)).toBe(true);
  });

  it("skips block types it cannot paint rather than breaking the page", () => {
    const spec = productSpecFromBlueprint({
      listingName: "Future Agent",
      blueprint: {
        blocks: [
          { nodeId: "x1", type: "block.time_machine", config: {} },
          { nodeId: "run-1", type: "block.action_button", config: { label: "Go" } }
        ]
      }
    });

    expect(collectWires(spec).map((ref) => ref.wire.nodeId)).toEqual(["run-1"]);
  });

  it("never lets an unsafe icon url reach the page", () => {
    const spec = productSpecFromBlueprint({
      listingName: "Sketchy",
      iconUrl: "javascript:alert(1)",
      blueprint: null
    });

    expect(JSON.stringify(spec)).not.toContain("javascript:");
    expect(productSpecSchema.safeParse(spec).success).toBe(true);
  });
});

describe("resolveProductForPublic", () => {
  it("synthesizes a product for a page that has no stored spec", async () => {
    const resolved = await resolveProductForPublic("thumbnail-genie-abc123");

    expect(resolved).not.toBeNull();
    expect(resolved?.source).toBe("blueprint");
    expect(resolved?.product.pages[0].id).toBe("home");
    expect(resolved?.product.theme?.accent).toBe("#22c55e");
    // The blueprint payload still rides along for blueprint-era callers.
    expect(resolved?.blueprint?.blocks.map((block) => block.nodeId)).toEqual([
      "composer-1",
      "picker-1",
      "run-1",
      "again-1",
      "stage-1"
    ]);
    expect(collectWires(resolved!.product).map((ref) => ref.wire.nodeId)).toEqual([
      "composer-1",
      "picker-1",
      "run-1",
      "again-1",
      "stage-1"
    ]);
    expect(resolved?.listing).toMatchObject({ id: "listing-1", name: "Thumbnail Genie", priceCents: 1900 });
    expect(resolved?.architect).toEqual({ displayName: "Dana R.", photoUrl: "https://cdn.example.com/dana.png" });
    expect(resolved?.design.theme).toBe("light");
  });

  it("prefers the stored spec once the architect has designed one", async () => {
    const stored = defaultProductSpec({ name: "Designed By Hand", accent: "#2563eb" });
    pageFindUniqueMock.mockResolvedValue({ ...pageRow, productJson: stored });

    const resolved = await resolveProductForPublic("thumbnail-genie-abc123");

    expect(resolved?.source).toBe("spec");
    expect(resolved?.product).toEqual(stored);
  });

  it("falls back to synthesis when the stored spec is unsalvageable", async () => {
    pageFindUniqueMock.mockResolvedValue({ ...pageRow, productJson: { pages: [{ id: "home", blocks: [] }] } });

    const resolved = await resolveProductForPublic("thumbnail-genie-abc123");

    expect(resolved?.source).toBe("blueprint");
    expect(resolved?.product.pages).toHaveLength(1);
  });

  it("resolves without a workflow row at all", async () => {
    workflowFindUniqueMock.mockResolvedValue(null);

    const resolved = await resolveProductForPublic("thumbnail-genie-abc123");

    expect(resolved?.blueprint).toBeNull();
    expect(productSpecSchema.safeParse(resolved?.product).success).toBe(true);
    expect(collectWires(resolved!.product).length).toBeGreaterThan(0);
  });

  it("returns null for a missing, unpublished or unapproved page", async () => {
    pageFindUniqueMock.mockResolvedValue(null);
    expect(await resolveProductForPublic("nope")).toBeNull();

    pageFindUniqueMock.mockResolvedValue({ ...pageRow, status: "SUSPENDED" });
    expect(await resolveProductForPublic("thumbnail-genie-abc123")).toBeNull();

    pageFindUniqueMock.mockResolvedValue({ ...pageRow, listing: { ...listingRow, status: "PENDING" } });
    expect(await resolveProductForPublic("thumbnail-genie-abc123")).toBeNull();
  });
});

describe("starterProductSpec", () => {
  it("uses the real canvas blocks when the agent has them", () => {
    const spec = starterProductSpec({
      listingName: "Thumbnail Genie",
      blueprint: { blocks: [{ nodeId: "run-1", type: "block.action_button", config: { label: "Go" } }] }
    });

    expect(collectWires(spec)).toEqual([
      { pageId: "home", pagePath: "", specNodeId: "blk-run-1", nodeType: "button", wire: { role: "action", nodeId: "run-1" } }
    ]);
  });

  it("falls back to the generic starter when there is nothing to read", () => {
    const spec = starterProductSpec({});
    expect(productSpecSchema.safeParse(spec).success).toBe(true);
    expect(spec.pages[0].id).toBe("home");
  });
});
