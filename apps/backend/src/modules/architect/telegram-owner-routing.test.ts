import { describe, expect, it } from "vitest";
import {
  createTelegramOwnerAuthorizationToken,
  inspectTelegramOwnerAuthorizationCommand,
  shouldProcessOwnerAuthorizationDuringProvisioning,
  shouldRememberTelegramEventAsCustomer,
  TELEGRAM_OWNER_AUTHORIZATION_TTL_MS,
  telegramEventBelongsToBusinessOwner
} from "./telegram-owner-routing";

describe("Telegram owner routing", () => {
  it("accepts a matching one-time owner command before it expires", () => {
    const now = Date.UTC(2026, 7, 5, 10, 0, 0);
    const authorization = createTelegramOwnerAuthorizationToken(now);

    expect(
      inspectTelegramOwnerAuthorizationCommand({
        text: `/start owner_${authorization.token}`,
        expectedTokenHash: authorization.tokenHash,
        chatType: "private",
        now: now + 60_000
      })
    ).toEqual({ matches: true, expired: false });
  });

  it("marks a matching owner command as expired after fifteen minutes", () => {
    const now = Date.UTC(2026, 7, 5, 10, 0, 0);
    const authorization = createTelegramOwnerAuthorizationToken(now);

    expect(
      inspectTelegramOwnerAuthorizationCommand({
        text: `/start owner_${authorization.token}`,
        expectedTokenHash: authorization.tokenHash,
        chatType: "private",
        now: now + TELEGRAM_OWNER_AUTHORIZATION_TTL_MS + 1
      })
    ).toEqual({ matches: true, expired: true });
  });

  it("does not accept a token in a group or for another connection", () => {
    const authorization = createTelegramOwnerAuthorizationToken();

    expect(
      inspectTelegramOwnerAuthorizationCommand({
        text: `/start owner_${authorization.token}`,
        expectedTokenHash: authorization.tokenHash,
        chatType: "group"
      }).matches
    ).toBe(false);
    expect(
      inspectTelegramOwnerAuthorizationCommand({
        text: "/start owner_invalid",
        expectedTokenHash: authorization.tokenHash,
        chatType: "private"
      }).matches
    ).toBe(false);
  });

  it("allows only a matching owner authorization update while provisioning", () => {
    const authorization = createTelegramOwnerAuthorizationToken();
    const update = {
      update_id: 123,
      message: {
        message_id: 456,
        date: Math.floor(Date.now() / 1_000),
        from: { id: 789, is_bot: false, first_name: "Owner" },
        chat: { id: 789, type: "private" },
        text: `/start owner_${authorization.token}`
      }
    };

    const base = {
      update,
      expectedTokenHash: authorization.tokenHash,
      connectionStatus: "ACTIVE",
      agentStatus: "PROVISIONING",
      pausedAt: null
    };

    expect(shouldProcessOwnerAuthorizationDuringProvisioning(base)).toBe(true);
    expect(
      shouldProcessOwnerAuthorizationDuringProvisioning({
        ...base,
        update: {
          ...update,
          message: { ...update.message, text: "/start" }
        }
      })
    ).toBe(false);
    expect(
      shouldProcessOwnerAuthorizationDuringProvisioning({ ...base, agentStatus: "PAUSED" })
    ).toBe(false);
  });

  it("classifies only the verified private owner identity as the business owner", () => {
    const connection = {
      ownerChatId: "owner-chat",
      telegramOwnerUserId: "owner-user",
      ownerNotificationStatus: "CONNECTED"
    };

    expect(
      telegramEventBelongsToBusinessOwner(connection, {
        chat: { id: "owner-chat", type: "private" },
        sender: { id: "owner-user" }
      })
    ).toBe(true);
    expect(
      telegramEventBelongsToBusinessOwner(connection, {
        chat: { id: "customer-chat", type: "private" },
        sender: { id: "customer-user" }
      })
    ).toBe(false);
  });

  it("never stores owner or owner-authorization chats as customer conversations", () => {
    const connection = {
      ownerChatId: "owner-chat",
      telegramOwnerUserId: "owner-user",
      ownerNotificationStatus: "ERROR"
    };
    const ownerEvent = {
      chat: { id: "owner-chat", type: "private" },
      sender: { id: "owner-user", isBot: false }
    };
    const customerEvent = {
      chat: { id: "customer-chat", type: "private" },
      sender: { id: "customer-user", isBot: false }
    };

    expect(telegramEventBelongsToBusinessOwner(connection, ownerEvent)).toBe(true);
    expect(shouldRememberTelegramEventAsCustomer(connection, ownerEvent, false)).toBe(false);
    expect(shouldRememberTelegramEventAsCustomer(connection, customerEvent, true)).toBe(false);
    expect(shouldRememberTelegramEventAsCustomer(connection, customerEvent, false)).toBe(true);
  });
});
