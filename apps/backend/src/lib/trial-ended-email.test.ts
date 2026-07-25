import { describe, expect, it } from "vitest";
import { buildTrialEndedEmailHtml } from "./mailer";

describe("trial-ended email template", () => {
  it("uses the Triven shell, links to My Agents, and has no reactivation action", () => {
    const html = buildTrialEndedEmailHtml({
      agentName: "Reception & Booking Agent",
      trialEndDate: "July 25, 2026",
      myAgentsLink: "http://localhost:3000/business/agents"
    });

    expect(html).toContain("<title>Your trial has expired</title>");
    expect(html).toContain('alt="Triven.ai"');
    expect(html).toContain("Reception &amp; Booking Agent");
    expect(html).toContain("July 25, 2026");
    expect(html).toContain('href="http://localhost:3000/business/agents"');
    expect(html).toContain("Choose a plan");
    expect(html).toContain(">Triven.ai</div>");
    expect(html).toContain(">Privacy</a>");
    expect(html).toContain(">Help Center</a>");
    expect(html).not.toContain("Reactivate trial");
    expect(html).not.toContain("CORE");
    expect(html).not.toContain("Unsubscribe");
    expect(html).not.toContain("San Francisco, CA");
    expect(html).not.toContain("AI Agent Platform");
  });
});
