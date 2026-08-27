import { describe, expect, it } from "vitest";
import { safeMarkdownHtml } from "./safe-markdown";

/**
 * THE ATTACKS THIS MUST STOP (2026-08-27).
 *
 * Three screens write this output straight into the page as HTML: the
 * architect's test panel, the business's setup preview, and the chatbot widget
 * on the public site. Between them they render a model's answer, a text
 * message, the body of an email the agent read, and whatever a visitor typed.
 * The email one is the sharpest: anybody in the world can send an email, and
 * the architect's sign-in lives in browser storage on the same domain.
 *
 * Every case below is a real way in that used to work.
 */

describe("markdown from somebody we do not trust", () => {
  it("keeps a script out of the page", () => {
    const html = safeMarkdownHtml('Hello <script>steal(localStorage["coreai-token"])</script>');
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;script");
  });

  it("keeps out the tag that needs no script tag at all", () => {
    /* The classic: an image that cannot load, running code as it fails.
       The words may still appear — as words. What must not appear is a live
       tag, so that is what these check for. */
    const html = safeMarkdownHtml('<img src=x onerror="steal()">');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain("&lt;img");
  });

  it("keeps out a tag hidden in a markdown link's text", () => {
    const html = safeMarkdownHtml('[click <img src=x onerror="steal()">](https://example.com)');
    expect(html).not.toMatch(/<img/i);
    /* The link itself survives, because a real link is the point. */
    expect(html).toContain('href="https://example.com"');
  });

  it("lets no tag through that the parser did not write itself", () => {
    /* The broad law behind the cases above: whatever arrives, the only tags
       in the output are ones markdown syntax asked for. */
    const attacks = [
      "<iframe src=//evil.com></iframe>",
      "<svg onload=steal()>",
      "<body onpageshow=steal()>",
      "<a href=javascript:steal()>x</a>",
      "<style>*{background:url(//evil.com)}</style>",
      "<div onmouseover=steal()>hover</div>"
    ];
    const allowed = /^(p|br|strong|em|ul|ol|li|h[1-6]|blockquote|code|pre|a|img|hr|del|table|thead|tbody|tr|th|td)$/i;
    for (const attack of attacks) {
      const html = safeMarkdownHtml(attack);
      for (const [, name] of html.matchAll(/<\/?([a-z0-9-]+)/gi)) {
        expect(allowed.test(name), `${attack} produced <${name}>`).toBe(true);
      }
      /* Escaped text may still read "onload=" — as words. What matters is
         that no LIVE tag carries a handler, so look only inside real tags. */
      for (const [tag] of html.matchAll(/<[a-z][a-z0-9-]*\s[^>]*>/gi)) {
        expect(tag, attack).not.toMatch(/\son[a-z]+\s*=/i);
      }
    }
  });

  it("drops an address that runs code instead of going somewhere", () => {
    const html = safeMarkdownHtml("[click me](javascript:steal())");
    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="#"');
  });

  it("drops an address that spells its scheme in entities", () => {
    /* Escaping the input turns "&" into "&amp;", and a parser writing an
       address back out can leave a numeric entity in place. The check decodes
       before it judges, so "java&#115;cript:" is not mistaken for a name. */
    const html = safeMarkdownHtml("[click me](java&#115;cript:steal())");
    expect(html.toLowerCase()).not.toContain("javascript:");
  });

  it("drops a data: address, which can carry a whole page", () => {
    const html = safeMarkdownHtml("[click me](data:text/html;base64,PHNjcmlwdD4=)");
    expect(html).not.toContain("data:text/html");
  });

  it("still formats the things a person actually wrote", () => {
    const html = safeMarkdownHtml("**Confirmed** for *Tuesday*\n\n- 9:00\n- 10:30");
    expect(html).toContain("<strong>Confirmed</strong>");
    expect(html).toContain("<em>Tuesday</em>");
    expect(html).toContain("<li>9:00</li>");
  });

  it("still lets a real link through, and an email address", () => {
    const linked = safeMarkdownHtml("[our page](https://triven.ai/pricing)");
    expect(linked).toContain('href="https://triven.ai/pricing"');
    const mail = safeMarkdownHtml("[write to us](mailto:hello@triven.ai)");
    expect(mail).toContain('href="mailto:hello@triven.ai"');
  });

  it("shows nothing at all rather than a surprise, when handed something that is not text", () => {
    expect(safeMarkdownHtml(undefined)).toBe("");
    expect(safeMarkdownHtml(null)).toBe("");
    expect(safeMarkdownHtml({ body: "hi" })).toBe("");
  });
});
