import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { UiPreview } from "./ui-preview";
import { detectUiPreview } from "./ui-preview-source";

afterEach(cleanup);

function renderPreview(output: unknown) {
  const source = detectUiPreview(output);
  if (!source) throw new Error("expected a previewable source");
  render(<UiPreview source={source} nodeId="node-1" />);
  return source;
}

describe("UiPreview", () => {
  test("renders the generated page inside the frame", () => {
    renderPreview("<main><h1>Bright Smile Dental</h1></main>");

    const frame = screen.getByTestId("ui-preview-frame-node-1") as HTMLIFrameElement;
    expect(frame.getAttribute("srcdoc")).toContain("Bright Smile Dental");
  });

  test("sandboxes the frame without allow-same-origin", () => {
    renderPreview("<div><h1>Untrusted</h1><script>alert(1)</script></div>");

    const sandbox = screen.getByTestId("ui-preview-frame-node-1").getAttribute("sandbox") ?? "";

    // allow-scripts + allow-same-origin would let the frame drop its own
    // sandbox and reach the builder's DOM and storage.
    expect(sandbox).toContain("allow-scripts");
    expect(sandbox).not.toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-top-navigation");
  });

  test("switches between the rendered page and its source", () => {
    renderPreview({ html: "<section>Pricing</section>", css: "section { color: red }" });

    expect(screen.getByTestId("ui-preview-frame-node-1")).toBeTruthy();

    fireEvent.click(screen.getByTestId("ui-preview-tab-code-node-1"));

    expect(screen.queryByTestId("ui-preview-frame-node-1")).toBeNull();
    expect(screen.getByText(/section \{ color: red \}/)).toBeTruthy();
  });

  test("narrows the frame for the mobile device width", () => {
    renderPreview("<main><h1>Responsive</h1></main>");

    fireEvent.click(screen.getByTestId("ui-preview-device-mobile-node-1"));

    const frame = screen.getByTestId("ui-preview-frame-node-1") as HTMLIFrameElement;
    expect(frame.style.maxWidth).toBe("390px");
  });

  test("opens and closes the expanded overlay", () => {
    renderPreview("<main><h1>Full page</h1></main>");

    expect(screen.queryByTestId("ui-preview-overlay-node-1")).toBeNull();

    fireEvent.click(screen.getByTestId("ui-preview-fullscreen-node-1"));
    expect(screen.getByTestId("ui-preview-overlay-node-1")).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("ui-preview-overlay-node-1")).toBeNull();
  });

  test("keeps every test id unique while expanded", () => {
    renderPreview("<main><h1>Full page</h1></main>");

    fireEvent.click(screen.getByTestId("ui-preview-fullscreen-node-1"));

    // getBy* throws on more than one match — a duplicated toolbar or frame
    // would break Playwright's strict mode and run the page twice.
    expect(screen.getByTestId("ui-preview-frame-node-1")).toBeTruthy();
    expect(screen.getByTestId("ui-preview-tab-code-node-1")).toBeTruthy();
    expect(screen.getByTestId("ui-preview-device-mobile-node-1")).toBeTruthy();
  });
});
