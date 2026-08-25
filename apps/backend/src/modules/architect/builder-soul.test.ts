import { describe, expect, it } from "vitest";
import { getNodeDefinition } from "@coreai/shared";
import {
  SOUL_COVERED_TYPES,
  builderSoulFiles,
  builderSoulText,
  soulBones,
  soulPages
} from "./builder-soul";

/**
 * THE LAW OF THE SOUL: no node is finished until its wisdom page exists.
 *
 * This is what makes the Builder compound instead of decay — the day a node
 * ships without its page, this suite goes red and the node is not done.
 */

describe("the Builder Soul", () => {
  it("every perfected node has a wisdom page, and no page teaches a ghost", () => {
    const pages = soulPages();
    const taught = new Set(pages.map((page) => page.nodeType).filter(Boolean));
    for (const type of SOUL_COVERED_TYPES) {
      expect(taught.has(type), `${type} has no Soul page — the node is not done`).toBe(true);
      expect(getNodeDefinition(type), `${type} is in the Soul but not the registry`).toBeTruthy();
    }
    for (const type of taught) {
      expect(getNodeDefinition(type as string), `Soul page teaches unknown node ${type}`).toBeTruthy();
    }
  });

  it("every wisdom page says something substantial", () => {
    for (const page of soulPages()) {
      expect(page.body.length, `${page.slug} is too thin to teach anything`).toBeGreaterThan(300);
      expect(page.title).toBeTruthy();
    }
  });

  it("the bones are generated from the registry, settings included", () => {
    const bones = soulBones();
    for (const type of SOUL_COVERED_TYPES) {
      const definition = getNodeDefinition(type);
      expect(bones).toContain(`(${type})`);
      for (const setting of definition?.settings ?? []) {
        // The same words the panels read — one fact, one home.
        expect(bones).toContain(setting.name);
      }
    }
    expect(bones).not.toContain("MISSING FROM THE REGISTRY");
  });

  it("the assembled Soul carries the laws, the wisdom and the bones", () => {
    const text = builderSoulText();
    expect(text).toContain("THE PLATFORM'S LAWS");
    expect(text).toContain("Combinations that work");
    expect(text).toContain("THE BONES");
    // Big enough to teach, small enough to ride with every request.
    expect(text.length).toBeGreaterThan(8_000);
    expect(text.length).toBeLessThan(60_000);
  });

  it("the zip holds the readme, every page, and the bones", () => {
    const files = builderSoulFiles();
    const names = files.map((file) => file.name);
    expect(names).toContain("README.md");
    expect(names).toContain("BONES.md");
    for (const page of soulPages()) expect(names).toContain(`${page.slug}.md`);
    for (const file of files) expect(file.content.trim().length).toBeGreaterThan(0);
  });
});
