import { randomUUID } from "node:crypto";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env";

export const IMAGE_UPLOAD_KINDS = ["icon", "screenshot"] as const;
export type ImageUploadKind = (typeof IMAGE_UPLOAD_KINDS)[number];

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/svg+xml": "svg"
};

const MAX_BYTES: Record<ImageUploadKind, number> = {
  icon: 1 * 1024 * 1024,
  screenshot: 3 * 1024 * 1024
};

export function isImageUploadConfigured(): boolean {
  return Boolean(
    env.S3_UPLOAD_BUCKET &&
      (env.S3_UPLOAD_REGION ?? env.AWS_REGION) &&
      env.AWS_ACCESS_KEY_ID &&
      env.AWS_SECRET_ACCESS_KEY
  );
}

let uploadClient: S3Client | null = null;

function getUploadClient(): S3Client {
  if (!uploadClient) {
    uploadClient = new S3Client({
      region: (env.S3_UPLOAD_REGION ?? env.AWS_REGION) as string,
      credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID as string,
        secretAccessKey: env.AWS_SECRET_ACCESS_KEY as string
      }
    });
  }
  return uploadClient;
}

function publicUrlForKey(key: string): string {
  const base = env.S3_UPLOAD_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (base) return `${base}/${key}`;
  const region = env.S3_UPLOAD_REGION ?? env.AWS_REGION;
  return `https://${env.S3_UPLOAD_BUCKET}.s3.${region}.amazonaws.com/${key}`;
}

export type ImageUploadResult =
  | { ok: true; url: string; key: string; bytes: number }
  | { ok: false; code: "NOT_CONFIGURED" | "INVALID_TYPE" | "TOO_LARGE" | "EMPTY" | "UPLOAD_FAILED"; message: string };

export async function uploadListingImage(params: {
  buffer: Buffer;
  contentType: string;
  kind: ImageUploadKind;
}): Promise<ImageUploadResult> {
  if (!isImageUploadConfigured()) {
    return { ok: false, code: "NOT_CONFIGURED", message: "Image storage is not configured." };
  }

  const extension = CONTENT_TYPE_EXTENSIONS[params.contentType];
  if (!extension) {
    return { ok: false, code: "INVALID_TYPE", message: "Image must be a PNG, JPG, WEBP, or SVG." };
  }
  if (params.buffer.byteLength === 0) {
    return { ok: false, code: "EMPTY", message: "The uploaded file is empty." };
  }
  if (params.buffer.byteLength > MAX_BYTES[params.kind]) {
    const mb = Math.round(MAX_BYTES[params.kind] / (1024 * 1024));
    return { ok: false, code: "TOO_LARGE", message: `${params.kind === "icon" ? "Icon" : "Screenshot"} must be under ${mb}MB.` };
  }

  const prefix = env.S3_UPLOAD_PREFIX.replace(/^\/+|\/+$/g, "");
  const key = `${prefix}/${params.kind}s/${randomUUID()}.${extension}`;

  try {
    await getUploadClient().send(
      new PutObjectCommand({
        Bucket: env.S3_UPLOAD_BUCKET as string,
        Key: key,
        Body: params.buffer,
        ContentType: params.contentType,
        CacheControl: "public, max-age=31536000, immutable",
        ContentDisposition: "inline"
      })
    );
  } catch (error) {
    console.error("[storage] listing image upload failed", {
      key,
      error: error instanceof Error ? error.message : String(error)
    });
    return { ok: false, code: "UPLOAD_FAILED", message: "The image could not be uploaded. Please try again." };
  }

  return { ok: true, url: publicUrlForKey(key), key, bytes: params.buffer.byteLength };
}
