import { describe, expect, test } from "vitest";
import { detectUiPreview, isMarkupField } from "./ui-preview-source";

describe("detectUiPreview", () => {
  test("renders a Code node returning a bare HTML fragment", () => {
    const source = detectUiPreview("<div class='card'><h1>Bright Smile</h1></div>");

    expect(source?.language).toBe("html");
    expect(source?.document).toContain("<!doctype html>");
    expect(source?.document).toContain("Bright Smile");
    expect(source?.code).toBe("<div class='card'><h1>Bright Smile</h1></div>");
  });

  test("keeps a full document as-is instead of nesting a second <html>", () => {
    const page = "<!doctype html><html><head><title>Site</title></head><body><h1>Hi</h1></body></html>";
    const source = detectUiPreview(page);

    expect(source?.document).toBe(page);
    expect(source?.document.match(/<html/gi)).toHaveLength(1);
  });

  test("composes { html, css, js } into one document", () => {
    const source = detectUiPreview({
      html: "<button id='go'>Book</button>",
      css: "#go { color: red }",
      js: "document.getElementById('go').textContent = 'Booked'"
    });

    expect(source?.origin).toBe("html + css + js");
    expect(source?.document).toContain("#go { color: red }");
    expect(source?.document).toContain("<script>");
    expect(source?.code).toContain("/* css */");
    expect(source?.code).toContain("// js");
  });

  test("injects extra css/js into a full document rather than wrapping it", () => {
    const source = detectUiPreview({
      html: "<!doctype html><html><body><p>Hi</p></body></html>",
      css: "p { color: blue }"
    });

    expect(source?.document.match(/<html/gi)).toHaveLength(1);
    expect(source?.document).toContain("p { color: blue }");
    expect(source?.document.indexOf("p { color: blue }")).toBeLessThan(source!.document.indexOf("</body>"));
  });

  test("extracts a ```html fence from an AI Brain answer", () => {
    const answer = "Here is the landing page you asked for:\n\n```html\n<section><h2>Pricing</h2></section>\n```\n\nLet me know!";
    const source = detectUiPreview(answer);

    expect(source?.origin).toBe("code block");
    expect(source?.code).toBe("<section><h2>Pricing</h2></section>");
    expect(source?.document).not.toContain("Let me know");
  });

  test("renders SVG output", () => {
    const source = detectUiPreview('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>');

    expect(source?.language).toBe("svg");
    expect(source?.document).toContain("<circle");
  });

  test("finds markup nested one level down in a wrapped output", () => {
    const source = detectUiPreview({ outputKey: "script.output", value: { html: "<main><h1>Nested</h1></main>" } });

    expect(source?.code).toBe("<main><h1>Nested</h1></main>");
  });

  test("finds the first previewable entry in an array", () => {
    const source = detectUiPreview(["just text", { html: "<article>Post</article>" }]);

    expect(source?.code).toBe("<article>Post</article>");
  });

  test("ignores plain prose, numbers, and non-markup objects", () => {
    expect(detectUiPreview("Booked for 3pm — see you then.")).toBeNull();
    expect(detectUiPreview("2 < 3 and 5 > 4")).toBeNull();
    expect(detectUiPreview({ status: "confirmed", slots: 4 })).toBeNull();
    expect(detectUiPreview(null)).toBeNull();
    expect(detectUiPreview(42)).toBeNull();
  });

  test("ignores a fenced block that is not markup", () => {
    expect(detectUiPreview("```python\nprint('hi')\n```")).toBeNull();
  });

  test("skips a source too large to render", () => {
    expect(detectUiPreview(`<div>${"x".repeat(600_000)}</div>`)).toBeNull();
  });
});

describe("isMarkupField", () => {
  test("flags a long markup value so it is not duplicated as a summary row", () => {
    expect(isMarkupField(`<div class="wrapper">${"<p>copy</p>".repeat(20)}</div>`)).toBe(true);
  });

  test("leaves ordinary values alone", () => {
    expect(isMarkupField("confirmed")).toBe(false);
    expect(isMarkupField("<p>hi</p>")).toBe(false);
  });
});
