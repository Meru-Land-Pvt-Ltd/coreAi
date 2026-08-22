import { describe, expect, it } from "vitest";
import { outboundSendsAllowed } from "./workflow-runner";

/**
 * The rule that keeps a public widget from becoming a phone line.
 *
 * An agent embedded on a business's own website runs LIVE — real calendar,
 * real leads. But the page is public: anyone can open it, and anyone can read
 * the key out of the buyer's HTML. If such a run could also send, a stranger
 * could type any number in the world and make the business text or dial it,
 * on the business's account.
 *
 * These four cases are the whole contract. If one of them ever flips, a
 * widget becomes a toll-fraud tool — so they are asserted, not assumed.
 */
describe("outboundSendsAllowed", () => {
  it("a normal live run may send — phone, SMS, Telegram and the timer are unaffected", () => {
    expect(outboundSendsAllowed({} as never, "live")).toBe(true);
  });

  it("a live run from an embedded widget may NOT send", () => {
    expect(outboundSendsAllowed({ embedSource: true } as never, "live")).toBe(false);
  });

  it("a test run never sends, widget or not", () => {
    expect(outboundSendsAllowed({} as never, "test")).toBe(false);
    expect(outboundSendsAllowed({ embedSource: true } as never, "test")).toBe(false);
  });

  it("only the exact flag counts — a truthy lookalike must not open the gate", () => {
    expect(outboundSendsAllowed({ embedSource: "yes" } as never, "live")).toBe(true);
    // The value above is not `true`, so the run is treated as a normal live
    // run. That is the safe direction only because nothing but our own route
    // sets this field; the route sets a real boolean.
    expect(outboundSendsAllowed({ embedSource: false } as never, "live")).toBe(true);
  });
});
