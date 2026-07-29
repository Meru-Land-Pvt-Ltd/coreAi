import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteTelegramMessage,
  sendTelegramLocation,
  sendTelegramMessage,
  telegramApiRequest,
  TelegramApiError,
  telegramChatId,
  telegramMessageId,
  validateCallbackData,
  validatePublicTelegramMediaSource
} from "./telegram-api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

describe("Telegram API client validation", () => {
  it("accepts valid numeric chat and message IDs", () => {
    expect(telegramChatId("-1001234567890")).toBe(-1001234567890);
    expect(telegramMessageId("42")).toBe(42);
  });

  it.each(["", "customer", "12.5"])("rejects malformed chat ID %j", (chatId) => {
    expect(() => telegramChatId(chatId)).toThrow(TelegramApiError);
  });

  it.each(["", "0", "-1", "message"])("rejects malformed message ID %j", (messageId) => {
    expect(() => telegramMessageId(messageId)).toThrow(TelegramApiError);
  });

  it("validates callback data by UTF-8 byte length", () => {
    expect(validateCallbackData("booking:confirm")).toBe("booking:confirm");
    expect(() => validateCallbackData("")).toThrow(/1 to 64/);
    expect(() => validateCallbackData("x".repeat(65))).toThrow(/1 to 64/);
    expect(() => validateCallbackData("😀".repeat(17))).toThrow(/1 to 64/);
  });

  it("only accepts Telegram file IDs or public HTTPS media", () => {
    expect(validatePublicTelegramMediaSource("A".repeat(24))).toBe("A".repeat(24));
    expect(validatePublicTelegramMediaSource("https://example.com/photo.jpg")).toContain("https://");
    expect(() => validatePublicTelegramMediaSource("http://example.com/photo.jpg")).toThrow(/HTTPS/);
  });

  it("rejects invalid coordinates and live periods before fetch", async () => {
    await expect(
      sendTelegramLocation({ botToken: "token", chatId: "1", latitude: 91, longitude: 0 })
    ).rejects.toThrow(/Latitude/);
    await expect(
      sendTelegramLocation({
        botToken: "token",
        chatId: "1",
        latitude: 1,
        longitude: 1,
        livePeriod: 30
      })
    ).rejects.toThrow(/Live location period/);
  });
});

describe("Telegram API client responses", () => {
  it("returns a sent message and truncates text to Telegram limits", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        ok: true,
        result: { message_id: 9, chat: { id: 123, type: "private" }, date: 1 }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const sent = await sendTelegramMessage({
      botToken: "123456789:test-token-value-abcdefghijkl",
      chatId: "123",
      text: "x".repeat(5_000)
    });

    expect(sent.message_id).toBe(9);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { text: string; chat_id: number };
    expect(body.chat_id).toBe(123);
    expect(body.text).toHaveLength(4096);
  });

  it("classifies a blocked recipient as non-retryable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }, 403))
    );

    const error = await telegramApiRequest("token", "sendMessage").catch((value) => value);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).retryable).toBe(false);
  });

  it("honors Telegram retry_after on rate limits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response(
          {
            ok: false,
            error_code: 429,
            description: "Too Many Requests",
            parameters: { retry_after: 7 }
          },
          429
        )
      )
    );

    const error = await telegramApiRequest("token", "sendMessage").catch((value) => value);
    expect(error).toBeInstanceOf(TelegramApiError);
    expect((error as TelegramApiError).retryable).toBe(true);
    expect((error as TelegramApiError).retryAfterSeconds).toBe(7);
  });

  it("redacts bot-token-shaped values from provider errors", async () => {
    const leaked = "123456789:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ ok: false, description: `Unauthorized ${leaked}` }, 401))
    );

    const error = await telegramApiRequest("token", "getMe").catch((value) => value);
    expect((error as Error).message).not.toContain(leaked);
    expect((error as Error).message).toContain("[REDACTED_TOKEN]");
  });

  it("validates delete-message IDs before the provider request", async () => {
    await expect(
      deleteTelegramMessage({ botToken: "token", chatId: "1", messageId: "invalid" })
    ).rejects.toThrow(/message ID/);
  });
});
