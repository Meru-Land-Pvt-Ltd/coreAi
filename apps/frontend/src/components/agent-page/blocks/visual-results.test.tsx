import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { VisualResultsPayload } from "@coreai/shared";
import { VisualResults } from "./visual-results";
import { OutputStageBlock, type FaceRunResult } from "./output-stage";

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

  it("renders a pie chart with a legend row per slice", () => {
    const payload: VisualResultsPayload = {
      chart: { type: "pie", series: [{ label: "A", value: 3 }, { label: "B", value: 1 }] }
    };
    render(<VisualResults payload={payload} accent="#f59e0b" />);
    const legend = screen.getByTestId("agent-visual-pie-legend");
    expect(within(legend).getAllByRole("listitem")).toHaveLength(2);
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

  it("renders nothing when the payload has no structured content", () => {
    const { container } = render(<VisualResults payload={{ text: "only prose" }} accent="#f59e0b" />);
    expect(container.querySelector("[data-testid='agent-block-visual-results']")).toBeNull();
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
