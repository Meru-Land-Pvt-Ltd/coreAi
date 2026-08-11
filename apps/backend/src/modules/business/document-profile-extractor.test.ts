import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { extractProfileFallbackFromText, extractProfileFromDocuments } from "./document-profile-extractor";
import { ingestKnowledgeFiles } from "./knowledge-files";

const RUN = `docprofile-${process.pid}-${Date.now().toString(36)}`;

const MULTI_DOCTOR_BROCHURE = `
Central Perk Dental Clinic
Registration No: REG-987654

Our Doctors & Specialists:
Dr. Sarah Jenkins, MD - Senior Cardiologist & Medical Director
Dr. Michael Chang, DDS - Lead Orthodontist
Dr. Emily Watson, DMD - Pediatric Dentist

Services Offered:
- Root Canal Therapy
- Teeth Whitening & Cleaning
- Dental Implants & Surgery
- Cosmetic Dentistry

Contact Us:
Phone: (555) 234-5678
Email: info@centralperkdental.com
Website: www.centralperkdental.com
Location: 100 Main Street, Suite 400, Denver, CO 80202
`;

const SINGLE_DOCTOR_BROCHURE = `
St. Jude Medical Practice
Lic # MD-123456

Primary Physician:
Dr. Robert Vance, MD

Services:
- General Checkup
- Blood Pressure Screening

Contact:
Phone: (555) 987-6543
`;

let dbAvailable = false;
let ownerId = "";
let businessId1 = "";
let businessId2 = "";

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    console.warn("[document-profile-extractor.test] database unreachable — suite skipped");
    return;
  }

  const owner = await prisma.user.create({ data: { email: `${RUN}@test.local`, role: "BUSINESS" } });
  ownerId = owner.id;
  businessId1 = (await prisma.business.create({ data: { ownerId, name: `${RUN} Multi`, type: "clinic" } })).id;
  businessId2 = (await prisma.business.create({ data: { ownerId, name: `${RUN} Single`, type: "clinic" } })).id;

  await ingestKnowledgeFiles({
    businessId: businessId1,
    files: [{ filename: "multi_doctor.txt", mimeType: "text/plain", bytes: Buffer.from(MULTI_DOCTOR_BROCHURE) }]
  });

  await ingestKnowledgeFiles({
    businessId: businessId2,
    files: [{ filename: "single_doctor.txt", mimeType: "text/plain", bytes: Buffer.from(SINGLE_DOCTOR_BROCHURE) }]
  });
});

afterAll(async () => {
  if (!dbAvailable) return;
  await prisma.businessKnowledgeFile.deleteMany({ where: { businessId: { in: [businessId1, businessId2] } } });
  await prisma.businessKnowledgeBase.deleteMany({ where: { businessId: { in: [businessId1, businessId2] } } });
  await prisma.business.deleteMany({ where: { id: { in: [businessId1, businessId2] } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
});

describe("document-profile-extractor", () => {
  it("extracts all doctors and designates ONE primary doctor for multi-doctor documents", async () => {
    if (!dbAvailable) return;

    const result = await extractProfileFromDocuments({ businessId: businessId1 });
    expect(result).not.toBeNull();
    expect(result!.multipleDoctorsDetected).toBe(true);
    expect(result!.doctorNames.length).toBe(3);
    expect(result!.doctorNames).toContain("Dr. Sarah Jenkins");
    expect(result!.doctorNames).toContain("Dr. Michael Chang");
    expect(result!.doctorNames).toContain("Dr. Emily Watson");
    expect(result!.primaryDoctor).toBe("Dr. Sarah Jenkins");
    expect(result!.registrationNumber).toBe("REG-987654");
    expect(result!.businessType).toBe("Dental Clinics");
    expect(result!.services).toContain("Root Canal Therapy");
    expect(result!.phone).toBe("(555) 234-5678");
  }, 40000);

  it("handles single-doctor documents gracefully", async () => {
    if (!dbAvailable) return;

    const result = await extractProfileFromDocuments({ businessId: businessId2 });
    expect(result).not.toBeNull();
    expect(result!.multipleDoctorsDetected).toBe(false);
    expect(result!.doctorNames).toEqual(["Dr. Robert Vance"]);
    expect(result!.primaryDoctor).toBe("Dr. Robert Vance");
    expect(result!.registrationNumber).toBe("MD-123456");
    expect(result!.services).toContain("General Checkup");
  }, 40000);

  it("deduplicates concurrent extraction requests for the same businessId", async () => {
    if (!dbAvailable) return;

    const [res1, res2] = await Promise.all([
      extractProfileFromDocuments({ businessId: businessId1 }),
      extractProfileFromDocuments({ businessId: businessId1 })
    ]);

    expect(res1).toEqual(res2);
  }, 40000);
  it("fallback parser recognizes Legal, Real Estate, Automotive, and non-dental Healthcare contacts", () => {
    const law = extractProfileFallbackFromText("Morgan & Lee Law Firm\nAlex Morgan, Esq.\nAttorney: Jamie Lee\nCase Consultation");
    expect(law.businessType).toBe("Law Firms");
    expect(law.doctorNames).toEqual(expect.arrayContaining(["Alex Morgan", "Jamie Lee"]));

    const realEstate = extractProfileFallbackFromText("Summit Commercial Real Estate\nJordan Blake — Broker\nProperty Viewing");
    expect(realEstate.businessType).toBe("Commercial Real Estate");
    expect(realEstate.doctorNames).toContain("Jordan Blake");

    const automotive = extractProfileFallbackFromText("Northside Motors Dealership\nSales Manager: Taylor Reed\nVehicle Test Drive");
    expect(automotive.businessType).toBe("Car Dealerships");
    expect(automotive.doctorNames).toContain("Taylor Reed");

    const therapy = extractProfileFallbackFromText("Harbor Mental Health Clinic\nTherapist: Casey Stone\nConsultation");
    expect(therapy.businessType).toBe("Mental Health Clinics");
    expect(therapy.doctorNames).toContain("Casey Stone");
  });

});
