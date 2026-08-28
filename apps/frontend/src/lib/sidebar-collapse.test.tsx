import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * ONE COLLAPSE, THREE SHELLS (2026-08-28).
 *
 * The founder asked for the fold-away menu button on the admin, the business
 * and the architect side. Writing it three times is how a platform ends up
 * with three sidebars that collapse three different ways — and this codebase
 * has spent a day paying for exactly that kind of duplication.
 *
 * This test is the rule: all three read the same hook and render the same
 * button. It fails the day somebody hand-rolls a fourth.
 */

const SHELLS = [
  { name: "admin", file: "../components/admin/ui/admin-shell.tsx", shell: "admin" },
  { name: "business", file: "../components/business/sidebar.tsx", shell: "business" },
  { name: "architect", file: "../components/architect/ui/Sidebar.tsx", shell: "architect" }
];

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");

describe("every shell folds its menu the same way", () => {
  for (const { name, file, shell } of SHELLS) {
    it(`${name} uses the shared collapse, not its own copy`, () => {
      const source = read(file);

      expect(source, `${name} must import the shared hook`).toContain(
        'from "@/lib/sidebar-collapse"'
      );
      expect(source, `${name} must use the shared button`).toContain("SidebarCollapseButton");
      expect(source, `${name} must name its own shell so the choice is remembered per side`)
        .toContain(`useSidebarCollapsed("${shell}")`);
    });

    it(`${name} gives the space back when the menu is folded`, () => {
      const source = read(file);
      /* A collapse that hides the sidebar and leaves the 256px gap is not a
         collapse — it is a blank column. */
      expect(source).toContain("lg:pl-0");
    });
  }
});
