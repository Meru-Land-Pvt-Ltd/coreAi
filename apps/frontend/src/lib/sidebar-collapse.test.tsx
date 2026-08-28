import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * COLLAPSED IS A RAIL, NOT A DISAPPEARANCE (2026-08-28).
 *
 * The first attempt hid the sidebar entirely and floated one generic button
 * at the top-left of the content. Two things were wrong with it, and the
 * founder named both: hiding the menu takes the navigation away along with
 * the width, and on the builder that floating button landed underneath the
 * fixed top strip, invisible.
 *
 * So: each side collapses to a 64-pixel icon rail — every destination still
 * one click from the eye, 192 pixels handed back — and each side carries its
 * own toggle on its own edge, in its own design. Only the MEMORY of the
 * choice is shared, because that is the only part that is genuinely the
 * same.
 */

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

const SHELLS = [
  {
    name: "admin",
    shell: "admin",
    sidebar: "../components/admin/ui/admin-sidebar.tsx",
    frame: "../components/admin/ui/admin-shell.tsx"
  },
  {
    name: "business",
    shell: "business",
    sidebar: "../components/business/sidebar.tsx",
    frame: "../components/business/sidebar.tsx"
  },
  {
    name: "architect",
    shell: "architect",
    sidebar: "../components/architect/ui/Sidebar.tsx",
    frame: "../components/architect/ui/Sidebar.tsx"
  }
];

describe("every side collapses to an icon rail", () => {
  for (const { name, shell, sidebar, frame } of SHELLS) {
    it(`${name} keeps a 64px rail instead of vanishing`, () => {
      expect(read(sidebar), `${name} must keep a rail, not disappear`).toMatch(/w-16/);
    });

    it(`${name} leaves room for the rail, not a blank column`, () => {
      const source = read(frame);
      expect(source, `${name} content must sit beside the rail`).toContain("lg:pl-16");
      expect(source, `${name} must not collapse to zero — that is hiding, not collapsing`)
        .not.toContain("lg:pl-0");
    });

    it(`${name} carries its own toggle, on its own edge`, () => {
      /* Not one shared button floated over three different designs — that is
         how it ended up buried under the builder's top strip. */
      expect(read(sidebar)).toContain(`data-testid="${shell}-sidebar-toggle"`);
    });

    it(`${name} remembers the choice through the one shared hook`, () => {
      /* The look belongs to each side. The memory does not need three
         copies. */
      expect(read(frame)).toContain(`useSidebarCollapsed("${shell}")`);
    });
  }
});
