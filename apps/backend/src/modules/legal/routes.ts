import { Hono } from "hono";
import PDFDocument from "pdfkit";
import { successResponse } from "../../lib/api-response";
import { sendPlatformEmail } from "../../lib/mailer";
import { requireAuth } from "../../middleware/auth";

const SUPPORT_EMAIL = "support@triven.ai";

const DPA_SECTIONS = [
  {
    title: "1. Definitions",
    paragraphs: [
      "Data Controller means the customer that determines the purposes and means of processing personal data. Data Processor means Triven, which processes personal data on the documented instructions of the Data Controller.",
      "Personal Data means information relating to an identified or identifiable person. Processing includes collecting, storing, using, transmitting, and deleting Personal Data. A Sub-processor is a third party engaged by Triven to process Personal Data."
    ]
  },
  {
    title: "2. Scope of Processing",
    paragraphs: [
      "Triven processes the minimum data required to provide configured AI agents and related services. This can include caller phone numbers, call metadata, message content, appointment details, business configuration, and execution logs.",
      "Triven processes Personal Data only for the services selected by the Data Controller and does not sell Personal Data."
    ]
  },
  {
    title: "3. Data Categories and Retention",
    paragraphs: [
      "Caller phone numbers may be retained for up to 90 days; SMS content for up to 30 days; call metadata for up to 12 months; execution logs for up to 14 days; and business configuration for the account lifetime, unless law or a documented customer instruction requires otherwise."
    ]
  },
  {
    title: "4. Processing Purposes",
    paragraphs: [
      "Permitted purposes are executing AI-agent workflows, delivering customer communications, creating customer analytics, improving service quality with aggregated or anonymized data, preventing fraud, and maintaining platform security."
    ]
  },
  {
    title: "5. Security Measures",
    paragraphs: [
      "Triven maintains appropriate technical and organizational safeguards, including encryption in transit and at rest, access controls, least-privilege practices, backups, security monitoring, incident response procedures, and workforce security training."
    ]
  },
  {
    title: "6. Sub-processors",
    paragraphs: [
      "Triven may use vetted infrastructure, communications, payment, and AI service providers, including Amazon Web Services, Twilio, Stripe, and OpenAI. Each Sub-processor is contractually required to protect Personal Data consistently with this agreement."
    ]
  },
  {
    title: "7. Data Subject Rights",
    paragraphs: [
      "Triven will reasonably assist the Data Controller with requests for access, rectification, erasure, portability, restriction, or objection, taking into account the nature of the processing and applicable law."
    ]
  },
  {
    title: "8. Personal Data Breach",
    paragraphs: [
      "Triven will notify the Data Controller without undue delay after becoming aware of a Personal Data breach and will provide available information about its nature, affected data, likely consequences, and remediation measures."
    ]
  },
  {
    title: "9. Deletion and Return",
    paragraphs: [
      "At termination or upon a valid documented request, Triven will delete or return Personal Data unless retention is required by law. Production data is targeted for deletion within 30 days and residual backup copies within 90 days."
    ]
  },
  {
    title: "10. International Transfers",
    paragraphs: [
      "Where Personal Data is transferred across borders, Triven will use a lawful transfer mechanism, including applicable Standard Contractual Clauses, and appropriate supplementary safeguards."
    ]
  },
  {
    title: "11. Audit Rights",
    paragraphs: [
      "Triven will make information reasonably necessary to demonstrate compliance available to the Data Controller and will support one reasonable audit per calendar year with advance written notice, subject to confidentiality and security requirements."
    ]
  },
  {
    title: "12. Term and Termination",
    paragraphs: [
      "This DPA remains effective while Triven processes Personal Data for the Data Controller. Obligations that by their nature should survive termination, including confidentiality, security, deletion, and audit obligations, will survive."
    ]
  }
] as const;

