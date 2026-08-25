/**
 * THE DOOR'S BOUNCER — the admin's upload dials, enforced in one place.
 *
 * Two dials, both admin-owned: the biggest file the platform will read
 * (shared with Memory — one fact, one home) and whether pictures are allowed
 * at all. Every path a customer's file can arrive by calls this before the
 * engine sees a byte, so the public page and the builder's preview can never
 * drift apart on what they accept.
 *
 * Returns a sentence for the customer, or null to let the file through.
 * A sentence, because "422" is not an answer a person can act on.
 */

import { getMemoryLimits } from "../admin/memory-limits";
import { getFileUploadImagesAllowed } from "../admin/node-limits";

export async function refuseUploadIfBeyondLimits(upload: {
  name?: string;
  mimeType?: string;
  data?: string;
}): Promise<string | null> {
  const mime = (upload.mimeType ?? "").toLowerCase();

  if (mime.startsWith("video/")) {
    return "Videos can't be read yet — a document or a picture works.";
  }

  if (mime.startsWith("image/")) {
    const imagesAllowed = await getFileUploadImagesAllowed().catch(() => true);
    if (!imagesAllowed) return "Pictures are switched off here — a document works.";
  }

  /* A data URL is ~4/3 the size of the file. Undoing that ratio means the
     limit an admin reads on their screen is the limit a real file meets. */
  const { biggestFileMb } = await getMemoryLimits().catch(() => ({ biggestFileMb: 5 }));
  const approxBytes = ((upload.data ?? "").length * 3) / 4;
  if (approxBytes > biggestFileMb * 1024 * 1024) {
    return `That file is over ${biggestFileMb} MB — a smaller one works.`;
  }

  return null;
}
