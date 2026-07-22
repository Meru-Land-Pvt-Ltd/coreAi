import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const DPA_FILE_NAME = "Triven_Data_Processing_Agreement_v1.1_PreSigned.pdf";
export const DPA_TEMPLATE_SHA256 =
  "63ab4f9f535e0a26e69a0fe83113ac0fa2464ec05cc386e353482f04e23b76af";

const DPA_TEMPLATE_PATH = path.resolve(__dirname, "../../../assets", DPA_FILE_NAME);
const TRIVEN_LOGO_PATH = path.resolve(
  __dirname,
  "../../../assets/triven.ai word logo transparent bg.PNG"
);

// Matches --app-accent and Tailwind's amber-500 used by the Triven.ai UI.
const TRIVEN_AMBER = rgb(245 / 255, 158 / 255, 11 / 255);
const WHITE = rgb(1, 1, 1);

async function readVerifiedTemplate(): Promise<Buffer> {
  const template = await readFile(DPA_TEMPLATE_PATH);
  const digest = createHash("sha256").update(template).digest("hex");

  if (digest !== DPA_TEMPLATE_SHA256) {
    throw new Error(
      `DPA template checksum mismatch: expected ${DPA_TEMPLATE_SHA256}, received ${digest}`
    );
  }

  return template;
}

/**
 * Uses the approved pre-signed v1.1 PDF as the immutable base and replaces only
 * its text-only header brand with the Triven logo and UI-matched wordmark.
 */
export async function createDpaPdf(): Promise<Buffer> {
  const [template, logo] = await Promise.all([readVerifiedTemplate(), readFile(TRIVEN_LOGO_PATH)]);
  const document = await PDFDocument.load(template, { updateMetadata: false });
  const pages = document.getPages();

  if (pages.length !== 3) {
    throw new Error(`DPA template must contain exactly 3 pages; received ${pages.length}`);
  }

  const firstPage = pages[0];
  const [logoImage, wordmarkFont] = await Promise.all([
    document.embedPng(logo),
    document.embedFont(StandardFonts.HelveticaBold)
  ]);

  // Cover only the original plain "TRIVEN" label. All agreement content and
  // page geometry below it remain untouched.
  firstPage.drawRectangle({ x: 38, y: 774, width: 158, height: 34, color: WHITE });
  firstPage.drawImage(logoImage, { x: 37, y: 771, width: 38, height: 36 });
  firstPage.drawText("Triven.ai", {
    x: 75,
    y: 786,
    size: 17,
    font: wordmarkFont,
    color: TRIVEN_AMBER
  });

  // Match the DPA title to the same amber and preserve the source's exact
  // 15pt Nimbus/Helvetica-bold sizing and left alignment.
  firstPage.drawRectangle({ x: 40, y: 748, width: 250, height: 21, color: WHITE });
  firstPage.drawText("Data Processing Agreement (DPA)", {
    x: 42.52,
    y: 751,
    size: 15,
    font: wordmarkFont,
    color: TRIVEN_AMBER
  });

  document.setTitle("Triven Data Processing Agreement v1.1");
  document.setAuthor("Triven.ai, Inc.");
  document.setSubject("Pre-signed Data Processing Agreement");
  document.setCreator("Triven.ai Legal & Compliance");
  document.setProducer("Triven.ai Legal & Compliance");

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

let cachedDpaPdf: Promise<Buffer> | undefined;

export function getDpaPdf(): Promise<Buffer> {
  cachedDpaPdf ??= createDpaPdf().catch((error) => {
    cachedDpaPdf = undefined;
    throw error;
  });

  return cachedDpaPdf;
}