function createDpaPdf(): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54, bufferPages: true, info: {
      Title: "Triven Data Processing Agreement",
      Author: "Triven",
      Subject: "Data Processing Agreement"
    } });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    doc.fillColor("#f59e0b").font("Helvetica-Bold").fontSize(24).text("TRIVEN");
    doc.moveDown(2.2);
    doc.fillColor("#0f172a").fontSize(28).text("Data Processing Agreement", { align: "center" });
    doc.moveDown(0.6);
    doc.fillColor("#475569").font("Helvetica").fontSize(11).text(
      "Transparent data protection terms for Triven customers and architects.",
      { align: "center" }
    );
    doc.moveDown(1.2);
    doc.fillColor("#64748b").fontSize(9).text("Version 1.0  |  Effective July 16, 2026", { align: "center" });
    doc.moveDown(2);
    doc.strokeColor("#f59e0b").lineWidth(2).moveTo(54, doc.y).lineTo(541, doc.y).stroke();
    doc.moveDown(1.5);
    doc.fillColor("#334155").fontSize(10).text(
      "This Data Processing Agreement (DPA) forms part of the agreement between Triven and the customer using Triven services where Triven processes Personal Data on the customer's behalf.",
      { lineGap: 4, align: "justify" }
    );

    for (const section of DPA_SECTIONS) {
      doc.moveDown(1.4);
      if (doc.y > 700) doc.addPage();
      doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(14).text(section.title);
      doc.moveDown(0.45);
      for (const paragraph of section.paragraphs) {
        doc.fillColor("#334155").font("Helvetica").fontSize(9.5).text(paragraph, {
          lineGap: 3,
          align: "justify"
        });
        doc.moveDown(0.6);
      }
    }

    doc.moveDown(1.5);
    doc.fillColor("#0f172a").font("Helvetica-Bold").fontSize(12).text("Contact");
    doc.moveDown(0.4);
    doc.fillColor("#334155").font("Helvetica").fontSize(9.5).text(
      "Questions and signed-DPA requests: support@triven.ai"
    );

    const pages = doc.bufferedPageRange();
    for (let page = pages.start; page < pages.start + pages.count; page += 1) {
      doc.switchToPage(page);
      doc.fillColor("#94a3b8").font("Helvetica").fontSize(8).text(
        `Triven Data Processing Agreement  |  Page ${page + 1} of ${pages.count}`,
        54,
        806,
        { width: 487, align: "center", lineBreak: false }
      );
    }

    doc.end();
  });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character] ?? character);
}

export const legalRoutes = new Hono();

legalRoutes.get("/dpa.pdf", async (c) => {
  const pdf = await createDpaPdf();
  return new Response(new Uint8Array(pdf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": 'attachment; filename="triven-data-processing-agreement.pdf"',
      "Cache-Control": "public, max-age=3600"
    }
  });
});

legalRoutes.post("/dpa/requests", requireAuth, async (c) => {
  const authUser = c.get("authUser");
  const body: Record<string, unknown> = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}));
  const company = typeof body.company === "string" ? body.company.trim().slice(0, 200) : "";
  const industry = typeof body.industry === "string" ? body.industry.trim().slice(0, 100) : "";
  const requirements = typeof body.requirements === "string" ? body.requirements.trim().slice(0, 4000) : "";
  const requesterName =
    (typeof body.fullName === "string" ? body.fullName.trim().slice(0, 200) : "") ||
    authUser.fullName ||
    "Not provided";
  const requesterEmail =
    (typeof body.email === "string" ? body.email.trim().slice(0, 320) : "") || authUser.email;
  const requestedAt = new Date().toISOString();
  const lines = [
    "A signed Data Processing Agreement has been requested.",
    "",
    `Requester: ${requesterName}`,
    `Account email: ${authUser.email}`,
    `Reply email: ${requesterEmail}`,
    `Account role: ${authUser.role}`,
    `Company: ${company || "Not provided"}`,
    `Industry: ${industry || "Not provided"}`,
    `Requirements: ${requirements || "None provided"}`,
    `User ID: ${authUser.id}`,
    `Requested at: ${requestedAt}`
  ];

  await sendPlatformEmail({
    purpose: "support",
    to: SUPPORT_EMAIL,
    subject: `Signed DPA request - ${company || requesterName}`,
    text: lines.join("\n"),
    html: `<h2>Signed DPA request</h2><p>A user has requested a countersigned Data Processing Agreement.</p><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#e2e8f0"><tr><th align="left">Requester</th><td>${escapeHtml(requesterName)}</td></tr><tr><th align="left">Account email</th><td>${escapeHtml(authUser.email)}</td></tr><tr><th align="left">Reply email</th><td>${escapeHtml(requesterEmail)}</td></tr><tr><th align="left">Role</th><td>${escapeHtml(authUser.role)}</td></tr><tr><th align="left">Company</th><td>${escapeHtml(company || "Not provided")}</td></tr><tr><th align="left">Industry</th><td>${escapeHtml(industry || "Not provided")}</td></tr><tr><th align="left">Requirements</th><td>${escapeHtml(requirements || "None provided")}</td></tr><tr><th align="left">User ID</th><td>${escapeHtml(authUser.id)}</td></tr><tr><th align="left">Requested at</th><td>${escapeHtml(requestedAt)}</td></tr></table>`
  });

  return successResponse(c, { requestedAt }, "Signed DPA request sent", 201);
});
