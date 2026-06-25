import crypto from "crypto";
import { google, gmail_v1 } from "googleapis";
import { env } from "../../config/env";
import { encryptSecret, decryptSecret } from "../../lib/crypto";
import { prisma } from "../../lib/prisma";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.compose"
];

export type GmailEmail = {
  id: string;
  threadId: string | null;
  from: string;
  senderName: string | null;
  senderEmail: string;
  to: string;
  subject: string;
  snippet: string;
  body: string;
  textBody: string;
  htmlBody: string;
  date: string | null;
  internalDate: string | null;
  labelIds: string[];
  attachments: {
    id: string | null;
    filename: string;
    mimeType: string;
    size: number;
  }[];
  gmailUrl: string | null;
};

export type GmailSendResult = {
  id: string | null;
  threadId: string | null;
  to: string;
  subject: string;
  body: string;
  gmailUrl: string | null;
};

export type GmailDraftResult = {
  id: string | null;
  messageId: string | null;
  threadId: string | null;
  to: string;
  subject: string;
  body: string;
  gmailUrl: string | null;
};

function getRedirectUri() {
  return (
    env.GMAIL_OAUTH_REDIRECT_URI ??
    `${env.BACKEND_URL}/architect/connectors/gmail/callback`
  );
}

function assertGoogleConfig() {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error("Google OAuth env variables are missing");
  }

  if (!env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing");
  }
}

function createOAuthClient() {
  assertGoogleConfig();

  return new google.auth.OAuth2({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: getRedirectUri()
  });
}

