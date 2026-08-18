import { getSiteUrl } from "@/lib/site-metadata";

/**
 * THE EMBED LOADER — one line of code puts an agent on any website.
 *
 * A business pastes a single <script> tag into their own site. This file is
 * what that tag loads. It creates an iframe pointing at the agent's published
 * page in embed mode, and listens for the page's height so the frame grows and
 * shrinks with the answer instead of clipping it or leaving a hole.
 *
 * Written as plain ES5 in a string on purpose: it runs on whatever browser the
 * customer's visitor has, on a site we do not control, with no build step and
 * no framework. Nothing here may throw — a broken widget must never take a
 * paying business's homepage down with it.
 *
 * Two placements, decided by the business:
 *   • default — inline, where the script tag sits (a section of their page)
 *   • data-triven-mode="bubble" — a floating button, bottom right
 */
export const dynamic = "force-static";
export const revalidate = 3600;

function loaderScript(origin: string): string {
  return `(function () {
  "use strict";
  // Must be the very first line: currentScript is null inside any callback.
  var tag = document.currentScript;
  if (!tag) return;

  var slug = tag.getAttribute("data-triven-agent");
  if (!slug) {
    if (window.console && console.warn) {
      console.warn("[triven] add data-triven-agent=\\"your-agent\\" to the script tag");
    }
    return;
  }

  var origin = ${JSON.stringify(origin)};
  var mode = tag.getAttribute("data-triven-mode") === "bubble" ? "bubble" : "inline";
  var label = tag.getAttribute("data-triven-label") || "Ask us";
  var accent = tag.getAttribute("data-triven-accent") || "#f59e0b";
  var src = origin + "/a/" + encodeURIComponent(slug) + "?embed=1";

  // One agent, one widget, however many times the tag is pasted.
  var guard = "__trivenEmbed_" + slug.replace(/[^a-zA-Z0-9]/g, "_");
  if (window[guard]) return;
  window[guard] = true;

  function makeFrame() {
    var frame = document.createElement("iframe");
    frame.src = src;
    frame.title = "Triven agent";
    frame.setAttribute("loading", "lazy");
    // Microphone matters: a voice agent is silent without it. No sandbox
    // attribute — an opaque origin would break every call the page makes back
    // to our own API.
    frame.setAttribute("allow", "microphone; clipboard-write; autoplay");
    frame.style.border = "0";
    frame.style.width = "100%";
    frame.style.display = "block";
    frame.style.background = "transparent";
    return frame;
  }

  function listen(frame, onHeight) {
    window.addEventListener("message", function (event) {
      if (event.origin !== origin) return;
      var data = event.data;
      if (!data || data.type !== "triven:height" || data.slug !== slug) return;
      var height = Number(data.height);
      if (!height || height < 80) return;
      onHeight(Math.min(height, 20000));
    });
  }

  if (mode === "inline") {
    var holder = document.createElement("div");
    holder.setAttribute("data-triven-embed", slug);
    holder.style.width = "100%";
    var frame = makeFrame();
    frame.style.height = "560px";
    holder.appendChild(frame);
    // Where the tag sits is where the product appears.
    if (tag.parentNode) tag.parentNode.insertBefore(holder, tag.nextSibling);
    listen(frame, function (height) {
      frame.style.height = height + "px";
    });
    return;
  }

  // Bubble: a floating launcher that opens the product in a panel.
  var open = false;
  var panel = document.createElement("div");
  panel.setAttribute("data-triven-embed", slug);
  panel.style.cssText =
    "position:fixed;bottom:88px;right:20px;width:400px;max-width:calc(100vw - 32px);" +
    "height:600px;max-height:calc(100vh - 120px);z-index:2147483000;border-radius:16px;" +
    "overflow:hidden;background:#fff;box-shadow:0 18px 48px rgba(15,23,42,.24);" +
    "display:none;";
  var frame2 = makeFrame();
  frame2.style.height = "100%";
  panel.appendChild(frame2);

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", label);
  button.textContent = label;
  button.style.cssText =
    "position:fixed;bottom:20px;right:20px;z-index:2147483001;border:0;cursor:pointer;" +
    "padding:14px 22px;border-radius:999px;font:600 15px/1 system-ui,-apple-system,sans-serif;" +
    "color:#fff;background:" + accent + ";box-shadow:0 10px 24px rgba(15,23,42,.22);";
  button.onclick = function () {
    open = !open;
    panel.style.display = open ? "block" : "none";
    button.textContent = open ? "Close" : label;
  };

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  // In the panel the frame has a fixed box, so the height message is only used
  // to shrink a short product — never to grow past the panel.
  listen(frame2, function (height) {
    if (height < 600) panel.style.height = height + "px";
  });
})();
`;
}

export function GET() {
  const origin = getSiteUrl().origin.replace(/\/$/, "");
  return new Response(loaderScript(origin), {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Short at the edge, long in the browser: a business never has to clear
      // a cache to get a fix, and their visitors never re-download it.
      "Cache-Control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
