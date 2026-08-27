/**
 * THE BUILDER'S EYES — one job: render one of OUR pages, hand back a picture.
 *
 * The founder's ruling (2026-08-27): "whenever I tell you as a real human you
 * check it in your own browser, you tested in real, you take the screenshot,
 * verify it with the desired result… is the present AI Builder doing the same
 * thing?" It was not. It composed, and the first eyes on the result were
 * always the architect's — which is exactly how a costume screen shipped.
 *
 * THE RULES THIS ROOM KEEPS, and none of them is optional:
 *
 *  - IT LOOKS AT OUR PAGES ONLY. The address must be the frontend we were
 *    told about at boot. A browser that will fetch whatever a caller names is
 *    the same hole every SSRF guard on this platform exists to close.
 *  - IT CARRIES NO SECRETS. No platform key reaches this container, so there
 *    is nothing here to steal. The one token it checks is its own door key.
 *  - IT NEVER RUNS A PAGE FOREVER. Hard timeout, hard size cap, one browser
 *    reused so a runaway cannot pile up.
 *  - IT NEVER LIES. A page that failed to load returns an honest error, never
 *    a blank picture that would read as "the screen is empty".
 */

import { createServer } from "node:http";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 8791);
const TOKEN = process.env.EYES_TOKEN || "";
/** The only origin this room may look at. */
const ALLOWED_ORIGIN = (process.env.EYES_ALLOWED_ORIGIN || "http://frontend:3000").replace(/\/+$/, "");

const NAV_TIMEOUT_MS = 20_000;
const SETTLE_MS = 900;
const MAX_WIDTH = 1440;
const MAX_HEIGHT = 2400;

let browser = null;

async function theBrowser() {
  if (browser && browser.isConnected()) return browser;
  browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
  });
  return browser;
}

function refuse(res, status, message) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ ok: false, error: message }));
}

/**
 * A picture of one page.
 *
 * `viewport` chooses the shape a customer would meet it in — a phone screen
 * and a desktop screen are different products, and the Builder must be able
 * to look at either.
 */
async function screenshot({ url, viewport, cookie }) {
  const target = new URL(url);
  const origin = `${target.protocol}//${target.host}`;
  if (origin !== ALLOWED_ORIGIN) {
    throw Object.assign(new Error("That address is not one of our own pages."), { status: 400 });
  }

  const context = await (await theBrowser()).newContext({
    viewport: {
      width: Math.min(viewport?.width || 1280, MAX_WIDTH),
      height: Math.min(viewport?.height || 900, MAX_HEIGHT)
    },
    deviceScaleFactor: 1,
    /* A page that asks for a microphone or a camera must never hang the
       look waiting for a permission nobody will grant. */
    permissions: []
  });

  try {
    if (cookie) {
      await context.addCookies([
        {
          name: cookie.name,
          value: cookie.value,
          domain: target.hostname,
          path: "/",
          httpOnly: false,
          secure: target.protocol === "https:"
        }
      ]);
    }

    const page = await context.newPage();
    /* Console errors are part of what a page HONESTLY did — a screen that
       rendered while throwing is not a working screen. */
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(String(error?.message ?? error).slice(0, 300)));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300));
    });

    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
    if (!response || response.status() >= 400) {
      throw Object.assign(new Error(`The page answered ${response ? response.status() : "nothing"}.`), {
        status: 502
      });
    }

    /* Let the page settle — a screenshot taken mid-render is a lie about
       what a customer would see. */
    await page.waitForTimeout(SETTLE_MS);

    const shot = await page.screenshot({ type: "png", fullPage: true });
    const text = (await page.innerText("body").catch(() => "")).slice(0, 4000);

    return {
      ok: true,
      image: `data:image/png;base64,${shot.toString("base64")}`,
      text,
      consoleErrors: consoleErrors.slice(0, 10),
      bytes: shot.length
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/look") {
    return refuse(res, 404, "This room only takes POST /look.");
  }
  if (TOKEN && req.headers["x-eyes-token"] !== TOKEN) {
    return refuse(res, 401, "Not your room.");
  }

  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 20_000) req.destroy();
  });
  req.on("end", async () => {
    let input;
    try {
      input = JSON.parse(body || "{}");
    } catch {
      return refuse(res, 400, "That was not JSON.");
    }
    if (typeof input.url !== "string" || !input.url) {
      return refuse(res, 400, "Say which page to look at.");
    }
    try {
      const looked = await screenshot(input);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(looked));
    } catch (error) {
      /* Honest failure, always: a blank picture would read as "the screen is
         empty", which is a different and much worse answer. */
      return refuse(res, error?.status || 500, error?.message || "The page could not be looked at.");
    }
  });
}).listen(PORT, () => {
  console.log(`[eyes] looking only at ${ALLOWED_ORIGIN}, listening on ${PORT}`);
});