function signStatePayload(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${signature}`;
}

function verifyStatePayload(state: string) {
  const [body, signature] = state.split(".");

  if (!body || !signature) {
    throw new Error("Invalid OAuth state");
  }

  const expectedSignature = crypto
    .createHmac("sha256", env.JWT_SECRET)
    .update(body)
    .digest("base64url");

  const signatureBuffer = Buffer.from(signature);
  const expectedSignatureBuffer = Buffer.from(expectedSignature);

  if (
    signatureBuffer.length !== expectedSignatureBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedSignatureBuffer)
  ) {
    throw new Error("Invalid OAuth state signature");
  }

  let payload: {
    userId?: unknown;
    createdAt?: unknown;
  };

  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid OAuth state payload");
  }

  if (typeof payload.userId !== "string") {
    throw new Error("Invalid OAuth state user");
  }

  const createdAt =
    typeof payload.createdAt === "number" ? payload.createdAt : 0;

  const ageMs = Date.now() - createdAt;

  if (ageMs > 10 * 60 * 1000) {
    throw new Error("OAuth state expired");
  }

  return {
    userId: payload.userId
  };
}

export function createGmailOAuthUrl(userId: string) {
  const oauth2Client = createOAuthClient();

  const state = signStatePayload({
    userId,
    createdAt: Date.now()
  });

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    scope: GMAIL_SCOPES,
    state
  });
}

export async function handleGmailOAuthCallback({
  code,
  state
}: {
  code: string;
  state: string;
}) {
  const { userId } = verifyStatePayload(state);
  const oauth2Client = createOAuthClient();

  const tokenResponse = await oauth2Client.getToken(code);
  const tokens = tokenResponse.tokens;

  oauth2Client.setCredentials(tokens);

  const gmail = google.gmail({
    version: "v1",
    auth: oauth2Client
  });

  const profile = await gmail.users.getProfile({
    userId: "me"
  });

  const existingCredential = await prisma.connectorCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "GMAIL"
      }
    }
  });

  const accessTokenEnc = tokens.access_token
    ? encryptSecret(tokens.access_token)
    : existingCredential?.accessTokenEnc ?? null;

  const refreshTokenEnc = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : existingCredential?.refreshTokenEnc ?? null;

  await prisma.connectorCredential.upsert({
    where: {
      userId_provider: {
        userId,
        provider: "GMAIL"
      }
    },
    update: {
      externalAccountEmail: profile.data.emailAddress ?? null,
      accessTokenEnc,
      refreshTokenEnc,
      scope: tokens.scope ?? existingCredential?.scope ?? null,
      tokenType: tokens.token_type ?? existingCredential?.tokenType ?? null,
      expiresAt: tokens.expiry_date
        ? new Date(tokens.expiry_date)
        : existingCredential?.expiresAt ?? null
    },
    create: {
      userId,
      provider: "GMAIL",
      externalAccountEmail: profile.data.emailAddress ?? null,
      accessTokenEnc,
      refreshTokenEnc,
      scope: tokens.scope ?? null,
      tokenType: tokens.token_type ?? null,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null
    }
  });

  return {
    userId,
    email: profile.data.emailAddress ?? null
  };
}

export async function getGmailConnectionStatus(userId: string) {
  const credential = await prisma.connectorCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "GMAIL"
      }
    }
  });

  return {
    connected: Boolean(credential?.refreshTokenEnc || credential?.accessTokenEnc),
    email: credential?.externalAccountEmail ?? null,
    provider: "GMAIL",
    expiresAt: credential?.expiresAt?.toISOString() ?? null,
    scopes: credential?.scope?.split(" ") ?? []
  };
}

export async function disconnectGmail(userId: string) {
  await prisma.connectorCredential.deleteMany({
    where: {
      userId,
      provider: "GMAIL"
    }
  });
}

export async function createAuthorizedGmailClient(userId: string) {
  const credential = await prisma.connectorCredential.findUnique({
    where: {
      userId_provider: {
        userId,
        provider: "GMAIL"
      }
    }
  });

  if (!credential?.refreshTokenEnc && !credential?.accessTokenEnc) {
    throw new Error("Gmail is not connected");
  }

  const oauth2Client = createOAuthClient();

  oauth2Client.setCredentials({
    access_token: credential.accessTokenEnc
      ? decryptSecret(credential.accessTokenEnc)
      : undefined,
    refresh_token: credential.refreshTokenEnc
      ? decryptSecret(credential.refreshTokenEnc)
      : undefined,
    token_type: credential.tokenType ?? undefined,
    expiry_date: credential.expiresAt?.getTime()
  });

  oauth2Client.on("tokens", async (tokens) => {
    await prisma.connectorCredential.update({
      where: {
        userId_provider: {
          userId,
          provider: "GMAIL"
        }
      },
      data: {
        accessTokenEnc: tokens.access_token
          ? encryptSecret(tokens.access_token)
          : undefined,
        refreshTokenEnc: tokens.refresh_token
          ? encryptSecret(tokens.refresh_token)
          : undefined,
        expiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : undefined,
        tokenType: tokens.token_type ?? undefined,
        scope: tokens.scope ?? undefined
      }
    });
  });

  return google.gmail({
    version: "v1",
    auth: oauth2Client
  });
}

function decodeBase64Url(value?: string | null) {
  if (!value) return "";

  try {
    return Buffer.from(value, "base64url").toString("utf8");
  } catch {
    return "";
  }
}

function decodeMimeHeader(value?: string | null) {
  if (!value) return "";

  return value.replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]+)\?=/g,
    (_match, charset: string, encoding: string, encodedText: string) => {
      try {
        if (encoding.toUpperCase() === "B") {
          return Buffer.from(encodedText, "base64").toString(
            charset.toLowerCase() === "utf-8" ? "utf8" : "utf8"
          );
        }

        const qDecoded = encodedText
          .replace(/_/g, " ")
          .replace(/=([a-fA-F0-9]{2})/g, (_hexMatch, hex: string) =>
            String.fromCharCode(parseInt(hex, 16))
          );

        return qDecoded;
      } catch {
        return encodedText;
      }
    }
  );
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractHeader(message: gmail_v1.Schema$Message, name: string) {
  const value =
    message.payload?.headers?.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? "";

  return decodeMimeHeader(value);
}

function parseEmailAddress(value: string) {
  const decoded = decodeMimeHeader(value).trim();

  const match = decoded.match(/^(.*?)\s*<(.+?)>$/);

  if (match) {
    const name = match[1]?.replace(/^"|"$/g, "").trim() || null;
    const email = match[2]?.trim() || decoded;

    return {
      name,
      email
    };
  }

  return {
    name: null,
    email: decoded
  };
}

function getGmailMessageUrl(messageId?: string | null) {
  if (!messageId) return null;
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

function getGmailDraftUrl(draftId?: string | null) {
  if (!draftId) return null;
  return `https://mail.google.com/mail/u/0/#drafts/${draftId}`;
}

function collectMessageBodiesAndAttachments(
  part?: gmail_v1.Schema$MessagePart | null
): {
  textBodies: string[];
  htmlBodies: string[];
  attachments: GmailEmail["attachments"];
} {
  const textBodies: string[] = [];
  const htmlBodies: string[] = [];
  const attachments: GmailEmail["attachments"] = [];

  function walk(current?: gmail_v1.Schema$MessagePart | null) {
    if (!current) return;

    const mimeType = current.mimeType ?? "";
    const filename = current.filename ?? "";
    const bodyData = current.body?.data ?? null;

    if (filename) {
      attachments.push({
        id: current.body?.attachmentId ?? null,
        filename,
        mimeType,
        size: current.body?.size ?? 0
      });
    }

    if (bodyData && mimeType.toLowerCase().startsWith("text/plain")) {
      const decoded = decodeBase64Url(bodyData).trim();
      if (decoded) textBodies.push(decoded);
    }

    if (bodyData && mimeType.toLowerCase().startsWith("text/html")) {
      const decoded = decodeBase64Url(bodyData).trim();
      if (decoded) htmlBodies.push(decoded);
    }

    for (const nestedPart of current.parts ?? []) {
      walk(nestedPart);
    }
  }

  walk(part);

  return {
    textBodies,
    htmlBodies,
    attachments
  };
}

