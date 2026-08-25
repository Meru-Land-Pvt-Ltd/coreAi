/**
 * WHICH NODES HAVE A WORLD OF THEIR OWN.
 *
 * A node's settings belong to that node, not to the sidebar. The sidebar used
 * to grow by one entry every time a node gained a setting — "AI models",
 * "Design Brain rules", "Builder nodes" — and within a year an admin would be
 * hunting through twenty items trying to remember which node each belonged to.
 *
 * So the sidebar keeps one entry, Nodes, and anything that configures a node
 * lives at /admin/nodes/<type>. Same rule as docs/NODE-SOP.md question 5: one
 * node, one home for its settings.
 *
 * A node only appears here once it has something worth opening. A "Settings"
 * link that leads to an empty page teaches an admin not to click links.
 */

export type NodeSettingsPage = {
  /** What the link says, and the heading on the page. */
  title: string;
  /** One line telling an admin what they will find, before they click. */
  summary: string;
};

export const NODE_SETTINGS_PAGES: Record<string, NodeSettingsPage> = {
  "ai.llm_call": {
    title: "Models",
    summary: "Which AI models architects can pick, and adding new ones without a release."
  },
  "ai.memory": {
    title: "Limits",
    summary: "How long memory is kept, how much a brain reads per answer, and the biggest file it will read."
  },
  "logic.condition": {
    title: "Limits",
    summary: "How many roads out one Condition may have."
  }
};

export function nodeSettingsPage(nodeType: string): NodeSettingsPage | null {
  return NODE_SETTINGS_PAGES[nodeType] ?? null;
}

export function hasNodeSettingsPage(nodeType: string): boolean {
  return nodeType in NODE_SETTINGS_PAGES;
}
