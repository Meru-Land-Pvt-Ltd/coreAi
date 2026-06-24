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

  if (
    !crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  ) {
    throw new Error("Invalid OAuth state signature");
  }

  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as {
    userId?: unknown;
    createdAt?: unknown;
  };

  if (typeof payload.userId !== "string") {
    throw new Error("Invalid OAuth state user");
  }

  const createdAt = typeof payload.createdAt === "number" ? payload.createdAt : 0;
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
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null
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
    email: credential?.externalAccountEmail ?? null
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
        expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : undefined,
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

  return Buffer.from(value, "base64url").toString("utf8");
}

function extractHeader(message: gmail_v1.Schema$Message, name: string) {
  return (
    message.payload?.headers?.find(
      (header) => header.name?.toLowerCase() === name.toLowerCase()
    )?.value ?? ""
  );
}

function extractMessageBodyFromParts(parts?: gmail_v1.Schema$MessagePart[]): string {
  if (!parts?.length) return "";

  for (const part of parts) {
    if (part.mimeType === "text/plain" && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }

    const nestedBody = extractMessageBodyFromParts(part.parts ?? undefined);

    if (nestedBody) {
      return nestedBody;
    }
  }

  return "";
}

function extractMessageBody(message: gmail_v1.Schema$Message) {
  if (message.payload?.body?.data) {
    return decodeBase64Url(message.payload.body.data);
  }

  return extractMessageBodyFromParts(message.payload?.parts ?? undefined);
}

export async function readGmailEmail({
  userId,
  query
}: {
  userId: string;
  query: string;
}) {
  const gmail = await createAuthorizedGmailClient(userId);

  const listResponse = await gmail.users.messages.list({
    userId: "me",
    q: query || "newer_than:7d",
    maxResults: 1
  });

  const messageId = listResponse.data.messages?.[0]?.id;

  if (!messageId) {
    return null;
  }

  const messageResponse = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full"
  });

  const message = messageResponse.data;

  return {
    id: message.id ?? messageId,
    from: extractHeader(message, "From"),
    senderEmail: extractHeader(message, "From").match(/<(.+?)>/)?.[1] ?? extractHeader(message, "From"),
    subject: extractHeader(message, "Subject"),
    body: extractMessageBody(message) || message.snippet || ""
  };
}

function createRawEmail({
  to,
  subject,
  body
}: {
  to: string;
  subject: string;
  body: string;
}) {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    body
  ].join("\n");

  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function sendGmailEmail({
  userId,
  to,
  subject,
  body
}: {
  userId: string;
  to: string;
  subject: string;
  body: string;
}) {
  const gmail = await createAuthorizedGmailClient(userId);

  const response = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: createRawEmail({
        to,
        subject,
        body
      })
    }
  });

  return {
    id: response.data.id ?? null,
    to,
    subject,
    body
  };
}

export async function createGmailDraft({
  userId,
  to,
  subject,
  body
}: {
  userId: string;
  to: string;
  subject: string;
  body: string;
}) {
  const gmail = await createAuthorizedGmailClient(userId);

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw: createRawEmail({
          to,
          subject,
          body
        })
      }
    }
  });

  return {
    id: response.data.id ?? null,
    to,
    subject,
    body
  };
}