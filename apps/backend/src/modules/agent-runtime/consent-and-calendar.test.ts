import { describe, expect, it } from "vitest";
import { refusesSmsMessage, wantsSmsMessage } from "./runtime-context";
import { createArchitectTestProviders } from "./provider-adapters";

/**
 * TWO PROMISES A CUSTOMER SHOULD BE ABLE TO RELY ON (2026-08-27).
 *
 * Asking not to be contacted must not be read as asking to be contacted, and a
 * time nobody's calendar knows about must never be read out as free. Both were
 * wrong in ways nobody would ever have reported: the customer just gets a text
 * they asked us not to send, or turns up to an appointment nobody has.
 */

describe("asking not to be texted", () => {
  const refusals = [
    "please don't text me",
    "Please do not text me",
    "no texts thanks",
    "don't send me a message",
    "please stop texting me",
    "I'd rather not get an SMS",
    "no sms please"
  ];

  for (const line of refusals) {
    it(`is not a request for a text: "${line}"`, () => {
      expect(refusesSmsMessage(line), line).toBe(true);
      expect(wantsSmsMessage(line), line).toBe(false);
    });
  }

  const requests = [
    "can you text me the details",
    "send me an SMS please",
    "text me when it's confirmed",
    "please notify me"
  ];

  for (const line of requests) {
    it(`is still heard as a request: "${line}"`, () => {
      expect(wantsSmsMessage(line), line).toBe(true);
    });
  }
});

describe("a public preview has no calendar", () => {
  it("offers no times at all rather than times nobody has", async () => {
    /* This flag is set by exactly one caller — the public agent page. It used
       to answer with slots invented from a default nine-to-five, and the
       runtime treats anything that is not "unavailable" as a real answer, so
       the agent read them to a visitor as free times. */
    const providers = createArchitectTestProviders({
      userId: "architect-1",
      workflowId: "workflow-1",
      forceTestAvailability: true
    });

    const result = await providers.calendar!.checkAvailability({
      requestedDate: "2026-09-01",
      timeZone: "UTC"
    } as never);

    expect(result.slots).toEqual([]);
    expect(result.source).toBe("unavailable");
  });
});
