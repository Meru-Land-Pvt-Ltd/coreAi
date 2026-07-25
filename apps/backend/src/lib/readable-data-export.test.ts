import { describe, expect, it } from "vitest";
import { buildReadableDataExport } from "./readable-data-export";

describe("buildReadableDataExport", () => {
  it("creates a structured plain-text document without JSON syntax", () => {
    const result = buildReadableDataExport({
      title: "Triven — Test data export",
      generatedAt: new Date("2026-07-25T10:30:00.000Z"),
      summary: "A readable copy of the saved test data.",
      subject: [{ label: "Account", value: "reader@example.com" }],
      exclusions: ["Passwords and secret credentials"],
      sections: [
        {
          title: "Account information",
          description: "Personal account details.",
          data: {
            fullName: "Asha Reader",
            email: "reader@example.com",
            notificationsEnabled: true,
            optionalValue: null
          }
        },
        {
          title: "Appointments",
          description: "Saved appointments.",
          data: [
            {
              id: "appointment-1",
              status: "CONFIRMED",
              createdAt: new Date("2026-07-24T08:15:00.000Z")
            }
          ]
        }
      ]
    });

    expect(result).toContain("CONTENTS");
    expect(result).toContain("1. Account information");
    expect(result).toContain("Full name: Asha Reader");
    expect(result).toContain("Notifications enabled: Yes");
    expect(result).toContain("Optional value: Not provided");
    expect(result).toContain("Record 1 — CONFIRMED");
    expect(result).toContain("July 24, 2026");
    expect(result).not.toContain('"fullName":');
    expect(result).not.toContain('{"');
  });

  it("explains empty collections and formats multiline content clearly", () => {
    const result = buildReadableDataExport({
      title: "Export",
      generatedAt: new Date("2026-07-25T10:30:00.000Z"),
      summary: "Summary",
      subject: [],
      exclusions: [],
      sections: [
        {
          title: "Messages",
          description: "Message history.",
          data: { messages: [], note: "First line\nSecond line" }
        }
      ]
    });

    expect(result).toContain("Messages (0 records):\n  No records found.");
    expect(result).toContain("Note:\n  First line\n  Second line");
  });
});
