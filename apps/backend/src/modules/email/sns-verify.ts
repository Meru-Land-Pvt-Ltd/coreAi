import { createVerify } from "node:crypto";
import { env } from "../../config/env";

const CERT_CACHE = new Map<string, string>();
const MAX_TIMESTAMP_SKEW_MS = 15 * 60 * 1000;

export type SnsEnvelope = {
  Type: string;
  MessageId: string;
  TopicArn?: string;
  Subject?: string;
  Message: string;
  Timestamp: string;
  SignatureVersion?: string;
  Signature?: string;
  SigningCertURL?: string;
  SubscribeURL?: string;
  Token?: string;
};

export function asSnsEnvelope(payload: unknown): SnsEnvelope | null {
  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.Type !== "string" || typeof record.Message !== "string") return null;
  return record as SnsEnvelope;
}

/** SNS cert/subscribe URLs must be HTTPS on an sns.<region>.amazonaws.com host. */
export function isTrustedAwsSnsUrl(value: string | undefined): boolean {
  if (!value) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/.test(url.hostname);
}

function buildStringToSign(message: SnsEnvelope): string | null {
  const lines: string[] = [];
  const push = (key: keyof SnsEnvelope) => {
    const value = message[key];
    if (typeof value === "string") lines.push(`${key}\n${value}`);
  };

  if (message.Type === "Notification") {
    push("Message");
    push("MessageId");
    if (typeof message.Subject === "string") push("Subject");
    push("Timestamp");
    push("TopicArn");
    push("Type");
  } else if (message.Type === "SubscriptionConfirmation" || message.Type === "UnsubscribeConfirmation") {
    push("Message");
    push("MessageId");
    push("SubscribeURL");
    push("Timestamp");
    push("Token");
    push("TopicArn");
    push("Type");
  } else {
    return null;
  }

  return lines.join("\n") + "\n";
}

async function fetchSigningCert(certUrl: string): Promise<string | null> {
  const cached = CERT_CACHE.get(certUrl);
  if (cached) return cached;

  try {
    const response = await fetch(certUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const pem = await response.text();
    if (!pem.includes("BEGIN CERTIFICATE")) return null;
    // Signing certs rotate rarely; a bounded cache avoids refetching per event.
    if (CERT_CACHE.size > 20) CERT_CACHE.clear();
    CERT_CACHE.set(certUrl, pem);
    return pem;
  } catch {
    return null;
  }
}

export function isSnsVerificationEnforced(): boolean {
  if (env.NODE_ENV === "production") return true;
  return env.SES_SNS_VERIFY;
}

export type SnsVerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifySnsMessage(payload: unknown): Promise<SnsVerifyResult> {
  const message = asSnsEnvelope(payload);
  if (!message) return { ok: false, reason: "not an SNS envelope" };

  if (!isSnsVerificationEnforced()) return { ok: true };

  if (!message.Signature || !message.SigningCertURL) {
    return { ok: false, reason: "missing Signature/SigningCertURL" };
  }
  if (!isTrustedAwsSnsUrl(message.SigningCertURL)) {
    return { ok: false, reason: "untrusted SigningCertURL host" };
  }

  const timestampMs = Date.parse(message.Timestamp ?? "");
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_TIMESTAMP_SKEW_MS) {
    return { ok: false, reason: "stale or invalid Timestamp" };
  }

  const stringToSign = buildStringToSign(message);
  if (!stringToSign) return { ok: false, reason: `unsupported Type: ${message.Type}` };

  const pem = await fetchSigningCert(message.SigningCertURL);
  if (!pem) return { ok: false, reason: "signing certificate fetch failed" };

  const algorithm = message.SignatureVersion === "2" ? "RSA-SHA256" : "RSA-SHA1";
  try {
    const verifier = createVerify(algorithm);
    verifier.update(stringToSign, "utf8");
    const valid = verifier.verify(pem, message.Signature, "base64");
    return valid ? { ok: true } : { ok: false, reason: "signature mismatch" };
  } catch {
    return { ok: false, reason: "signature verification error" };
  }
}
