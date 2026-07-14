import { randomBytes } from "node:crypto";

/**
 * Minimal RFC 5322 / MIME composer for SESv2 raw sends — replaces nodemailer's
 * MailComposer. Supports text + HTML alternatives, Reply-To, and binary
 * attachments (invoice PDFs). All bodies/attachments are base64-encoded, which
 * sidesteps line-length and dot-stuffing pitfalls entirely.
 */

export type MimeAttachment = {
  filename: string;
  content: Buffer | string;
  contentType?: string;
};

export type MimeMessageInput = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  attachments?: MimeAttachment[];
};

const CRLF = "\r\n";

function boundary(tag: string): string {
  return `----=_Triven_${tag}_${randomBytes(12).toString("hex")}`;
}

/** RFC 2047 B-encoding for non-ASCII header text (subjects, display names). */
export function encodeHeaderText(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Encode the display-name part of "Display Name <addr>" when non-ASCII. */
export function encodeAddressHeader(value: string): string {
  const match = value.match(/^(.*)<([^>]+)>\s*$/);
  if (!match) return value;
  const display = match[1].trim().replace(/^"|"$/g, "");
  if (!display) return `<${match[2].trim()}>`;
  return `${encodeHeaderText(display)} <${match[2].trim()}>`;
}

function base64Lines(content: Buffer): string {
  return content.toString("base64").replace(/(.{76})/g, `$1${CRLF}`);
}

function textPart(contentType: string, body: string): string {
  return [
    `Content-Type: ${contentType}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(Buffer.from(body, "utf8"))
  ].join(CRLF);
}

function attachmentPart(attachment: MimeAttachment): string {
  const content =
    typeof attachment.content === "string" ? Buffer.from(attachment.content, "utf8") : attachment.content;
  const safeName = attachment.filename.replace(/["\r\n]/g, "");
  return [
    `Content-Type: ${attachment.contentType ?? "application/octet-stream"}; name="${safeName}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: attachment; filename="${safeName}"`,
    "",
    base64Lines(content)
  ].join(CRLF);
}

/** multipart/alternative when HTML exists, otherwise a bare text part. */
function bodyPart(input: MimeMessageInput): string {
  if (!input.html) return textPart("text/plain", input.text);

  const alt = boundary("alt");
  return [
    `Content-Type: multipart/alternative; boundary="${alt}"`,
    "",
    `--${alt}`,
    textPart("text/plain", input.text),
    `--${alt}`,
    textPart("text/html", input.html),
    `--${alt}--`
  ].join(CRLF);
}

export function buildRawMimeMessage(input: MimeMessageInput): Buffer {
  const headers = [
    `From: ${encodeAddressHeader(input.from)}`,
    `To: ${encodeAddressHeader(input.to)}`,
    `Subject: ${encodeHeaderText(input.subject)}`,
    ...(input.replyTo ? [`Reply-To: ${encodeAddressHeader(input.replyTo)}`] : []),
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0"
  ];

  const attachments = input.attachments ?? [];

  if (attachments.length === 0) {
    return Buffer.from([...headers, bodyPart(input)].join(CRLF), "utf8");
  }

  const mixed = boundary("mix");
  const lines = [
    ...headers,
    `Content-Type: multipart/mixed; boundary="${mixed}"`,
    "",
    `--${mixed}`,
    bodyPart(input),
    ...attachments.flatMap((attachment) => [`--${mixed}`, attachmentPart(attachment)]),
    `--${mixed}--`,
    ""
  ];

  return Buffer.from(lines.join(CRLF), "utf8");
}
