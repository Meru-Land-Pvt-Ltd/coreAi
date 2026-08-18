/**
 * Media helpers shared by the product blocks — the exact URL heuristics the
 * media template uses, so blocks and template render media identically.
 * Media arrives either as http(s) URLs or as data: URIs (the image engine
 * returns inline data) — data URIs render in <img>/<video> but browsers block
 * opening them as a page, so their tile action is a real download instead of
 * open-in-new-tab.
 */

const VIDEO_URL_PATTERN = /\.(mp4|webm|mov|m4v)([?#]|$)/i;
const IMAGE_URL_PATTERN = /\.(png|jpe?g|webp|gif|avif|svg)([?#]|$)/i;

export function isVideoUrl(url: string): boolean {
  return url.startsWith("data:video/") || VIDEO_URL_PATTERN.test(url);
}

/**
 * True when the URL is unmistakably an image (data:image/ or an image file
 * extension). Used so a Result Viewer forced to "video" never wraps an
 * obvious image in a <video> tag — that renders as a black broken tile.
 */
export function isImageLikeUrl(url: string): boolean {
  return url.startsWith("data:image/") || IMAGE_URL_PATTERN.test(url);
}

export function isDataUri(url: string): boolean {
  return url.startsWith("data:");
}

/** Download filename for a data-URI tile, matching the media template. */
export function mediaDownloadName(listingName: string, index: number): string {
  return `${listingName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "creation"}-${index + 1}`;
}