function normalizeGmailMessage(message: gmail_v1.Schema$Message): GmailEmail {
  const from = extractHeader(message, "From");
  const to = extractHeader(message, "To");
  const subject = extractHeader(message, "Subject");
  const date = extractHeader(message, "Date") || null;
  const sender = parseEmailAddress(from);

  const { textBodies, htmlBodies, attachments } =
    collectMessageBodiesAndAttachments(message.payload);

  const textBody = textBodies.join("\n\n").trim();
  const htmlBody = htmlBodies.join("\n\n").trim();

  const body = textBody || stripHtml(htmlBody) || message.snippet || "";

  return {
    id: message.id ?? "",
    threadId: message.threadId ?? null,
    from,
    senderName: sender.name,
    senderEmail: sender.email,
    to,
    subject,
    snippet: message.snippet ?? "",
    body,
    textBody,
    htmlBody,
    date,
    internalDate: message.internalDate ?? null,
    labelIds: message.labelIds ?? [],
    attachments,
    gmailUrl: getGmailMessageUrl(message.id)
  };
}

export async function listGmailEmails({
  userId,
  query,
  maxResults = 10
}: {
  userId: string;
  query?: string;
  maxResults?: number;
}) {
  const gmail = await createAuthorizedGmailClient(userId);

  const safeMaxResults = Math.min(Math.max(maxResults, 1), 25);

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: query?.trim() || "newer_than:7d",
    maxResults: safeMaxResults
  });

  const messages = listResponse.data.messages ?? [];

  if (!messages.length) {
    return [];
  }

  const fullMessages = await Promise.all(
    messages
      .filter((message) => Boolean(message.id))
      .map(async (message) => {
        const response = await gmail.users.messages.get({
          userId: "me",
          id: message.id as string,
          format: "full"
        });

        return normalizeGmailMessage(response.data);
      })
  );

  return fullMessages;
}

export async function readGmailEmail({
  userId,
  query
}: {
  userId: string;
  query: string;
}) {
  const emails = await listGmailEmails({
    userId,
    query,
    maxResults: 1
  });

  return emails[0] ?? null;
}

export async function getGmailEmailById({
  userId,
  messageId
}: {
  userId: string;
  messageId: string;
}) {
  const gmail = await createAuthorizedGmailClient(userId);

  const response = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full"
  });

  return normalizeGmailMessage(response.data);
}

function encodeRawEmail(message: string) {
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createRawEmail({
  to,
  subject,
  body,
  cc,
  bcc,
  inReplyTo,
  references
}: {
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const lines = [
    `To: ${to}`,
    cc ? `Cc: ${cc}` : null,
    bcc ? `Bcc: ${bcc}` : null,
    `Subject: ${subject}`,
    inReplyTo ? `In-Reply-To: ${inReplyTo}` : null,
    references ? `References: ${references}` : null,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    body
  ].filter((line): line is string => line !== null);

  return encodeRawEmail(lines.join("\r\n"));
}

export async function sendGmailEmail({
  userId,
  to,
  subject,
  body,
  cc,
  bcc
}: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): Promise<GmailSendResult> {
  const gmail = await createAuthorizedGmailClient(userId);

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: createRawEmail({
        to,
        subject,
        body,
        cc,
        bcc
      })
    }
  });

  return {
    id: response.data.id ?? null,
    threadId: response.data.threadId ?? null,
    to,
    subject,
    body,
    gmailUrl: getGmailMessageUrl(response.data.id)
  };
}

export async function createGmailDraft({
  userId,
  to,
  subject,
  body,
  cc,
  bcc
}: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
}): Promise<GmailDraftResult> {
  const gmail = await createAuthorizedGmailClient(userId);

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: createRawEmail({
          to,
          subject,
          body,
          cc,
          bcc
        })
      }
    }
  });

  return {
    id: response.data.id ?? null,
    messageId: response.data.message?.id ?? null,
    threadId: response.data.message?.threadId ?? null,
    to,
    subject,
    body,
    gmailUrl: getGmailDraftUrl(response.data.id)
  };
}