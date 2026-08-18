import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { VisualResultsPayload } from "@coreai/shared";
import { VisualResults } from "./visual-results";
import { OutputStageBlock, type FaceRunResult } from "./output-stage";
import { displayValue, isNumericColumn, isNumericValue } from "./visual-format";
import { visualPalette } from "./visual-palette";

afterEach(cleanup);

describe("VisualResults", () => {
  it("renders stat cards with label, value, and an up delta", () => {
    const payload: VisualResultsPayload = {
      stats: [{ label: "Subscribers", value: "312M", delta: "+1.2M", deltaDir: "up" }]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const card = screen.getByTestId("agent-visual-stat");
    expect(within(card).getByText("Subscribers")).toBeTruthy();
    expect(within(card).getByText("312M")).toBeTruthy();
    expect(within(card).getByText("+1.2M")).toBeTruthy();
  });

  it("lays stat cards out as a responsive grid, two up on a phone", () => {
    const payload: VisualResultsPayload = {
      stats: [
        { label: "Views", value: "1,200" },
        { label: "Likes", value: "310" },
        { label: "Shares", value: "44" },
        { label: "Saves", value: "18" }
      ]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const grid = screen.getByTestId("agent-visual-stats");
    expect(grid.className).toContain("grid");
    expect(grid.className).toContain("grid-cols-2");
    expect(grid.className).toContain("lg:grid-cols-4");
    expect(screen.getAllByTestId("agent-visual-stat")).toHaveLength(4);
  });

  it("keeps three stats on a three-column grid so the last one is not an orphan", () => {
    const payload: VisualResultsPayload = {
      stats: [
        { label: "A", value: "1" },
        { label: "B", value: "2" },
        { label: "C", value: "3" }
      ]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    expect(screen.getByTestId("agent-visual-stats").className).toContain("lg:grid-cols-3");
  });

  it("sets the stat value in tabular figures so numbers line up", () => {
    const payload: VisualResultsPayload = { stats: [{ label: "Views", value: "1,200" }] };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    expect(screen.getByTestId("agent-visual-stat-value").className).toContain("tabular-nums");
  });

  it("renders a delta as a pill that carries its direction, up and down", () => {
    const payload: VisualResultsPayload = {
      stats: [
        { label: "Views", value: "1,200", delta: "+12%", deltaDir: "up" },
        { label: "Churn", value: "3%", delta: "-4%", deltaDir: "down" }
      ]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const pills = screen.getAllByTestId("agent-visual-stat-delta");
    expect(pills).toHaveLength(2);
    expect(pills[0].getAttribute("data-delta-dir")).toBe("up");
    expect(pills[1].getAttribute("data-delta-dir")).toBe("down");
    // A pill, never bare text.
    expect(pills[0].className).toContain("rounded-full");
    expect(pills[0].className).toContain("border");
  });

  it("reads the delta direction from the text when the payload does not declare one", () => {
    const payload: VisualResultsPayload = {
      stats: [
        { label: "Down", value: "5", delta: "-2" },
        { label: "Flat", value: "5", delta: "same as last week" }
      ]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const pills = screen.getAllByTestId("agent-visual-stat-delta");
    expect(pills[0].getAttribute("data-delta-dir")).toBe("down");
    expect(pills[1].getAttribute("data-delta-dir")).toBe("flat");
  });

  it("shows a quiet dash for an empty stat value, never N/A", () => {
    const payload: VisualResultsPayload = {
      stats: [
        { label: "Revenue", value: "N/A" },
        { label: "Cost", value: "(missing)" }
      ]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const values = screen.getAllByTestId("agent-visual-stat-value");
    expect(values.map((node) => node.textContent)).toEqual(["—", "—"]);
    expect(screen.queryByText("N/A")).toBeNull();
    expect(screen.queryByText("(missing)")).toBeNull();
  });

  it("drops the delta pill entirely when the delta is an empty placeholder", () => {
    const payload: VisualResultsPayload = {
      stats: [{ label: "Revenue", value: "1,200", delta: "n/a" }]
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    expect(screen.queryByTestId("agent-visual-stat-delta")).toBeNull();
  });

  it("gives a long stat value a title so nothing is lost when it truncates", () => {
    const long = "1,234,567,890,123";
    render(<VisualResults payload={{ stats: [{ label: "Total", value: long }] }} accent="#f59e0b" />);
    const value = screen.getByTestId("agent-visual-stat-value");
    expect(value.className).toContain("truncate");
    expect(value.getAttribute("title")).toBe(long);
  });

  it("renders a bar chart as one accessible image", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "bar", title: "Views", series: [{ label: "Jan", value: 1200 }, { label: "Feb", value: 800 }] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const chart = screen.getByTestId("agent-visual-chart");
    expect(chart.getAttribute("data-chart-type")).toBe("bar");
    const img = within(chart).getByRole("img");
    expect(img.getAttribute("aria-label")).toContain("Jan: 1200");
  });

  it("draws the chart on an inline svg grid with quiet value labels", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "bar", title: "Views", series: [{ label: "Jan", value: 1200 }, { label: "Feb", value: 800 }] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const chart = screen.getByTestId("agent-visual-chart");
    // Self-contained SVG, no chart library.
    expect(within(chart).getByTestId("agent-visual-chart-svg").tagName.toLowerCase()).toBe("svg");
    const grid = within(chart).getByTestId("agent-visual-gridlines");
    expect(grid.querySelectorAll("line").length).toBeGreaterThanOrEqual(3);
    // Honest axis labels on a round step that actually fills the plot: the
    // tallest bar here is the axis maximum, not three fifths of it.
    expect(within(chart).getByText("0")).toBeTruthy();
    expect(within(chart).getByText("600")).toBeTruthy();
    // Twice over: once as the axis top, once as the tallest bar's own label.
    expect(within(chart).getAllByText("1.2K")).toHaveLength(2);
  });

  it("scales the axis so the tallest bar nearly fills the plot", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "bar", series: [{ label: "A", value: 1490 }, { label: "B", value: 300 }] }
    };
    const { container } = render(<VisualResults payload={payload} accent="#f59e0b" />);
    const bars = container.querySelectorAll<HTMLElement>(".agent-visual-bar");
    // 1490 against an axis top of 1600 — over 90%, not the 74% a coarse
    // 1 / 2 / 5 rounding would have given it.
    expect(Number.parseFloat(bars[0].style.height)).toBeGreaterThan(90);
  });

  it("keeps whole-number gridlines for a small whole-number series", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "bar", series: [{ label: "A", value: 3 }, { label: "B", value: 1 }] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const chart = screen.getByTestId("agent-visual-chart");
    for (const tick of ["0", "1", "2", "3", "4"]) {
      expect(within(chart).getAllByText(tick).length).toBeGreaterThan(0);
    }
  });

  it("gives the chart a title and an honest note about the data", () => {
    const payload: VisualResultsPayload = {
      chart: {
        type: "bar",
        title: "Views by video",
        series: [{ label: "Intro", value: 1200 }, { label: "Outro", value: 800 }]
      }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    expect(screen.getByTestId("agent-visual-chart-title").textContent).toBe("Views by video");
    const note = screen.getByTestId("agent-visual-chart-note").textContent ?? "";
    expect(note).toContain("2 values");
    expect(note).toContain("Intro");
  });

  it("truncates a long x label but keeps the full text on hover", () => {
    const label = "A very long category label indeed";
    const payload: VisualResultsPayload = {
      chart: { type: "bar", series: [{ label, value: 10 }, { label: "B", value: 4 }] }
    };
    const { container } = render(<VisualResults payload={payload} accent="#f59e0b" />);
    const tick = container.querySelector(`[title="${label}"].truncate`);
    expect(tick).toBeTruthy();
  });

  it("renders a line chart with a soft area gradient and a dot per point", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "line", series: [{ label: "Mon", value: 3 }, { label: "Tue", value: 9 }] }
    };
    const { container } = render(<VisualResults payload={payload} accent="#f59e0b" />);
    expect(screen.getByTestId("agent-visual-chart").getAttribute("data-chart-type")).toBe("line");
    expect(container.querySelector("linearGradient")).toBeTruthy();
    expect(container.querySelectorAll(".agent-visual-dot")).toHaveLength(2);
  });

  it("renders a pie chart as a donut with a legend row per slice", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "pie", series: [{ label: "A", value: 3 }, { label: "B", value: 1 }] }
    };
    const { container } = render(<VisualResults payload={payload} accent="#f59e0b" />);
    const legend = screen.getByTestId("agent-visual-pie-legend");
    expect(within(legend).getAllByRole("listitem")).toHaveLength(2);
    // A donut, not a pie: slices are stroked rings, and the hole shows a total.
    expect(container.querySelectorAll("circle.agent-visual-slice")).toHaveLength(2);
    expect(within(screen.getByTestId("agent-visual-pie")).getByText("4")).toBeTruthy();
  });

  it("renders a data table with headers and rows", () => {
    const payload: VisualResultsPayload = {
      table: { columns: ["Video", "Views"], rows: [["Intro", "1,200"], ["Outro", "900"]] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const table = screen.getByTestId("agent-visual-table");
    expect(within(table).getByText("Video")).toBeTruthy();
    expect(within(table).getAllByRole("row")).toHaveLength(3); // header + 2 rows
  });

  it("right-aligns numeric columns in tabular figures and leaves text columns alone", () => {
    const payload: VisualResultsPayload = {
      table: { columns: ["Video", "Views"], rows: [["Intro", "1,200"], ["Outro", "900"]] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const table = screen.getByTestId("agent-visual-table");
    const headers = within(table).getAllByRole("columnheader");
    expect(headers[0].getAttribute("data-numeric")).toBe("false");
    expect(headers[1].getAttribute("data-numeric")).toBe("true");
    expect(headers[1].className).toContain("text-right");

    const cells = within(table).getAllByRole("cell");
    expect(cells[0].getAttribute("data-numeric")).toBe("false");
    expect(cells[0].className).not.toContain("text-right");
    expect(cells[1].getAttribute("data-numeric")).toBe("true");
    expect(cells[1].className).toContain("text-right");
    expect(cells[1].className).toContain("tabular-nums");
  });

  it("shows a quiet dash for an empty table cell", () => {
    const payload: VisualResultsPayload = {
      table: { columns: ["Video", "Views"], rows: [["Intro", ""], ["Outro", "N/A"]] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const cells = within(screen.getByTestId("agent-visual-table")).getAllByRole("cell");
    expect(cells[1].textContent).toBe("—");
    expect(cells[3].textContent).toBe("—");
    // A column of nothing but blanks is not a numeric column.
    expect(cells[1].getAttribute("data-numeric")).toBe("false");
  });

  it("captions a long table with an honest row count", () => {
    const rows = Array.from({ length: 6 }, (_, i) => [`Row ${i}`, String(i)]);
    render(<VisualResults payload={{ table: { columns: ["Name", "N"], rows } }} accent="#f59e0b" />);
    expect(screen.getByTestId("agent-visual-table-caption").textContent).toBe("6 rows");
  });

  it("takes a caption from the caller when one is given", () => {
    const payload: VisualResultsPayload = {
      table: { columns: ["Name", "N"], rows: [["A", "1"]] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" tableCaption="Top videos this week" />);
    expect(screen.getByTestId("agent-visual-table-caption").textContent).toBe("Top videos this week");
  });

  it("renders nothing when the payload has no structured content", () => {
    const { container } = render(<VisualResults payload={{ text: "only prose" }} accent="#f59e0b" />);
    expect(container.querySelector("[data-testid='agent-block-visual-results']")).toBeNull();
  });
});

describe("visual formatting rules", () => {
  it("maps every flavour of missing to one quiet dash", () => {
    for (const blank of ["", "  ", "N/A", "n/a", "null", "undefined", "(missing)", "unknown", "-"]) {
      expect(displayValue(blank)).toBe("—");
    }
  });

  it("leaves a real value alone, including a legitimate zero", () => {
    expect(displayValue("0")).toBe("0");
    expect(displayValue(" 1,200 ")).toBe("1,200");
    expect(displayValue("None")).toBe("None");
  });

  it("recognises the shapes a number actually arrives in", () => {
    for (const value of ["1200", "1,200", "$1,200.00", "12.5%", "1.2M", "(4.5)", "-8"]) {
      expect(isNumericValue(value)).toBe(true);
    }
    for (const value of ["Intro", "3 videos", "", "N/A"]) {
      expect(isNumericValue(value)).toBe(false);
    }
  });

  it("calls a column numeric only when every value it has is a number", () => {
    const rows = [["Intro", "1,200"], ["Outro", ""], ["Teaser", "900"]];
    expect(isNumericColumn(rows, 0)).toBe(false);
    expect(isNumericColumn(rows, 1)).toBe(true);
    expect(isNumericColumn([["", ""]], 1)).toBe(false);
  });
});

describe("visual palette", () => {
  it("derives an on-brand slice ramp from the page accent", () => {
    const palette = visualPalette("#f59e0b");
    expect(palette.ramp).toHaveLength(8);
    expect(new Set(palette.ramp).size).toBe(8);
    for (const color of palette.ramp) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("reads neutrals through the product-spec variables so themed pages match", () => {
    expect(visualPalette("#f59e0b", "base").ink).toContain("var(--spec-ink");
    expect(visualPalette("#f59e0b", "dark").ink).toContain("var(--spec-inverse-ink");
  });

  it("walks a pale accent to something legible as text", () => {
    const palette = visualPalette("#fef08a");
    // The fill keeps the architect's exact colour; the ink does not.
    expect(palette.accent).toBe("#fef08a");
    expect(palette.accentInk).not.toBe("#fef08a");
  });

  it("falls back to the brand amber when the accent is not a colour", () => {
    expect(visualPalette("not-a-color").accent).toBe("#f59e0b");
  });
});

describe("OutputStageBlock structured seam", () => {
  const base: FaceRunResult = {
    id: 1,
    displayPrompt: "channel stats",
    basePrompt: "channel stats",
    text: "Here are the numbers.",
    mediaUrls: []
  };

  it("renders the visual payload from a run result", () => {
    const result: FaceRunResult = {
      ...base,
      structured: { text: "Here are the numbers.", stats: [{ label: "Views", value: "1000" }] }
    };
    render(
      <OutputStageBlock
        kind="auto"
        runningPrompt={null}
        result={result}
        listingName="YouTube Stats"
        error={null}
      />
    );
    // The prose still shows, and the stat card renders alongside it.
    expect(screen.getByTestId("agent-block-output-text")).toBeTruthy();
    expect(screen.getByTestId("agent-block-visual-results")).toBeTruthy();
    expect(screen.getByText("Views")).toBeTruthy();
    expect(screen.getByText("1000")).toBeTruthy();
  });

  it("still renders plain text when there is no structured payload", () => {
    render(
      <OutputStageBlock
        kind="auto"
        runningPrompt={null}
        result={{ ...base, structured: null }}
        listingName="Plain"
        error={null}
      />
    );
    expect(screen.getByTestId("agent-block-output-text")).toBeTruthy();
    expect(screen.queryByTestId("agent-block-visual-results")).toBeNull();
  });
});
