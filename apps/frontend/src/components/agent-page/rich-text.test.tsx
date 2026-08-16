import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { RichText } from "./rich-text";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** jsdom has no matchMedia — stub the reduced-motion query explicitly. */
function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
  );
}

describe("RichText markdown rendering", () => {
  it("renders **bold** and *italic* as elements, never literal asterisks", () => {
    const { container } = render(<RichText text="This is **very bold** and *quite italic*." />);

    expect(container.querySelector("strong")?.textContent).toBe("very bold");
    expect(container.querySelector("em")?.textContent).toBe("quite italic");
    expect(container.textContent).toBe("This is very bold and quite italic.");
    expect(container.textContent).not.toContain("*");
  });

  it("renders #/##/### headings as semibold h3/h4/h5 below the page's own headings", () => {
    const { container } = render(<RichText text={"# Plan\n\n## Day one\n\n### Morning"} />);

    expect(container.querySelector("h3")?.textContent).toBe("Plan");
    expect(container.querySelector("h4")?.textContent).toBe("Day one");
    expect(container.querySelector("h5")?.textContent).toBe("Morning");
    for (const heading of Array.from(container.querySelectorAll("h3, h4, h5"))) {
      expect(heading.className).toContain("font-semibold");
    }
    expect(container.textContent).not.toContain("#");
  });

  it("renders - lists as <ul> and 1. lists as <ol> with items", () => {
    const { container } = render(
      <RichText text={"- pack sunscreen\n- book hotel\n\n1. arrive\n2. explore"} />
    );

    const ul = container.querySelector("ul");
    const ol = container.querySelector("ol");
    expect(ul).not.toBeNull();
    expect(ol).not.toBeNull();
    expect(ul?.querySelectorAll("li")).toHaveLength(2);
    expect(ol?.querySelectorAll("li")).toHaveLength(2);
    expect(container.textContent).toContain("pack sunscreen");
    expect(container.textContent).toContain("explore");
  });

  it("renders line breaks and inline code", () => {
    const { container } = render(<RichText text={"line one\nline two with `some_code`"} />);

    expect(container.querySelector("br")).not.toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("some_code");
    expect(container.textContent).not.toContain("`");
  });

  it("strips stray ** pairs that never became bold", () => {
    const { container } = render(<RichText text={"Enjoy your trip! ** Safe travels **bonus"} />);

    expect(container.textContent).not.toContain("**");
    expect(container.textContent).toContain("Safe travels");
    expect(container.textContent).toContain("bonus");
  });

  it("keeps mid-word ** that is content, not markdown: globs and exponents", () => {
    const glob = render(<RichText text={"Match src/**/*.ts to find them"} />);
    expect(glob.container.textContent).toContain("src/**/*.ts");

    const exponent = render(<RichText text={"In Python, 2**3 = 8"} />);
    expect(exponent.container.textContent).toContain("2**3 = 8");
  });

  it("degrades unknown syntax (tables) to plain text instead of dropping it", () => {
    const { container } = render(<RichText text={"| day | plan |\n| --- | --- |\n| 1 | beach |"} />);

    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("beach");
  });

  it("never injects HTML: <script> and inline handlers render as literal text", () => {
    const { container } = render(
      <RichText text={'Hello <script>alert("pwn")</script> and <img src=x onerror=alert(1)>'} />
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<script>");
    expect(container.textContent).toContain('alert("pwn")');
    expect(container.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("links: https becomes a safe anchor, javascript: degrades to text", () => {
    const { container } = render(
      <RichText text={"[safe](https://example.com) and [evil](javascript:alert(1))"} />
    );

    const anchors = container.querySelectorAll("a");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].getAttribute("href")).toBe("https://example.com");
    expect(anchors[0].getAttribute("rel")).toContain("noopener");
    expect(container.textContent).toContain("evil");
    expect(container.textContent).not.toContain("javascript:");
  });
});

describe("RichText progressive reveal", () => {
  it("wraps words in reveal spans with increasing delays when reveal is on", () => {
    stubReducedMotion(false);
    const { container } = render(<RichText text="one two three" reveal />);

    const words = container.querySelectorAll(".agent-reveal-word");
    expect(words).toHaveLength(3);
    // Full text is in the DOM immediately — reveal is opacity-only.
    expect(container.textContent).toBe("one two three");

    const delays = Array.from(words).map((word) =>
      parseInt((word as HTMLElement).style.animationDelay, 10)
    );
    expect(delays[0]).toBe(0);
    expect(delays[1]).toBeGreaterThan(delays[0]);
    expect(delays[2]).toBeGreaterThan(delays[1]);
  });

  it("accelerates for long texts so the reveal still finishes fast", () => {
    stubReducedMotion(false);
    const longText = Array.from({ length: 400 }, (_, i) => `word${i}`).join(" ");
    const { container } = render(<RichText text={longText} reveal />);

    const words = container.querySelectorAll(".agent-reveal-word");
    const lastDelay = parseInt(
      (words[words.length - 1] as HTMLElement).style.animationDelay,
      10
    );
    // 2800ms budget + rounding — never a full minute of trickle.
    expect(lastDelay).toBeLessThanOrEqual(3200);
  });

  it("is instant under prefers-reduced-motion: no animated spans, full text shown", () => {
    stubReducedMotion(true);
    const { container } = render(<RichText text="one two three" reveal />);

    expect(container.querySelectorAll(".agent-reveal-word")).toHaveLength(0);
    expect(container.textContent).toBe("one two three");
  });

  it("renders no reveal spans at all when reveal is off", () => {
    const { container } = render(<RichText text="plain and calm" />);
    expect(container.querySelectorAll(".agent-reveal-word")).toHaveLength(0);
  });
});
