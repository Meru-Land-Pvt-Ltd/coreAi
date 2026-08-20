import { describe, it, expect } from "vitest";
import { deriveBuyerContract, type ConnectorContract } from "@coreai/shared";
import { allConnectors, connectorProblems, connectorsForJob, connectorsNeedingReview } from "./registry";
import { apolloFindPeople } from "./catalogue/apollo";

/**
 * The promise of the whole standard, tested:
 *
 * a node names a connector, and the business's setup form and dashboard appear
 * — with nobody writing a form, a field, a label or a tile.
 *
 * If these tests need editing to add a connector, the design has failed.
 */

const graphWith = (connectorId: string) => ({
  nodes: [
    {
      id: "n1",
      data: { type: "action.find_leads", label: "Find leads", connectorId }
    }
  ]
});

describe("a connector generates the business's setup form by itself", () => {
  const contract = deriveBuyerContract(graphWith("apollo.find_people"), {
    connectors: allConnectors()
  });

  it("asks exactly what the connector said it needs, in the connector's own words", () => {
    const keys = contract.inputs.map((input) => input.key);
    expect(keys).toContain("jobTitles");
    expect(keys).toContain("locations");
    expect(keys).toContain("industry");

    const titles = contract.inputs.find((input) => input.key === "jobTitles");
    // Not "Job Titles" — the humanised guess. The connector's author knew what
    // the field was for and wrote a real question.
    expect(titles?.label).toBe("Who are you trying to reach?");
    expect(titles?.required).toBe(true);
    expect(titles?.kind).toBe("list");
  });

  it("never asks the business for the architect's decisions", () => {
    // leadsPerRun is the architect's call, made once for everyone who installs
    // the agent. Asking a dentist how many API lookups to run is how a
    // five-minute setup becomes forty.
    expect(contract.inputs.map((input) => input.key)).not.toContain("leadsPerRun");
  });

  it("offers their own key without demanding it, and never in cleartext", () => {
    const key = contract.inputs.find((input) => input.key === "APOLLO_API_KEY");
    expect(key?.required).toBe(false);
    expect(key?.kind).toBe("secret");
    expect(key?.help).toContain("through Triven");
  });
});

describe("a connector generates the business's dashboard by itself", () => {
  const contract = deriveBuyerContract(graphWith("apollo.find_people"), {
    connectors: allConnectors()
  });

  it("shows the headline number the connector produces", () => {
    const found = contract.metrics.find((metric) => metric.source === "connector.apollo.find_people.units");
    expect(found).toBeDefined();
    expect(found?.label).toBe("People found");
    expect(found?.emphasis).toBe("primary");
  });

  it("shows what it is costing them, because they are the ones billed", () => {
    const spend = contract.metrics.find((metric) => metric.source === "connector.apollo.find_people.spend");
    expect(spend?.format).toBe("money");
  });

  it("invents no board of results it cannot fill", () => {
    // The run log records how many leads were found, never the leads. A table
    // sourced from a connector would therefore always be empty — which is the
    // same lie the engine exists to stop, drawn on a screen.
    expect(contract.tables.every((table) => !table.source.startsWith("connector."))).toBe(true);
  });
});

describe("nothing is silently dropped", () => {
  it("names a connector the platform does not have", () => {
    const contract = deriveBuyerContract(graphWith("nonexistent.thing"), {
      connectors: allConnectors()
    });
    expect(contract.missingConnectors).toEqual(["nonexistent.thing"]);
  });

  it("still produces a working dashboard when no catalogue is passed at all", () => {
    // Every existing caller predates connectors and passes nothing. They must
    // keep working exactly as before.
    const contract = deriveBuyerContract(graphWith("apollo.find_people"));
    expect(contract.metrics.length).toBeGreaterThan(0);
    expect(contract.missingConnectors).toEqual(["apollo.find_people"]);
  });
});

describe("consent is asked out loud", () => {
  it("puts the question on the setup form when a connector requires it", () => {
    const dialer: ConnectorContract = {
      ...apolloFindPeople,
      id: "test.dialer",
      rules: { ...apolloFindPeople.rules, requiresConsent: true }
    };

    const contract = deriveBuyerContract(graphWith("test.dialer"), { connectors: [dialer] });
    const consent = contract.inputs.find((input) => input.key === "consentConfirmed");

    expect(consent?.required).toBe(true);
    expect(consent?.choices).toContain("No");
  });
});

describe("the registry", () => {
  it("registered every connector without a single problem", () => {
    // This is the deploy gate. A malformed connector must stop a release, not
    // be discovered by a customer whose agent quietly did nothing all week.
    expect(connectorProblems()).toEqual([]);
    expect(allConnectors().length).toBeGreaterThan(0);
  });

  it("answers by job, not by company name", () => {
    const finders = connectorsForJob("find-work-emails");
    expect(finders.map((entry) => entry.id)).toContain("apollo.find_people");
  });

  it("flags a connector nobody has checked against its provider's docs in a year", () => {
    const stale = new Date("2030-01-01T00:00:00.000Z");
    expect(connectorsNeedingReview(stale).map((entry) => entry.id)).toContain("apollo.find_people");

    const fresh = new Date(`${apolloFindPeople.provider.lastVerified}T00:00:00.000Z`);
    expect(connectorsNeedingReview(fresh)).toEqual([]);
  });
});

describe("Apollo itself", () => {
  it("never touches Apollo during a rehearsal", async () => {
    const result = await apolloFindPeople.heart({
      config: { jobTitles: "Dentist", locations: "London" },
      credentials: { APOLLO_API_KEY: "not-a-real-key" },
      page: 1,
      isTest: true,
      log: () => undefined
    });

    const leads = result.outputs.leads as Array<{ source: string }>;
    // Marked as an example, so a rehearsal can never be mistaken for real data
    // further down the orchestration.
    expect(leads[0].source).toBe("apollo-example");
  });

  it("reads a pasted list the way a person actually types one", () => {
    // A business will paste lines, or commas, or both. All three must work.
    const shapes = ["Dentist\nPractice Owner", "Dentist, Practice Owner", ["Dentist", " Practice Owner "]];
    for (const jobTitles of shapes) {
      expect(() =>
        apolloFindPeople.heart({
          config: { jobTitles, locations: "London" },
          credentials: { APOLLO_API_KEY: "x" },
          page: 1,
          isTest: true,
          log: () => undefined
        })
      ).not.toThrow();
    }
  });
});
