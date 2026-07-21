import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

/**
 * BusinessHoursSection mode contract:
 * - Standalone (Business Settings): keeps its own Save button and its own
 *   timezone selector fed by the shared timezone list.
 * - Embedded with timeZoneOverride (Agent Setup): no Save button, no selector —
 *   only the read-only "Times shown in … · Change in Connect" note.
 */

vi.mock("@/components/business/features/api", () => ({
  getBusinessHours: vi.fn(),
  putBusinessHours: vi.fn().mockResolvedValue({ success: true, data: {} }),
  syncBusinessHoursToLiveAgent: vi.fn().mockResolvedValue({ success: true, data: { sync: { status: "not_deployed" } } })
}));

import { getBusinessHours } from "@/components/business/features/api";
import { BusinessHoursSection } from "./business-hours-section";

const BH_DATA = {
  hours: [
    { day: "monday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "tuesday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "wednesday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "thursday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "friday", closed: false, periods: [{ open: "09:00", close: "17:00" }] },
    { day: "saturday", closed: true, periods: [] },
    { day: "sunday", closed: true, periods: [] }
  ],
  timeZone: "America/Los_Angeles",
  specialDates: [],
  source: "manual",
  confirmedAt: "2026-07-01T00:00:00.000Z",
  configured: true,
  weeklySummary: ["Monday: 9 AM–5 PM"],
  openStatus: { state: "open", description: "" },
  suggestion: null,
  liveAssistant: false,
  sync: null
};

beforeEach(() => {
  cleanup();
  vi.mocked(getBusinessHours).mockReset().mockResolvedValue({ success: true, data: BH_DATA } as never);
});

describe("BusinessHoursSection modes", () => {
  it("standalone keeps its Save button and its own timezone selector with friendly labels", async () => {
    render(<BusinessHoursSection />);

    await screen.findByTestId("business-hours-section");
    expect(screen.getByTestId("business-hours-save")).toBeTruthy();

    const select = screen.getByTestId("business-hours-timezone-select") as HTMLSelectElement;
    expect(select.value).toBe("America/Los_Angeles");
    const labels = Array.from(select.options).map((option) => option.textContent);
    expect(labels.some((label) => label?.includes("America/Los_Angeles (Pacific US)"))).toBe(true);
    expect(screen.queryByTestId("business-hours-timezone-note")).toBeNull();
  });

  it("standalone keeps an off-list stored zone selectable", async () => {
    vi.mocked(getBusinessHours).mockResolvedValue({
      success: true,
      data: { ...BH_DATA, timeZone: "Pacific/Chatham" }
    } as never);

    render(<BusinessHoursSection />);
    await screen.findByTestId("business-hours-section");

    const select = screen.getByTestId("business-hours-timezone-select") as HTMLSelectElement;
    expect(select.value).toBe("Pacific/Chatham");
    expect(Array.from(select.options).some((option) => option.value === "Pacific/Chatham")).toBe(true);
  });

  it("embedded with timeZoneOverride renders the read-only note — no selector, no save button", async () => {
    render(<BusinessHoursSection embedded timeZoneOverride="Asia/Kolkata" />);

    await screen.findByTestId("business-hours-section");
    expect(screen.queryByTestId("business-hours-save")).toBeNull();
    expect(screen.queryByTestId("business-hours-timezone-select")).toBeNull();

    const note = screen.getByTestId("business-hours-timezone-note");
    expect(note.textContent).toContain("Asia/Kolkata");
    expect(note.textContent).toContain("Change in Connect");
  });
});
