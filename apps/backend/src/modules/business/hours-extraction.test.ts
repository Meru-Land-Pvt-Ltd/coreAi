import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { extractHoursFromDocuments } from "./scheduling";
import { addressesMateriallyDiffer } from "./business-facts";
import { ingestKnowledgeFiles } from "./knowledge-files";

const RUN = `hoursx-${process.pid}-${Date.now().toString(36)}`;

let dbAvailable = false;
let ownerId = "";
const businessIds: string[] = [];

async function businessWithDoc(text: string): Promise<string> {
  const business = await prisma.business.create({
    data: { ownerId, name: `${RUN}-${businessIds.length}`, type: "clinic" }
  });
  businessIds.push(business.id);
  const [file] = await ingestKnowledgeFiles({
    businessId: business.id,
    files: [{ filename: "brochure.txt", mimeType: "text/plain", bytes: Buffer.from(text) }]
  });
  expect(file.status).toBe("PROCESSED");
  return business.id;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[hours-extraction.test] database unreachable — suite skipped");
    return;
  }
  ownerId = (await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } })).id;
});

afterAll(async () => {
  if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
  await prisma.businessKnowledgeFile.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId: { in: businessIds } } });
  await prisma.business.deleteMany({ where: { id: { in: businessIds } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("hours extraction from real brochure layouts", () => {
  it("reads a PDF-style table with a split day name and the time on its own line", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    // Mirrors the exact layout pdf-parse produced for a real brochure:
    // "Wednesda" / "y" broken across lines, its hours on the following line.
    const businessId = await businessWithDoc(
      [
        "Business Hours",
        "Day Hours",
        "Monday 8:00 AM – 6:00 PM",
        "Tuesday 8:00 AM – 6:00 PM",
        "Wednesda",
        "y",
        "8:00 AM – 6:00 PM",
        "Thursday 8:00 AM – 6:00 PM",
        "Friday 8:00 AM – 5:00 PM",
        "Saturday 9:00 AM – 2:00 PM",
        "Sunday Closed"
      ].join("\n")
    );

    const suggestion = await extractHoursFromDocuments({ businessId });
    expect(suggestion).not.toBeNull();
    expect(Object.keys(suggestion!.days)).toHaveLength(7);
    expect(suggestion!.days.wednesday).toEqual({ open: "08:00", close: "18:00", closed: false });
    expect(suggestion!.days.friday).toEqual({ open: "08:00", close: "17:00", closed: false });
    expect(suggestion!.days.sunday?.closed).toBe(true);
  });

  it('reads time-first "Timings: 10 AM to 8 PM (Mon–Sat)" with a separate Sunday line', async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const businessId = await businessWithDoc(
      ["Visit us!", "Timings: 10 AM to 8 PM (Mon–Sat)", "Sunday: Closed"].join("\n")
    );

    const suggestion = await extractHoursFromDocuments({ businessId });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.days.monday).toEqual({ open: "10:00", close: "20:00", closed: false });
    expect(suggestion!.days.saturday).toEqual({ open: "10:00", close: "20:00", closed: false });
    expect(suggestion!.days.sunday?.closed).toBe(true);
  });

  it('"Open daily 9am – 9pm" fills the week, but an explicit day still wins', async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const businessId = await businessWithDoc(
      ["We are here for you.", "Open daily 9am – 9pm", "Sunday: Closed"].join("\n")
    );

    const suggestion = await extractHoursFromDocuments({ businessId });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.days.monday).toEqual({ open: "09:00", close: "21:00", closed: false });
    expect(suggestion!.days.saturday).toEqual({ open: "09:00", close: "21:00", closed: false });
    // The explicit "Sunday: Closed" row beats the daily fallback.
    expect(suggestion!.days.sunday?.closed).toBe(true);
  });

  it('infers the evening close in bare ranges: "Mon through Fri 9 to 5"', async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const businessId = await businessWithDoc("Hours\nMon through Fri 9 to 5\nSat 10 to 2");

    const suggestion = await extractHoursFromDocuments({ businessId });
    expect(suggestion).not.toBeNull();
    expect(suggestion!.days.monday).toEqual({ open: "09:00", close: "17:00", closed: false });
    expect(suggestion!.days.friday).toEqual({ open: "09:00", close: "17:00", closed: false });
    expect(suggestion!.days.saturday).toEqual({ open: "10:00", close: "14:00", closed: false });
  });

  it("still requires confidence — a document without timings suggests nothing", async () => {
    if (!dbAvailable) throw new Error("Integration test requires a reachable database; failing loudly instead of passing silently (#2).");
    const businessId = await businessWithDoc(
      "About us\nPlease notify us at least 24 hours before your appointment.\nCall 555-0100 anytime."
    );
    expect(await extractHoursFromDocuments({ businessId })).toBeNull();
  });
});

describe("address conflict comparison", () => {
  const confirmed = { line1: "1234 Sunset Boulevard", city: "Las Vegas", postalCode: "89109" };

  it("abbreviations and formatting are never a conflict", () => {
    expect(
      addressesMateriallyDiffer(confirmed, {
        line1: "1234 Sunset Blvd.",
        city: "Las Vegas",
        postalCode: "89109"
      })
    ).toBe(false);
    // Missing postal on one side + same number/city → same place.
    expect(
      addressesMateriallyDiffer(confirmed, { line1: "1234 Sunset Blvd", city: "Las Vegas", postalCode: null })
    ).toBe(false);
  });

  it("a real mismatch in number, postal, or city IS a conflict", () => {
    expect(
      addressesMateriallyDiffer(confirmed, { line1: "990 Sunset Boulevard", city: "Las Vegas", postalCode: "89109" })
    ).toBe(true);
    expect(
      addressesMateriallyDiffer(confirmed, { line1: "1234 Sunset Boulevard", city: "Las Vegas", postalCode: "89044" })
    ).toBe(true);
    expect(
      addressesMateriallyDiffer(confirmed, { line1: "1234 Sunset Boulevard", city: "Henderson", postalCode: "89109" })
    ).toBe(true);
  });

  it("different street names without corroborating matches conflict", () => {
    expect(
      addressesMateriallyDiffer(
        { line1: "1234 Sunset Boulevard", city: null, postalCode: null },
        { line1: "1234 Maple Crest Drive", city: null, postalCode: null }
      )
    ).toBe(true);
  });
});
