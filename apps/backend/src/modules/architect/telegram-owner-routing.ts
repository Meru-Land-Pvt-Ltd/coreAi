import crypto from "crypto";

export const TELEGRAM_OWNER_AUTHORIZATION_TTL_MS = 15 * 60_000;

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Creates a one-time token whose age can be checked without storing raw credentials. */
export function createTelegramOwnerAuthorizationToken(now = Date.now()) {
  const token = `${now.toString(36)}_${crypto.randomBytes(18).toString("base64url")}`;
  return {
    token,
    tokenHash: sha256(token),
    expiresAt: new Date(now + TELEGRAM_OWNER_AUTHORIZATION_TTL_MS)
  };
}

export function inspectTelegramOwnerAuthorizationCommand(options: {
  text: string;
  expectedTokenHash: string | null;
  chatType: string;
  now?: number;
}): { matches: boolean; expired: boolean } {
  const match = options.text.trim().match(/^\/start\s+owner_([A-Za-z0-9_-]+)$/);
  if (!match || !options.expectedTokenHash || options.chatType !== "private") {
    return { matches: false, expired: false };
  }

  const token = match[1] ?? "";
  if (!secureEqual(sha256(token), options.expectedTokenHash)) {
    return { matches: false, expired: false };
  }

  const issuedAtPart = token.split("_", 1)[0] ?? "";
  const issuedAt = Number.parseInt(issuedAtPart, 36);
  const now = options.now ?? Date.now();
  const expired =
    !Number.isFinite(issuedAt) ||
    issuedAt > now + 60_000 ||
    now - issuedAt > TELEGRAM_OWNER_AUTHORIZATION_TTL_MS;

  return { matches: true, expired };
}

/** Owner chats are verified and stored separately from customer conversations. */
export function telegramEventBelongsToBusinessOwner(
  connection: {
    ownerChatId: string | null;
    telegramOwnerUserId: string | null;
    ownerNotificationStatus: string;
  },
  event: {
    chat: { id: string; type: string };
    sender: { id: string };
  }
): boolean {
  if (
    event.chat.type !== "private" ||
    !connection.ownerChatId ||
    connection.ownerChatId !== event.chat.id
  ) {
    return false;
  }

  return !connection.telegramOwnerUserId || connection.telegramOwnerUserId === event.sender.id;
}

export function shouldRememberTelegramEventAsCustomer(
  connection: Parameters<typeof telegramEventBelongsToBusinessOwner>[0],
  event: Parameters<typeof telegramEventBelongsToBusinessOwner>[1] & { sender: { id: string; isBot: boolean } },
  ownerAuthorizationMatches: boolean
): boolean {
  return (
    !event.sender.isBot &&
    !ownerAuthorizationMatches &&
    !telegramEventBelongsToBusinessOwner(connection, event)
  );
}
