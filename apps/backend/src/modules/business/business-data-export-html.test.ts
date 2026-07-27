import { describe, expect, it } from "vitest";
import {
  decodeEmbeddedExportImage,
  renderBusinessExportHome,
  renderBusinessExportPage
} from "./business-data-export-html";

const ONE_PIXEL_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

describe("business data export HTML", () => {
  it("decodes supported embedded raster images without retaining base64 text", () => {
    const decoded = decodeEmbeddedExportImage(`data:image/png;base64,${ONE_PIXEL_PNG}`);

    expect(decoded?.extension).toBe("png");
    expect(decoded?.mimeType).toBe("image/png");
    expect(decoded?.bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  });

  it("rejects remote URLs, SVG, invalid signatures, and oversized images", () => {
    expect(decodeEmbeddedExportImage("http://169.254.169.254/latest/meta-data")).toBeNull();
    expect(
      decodeEmbeddedExportImage(
        "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9ImFsZXJ0KDEpIj48L3N2Zz4="
      )
    ).toBeNull();
    expect(decodeEmbeddedExportImage("data:image/png;base64,SGVsbG8=")).toBeNull();
    expect(decodeEmbeddedExportImage(`data:image/png;base64,${ONE_PIXEL_PNG}`, 4)).toBeNull();
  });

  it("renders a script-free, escaped, readable page with local image references", () => {
    const html = renderBusinessExportPage({
      eyebrow: "03 · My Agents",
      title: "My Agents",
      intro: "A simple agent list.",
      generatedAt: new Date("2026-07-25T10:30:00.000Z"),
      homeHref: "../start-here.html",
      stats: [{ label: "Agents", value: "1" }],
      sections: [
        {
          title: "Agent list",
          cards: [
            {
              title: "<script>alert(1)</script>",
              imageSrc: "./images/agent-01.png",
              fields: [{ label: "Status", value: "Live" }]
            }
          ]
        }
      ]
    });

    expect(html).toContain('href="../start-here.html"');
    expect(html).toContain('src="./images/agent-01.png"');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(";base64,");
  });

  it("creates a four-section Start Here page and explains skipped images", () => {
    const html = renderBusinessExportHome({
      businessName: "Asha & Co.",
      generatedAt: new Date("2026-07-25T10:30:00.000Z"),
      skippedImages: ["One unsupported image was skipped."],
      categories: [
        {
          href: "01-profile/profile.html",
          number: "01",
          title: "Profile",
          description: "Profile details",
          detail: "Open Profile"
        }
      ]
    });

    expect(html).toContain("Asha &amp; Co.");
    expect(html).toContain('href="01-profile/profile.html"');
    expect(html).toContain("One unsupported image was skipped.");
  });
});
