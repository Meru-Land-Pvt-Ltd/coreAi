/* TEMPORARY visual harness — deleted before hand-off. Renders the real
   components to HTML so they can be looked at in a browser. */
import { describe, it } from "vitest";
import { render } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { VisualResults } from "./visual-results";

const OUT = "/tmp/claude-0/-root/84ae767b-fc46-4cca-b15c-e4a8d1ff5012/scratchpad";

const payload = {
  stats: [
    { label: "Total revenue", value: "$128,430", delta: "+12.4% vs last month" },
    { label: "Active subscribers", value: "8,412", delta: "+318" },
    { label: "Churn rate", value: "2.1%", delta: "-0.4%", deltaDir: "down" as const },
    { label: "Avg order value", value: "$64.20", delta: "same as last week" }
  ],
  chart: {
    type: "bar" as const,
    title: "Revenue by month",
    series: [
      { label: "Jan", value: 820 },
      { label: "Feb", value: 932 },
      { label: "Mar", value: 901 },
      { label: "Apr", value: 1134 },
      { label: "May", value: 1290 },
      { label: "Jun", value: 1330 }
    ]
  },
  table: {
    columns: ["Customer", "Plan", "Seats", "MRR", "Renews"],
    rows: [
      ["Northwind Traders", "Enterprise", "240", "$4,800", "12 Sep"],
      ["Acme Corporation", "Growth", "48", "$960", "3 Oct"],
      ["Globex", "Growth", "36", "$720", "N/A"],
      ["Initech Systems Group Limited", "Starter", "12", "$240", "19 Sep"],
      ["Umbrella Health", "Enterprise", "180", "$3,600", "(missing)"]
    ]
  }
};

const lineChart = {
  ...payload,
  stats: undefined,
  table: undefined,
  chart: {
    type: "line" as const,
    title: "Daily active users",
    series: [
      { label: "Mon", value: 420 },
      { label: "Tue", value: 512 },
      { label: "Wed", value: 486 },
      { label: "Thu", value: 634 },
      { label: "Fri", value: 712 },
      { label: "Sat", value: 380 },
      { label: "Sun", value: 344 }
    ]
  }
};

const pieChart = {
  chart: {
    type: "pie" as const,
    title: "Where signups come from",
    series: [
      { label: "Organic search", value: 4200 },
      { label: "Referral", value: 2100 },
      { label: "Paid ads", value: 1400 },
      { label: "Social", value: 900 }
    ]
  }
};

describe("harness", () => {
  it("writes html", () => {
    const parts: string[] = [];
    for (const [name, p] of [
      ["full", payload],
      ["line", lineChart],
      ["pie", pieChart]
    ] as const) {
      const { container, unmount } = render(
        <VisualResults payload={p as never} accent="#f59e0b" />
      );
      parts.push(`<!-- ${name} -->` + container.innerHTML);
      unmount();
    }
    writeFileSync(`${OUT}/visual-body.html`, parts.join("\n"));
  });
});
