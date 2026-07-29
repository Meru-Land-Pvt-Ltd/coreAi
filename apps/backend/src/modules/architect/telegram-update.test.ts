import { describe, expect, it } from "vitest";
import {
  normalizeTelegramUpdate,
  telegramTriggerMatches,
  telegramUpdateSchema
} from "./telegram-update";

const baseMessage = {
  message_id: 10,
  date: 1_785_283_200,
  from: {
    id: 200,
    is_bot: false,
    first_name: "Jordan",
    last_name: "Lee",
    username: "jordan",
    language_code: "en"
  },
  chat: { id: 300, type: "private" }
};

function normalize(update: unknown) {
  const parsed = telegramUpdateSchema.parse(update);
  return normalizeTelegramUpdate({
    update: parsed,
    businessId: "business-a",
    installedAgentId: "agent-a",
    telegramConnectionId: "connection-a",
    botId: "100",
    botUsername: "business_a_bot"
  });
}

describe("Telegram update normalization", () => {
  it.each([
    ["message", { message: { ...baseMessage, text: "hello" } }, "message"],
    ["command", { message: { ...baseMessage, text: "/book" } }, "command"],
    [
      "callback",
      {
        callback_query: {
          id: "callback-1",
          from: baseMessage.from,
          data: "service:cleaning",
          message: { ...baseMessage, text: "Choose" }
        }
      },
      "callback_query"
    ],
    [
      "contact",
      {
        message: {
          ...baseMessage,
          contact: { phone_number: "+15555550100", first_name: "Jordan", user_id: 200 }
        }
      },
      "contact"
    ],
    [
      "photo",
      {
        message: {
          ...baseMessage,
          photo: [
            { file_id: "small-photo-file-id-123", width: 100, height: 100 },
            { file_id: "large-photo-file-id-456", width: 800, height: 800 }
          ]
        }
      },
      "photo"
    ],
    [
      "document",
      {
        message: {
          ...baseMessage,
          document: {
            file_id: "document-file-id-123456",
            file_name: "intake.pdf",
            mime_type: "application/pdf"
          }
        }
      },
      "document"
    ],
    [
      "voice",
      {
        message: {
          ...baseMessage,
          voice: { file_id: "voice-file-id-123456789", duration: 5, mime_type: "audio/ogg" }
        }
      },
      "voice"
    ],
    [
      "location",
      {
        message: {
          ...baseMessage,
          location: { latitude: 40.7128, longitude: -74.006 }
        }
      },
      "location"
    ]
  ])("normalizes a %s update", (_label, partial, expectedType) => {
    const event = normalize({ update_id: 1, ...partial });
    expect(event?.eventType).toBe(expectedType);
    expect(event?.businessId).toBe("business-a");
    expect(event?.installedAgentId).toBe("agent-a");
    expect(event?.telegramConnectionId).toBe("connection-a");
    expect(event?.chat).toEqual({ id: "300", type: "private" });
  });

  it("uses the largest photo and exposes callback/contact/location fields", () => {
    const photo = normalize({
      update_id: 2,
      message: {
        ...baseMessage,
        photo: [
          { file_id: "small-photo-file-id-123" },
          { file_id: "large-photo-file-id-456" }
        ]
      }
    });
    expect(photo?.media.fileId).toBe("large-photo-file-id-456");

    const callback = normalize({
      update_id: 3,
      callback_query: {
        id: "callback-3",
        from: baseMessage.from,
        data: "booking:confirm",
        message: baseMessage
      }
    });
    expect(callback?.callback).toEqual({ id: "callback-3", data: "booking:confirm" });
  });

  it("matches command and keyword trigger configurations deterministically", () => {
    const command = normalize({ update_id: 4, message: { ...baseMessage, text: "/book@business_a_bot" } });
    expect(command && telegramTriggerMatches(command, { eventType: "command", command: "book" })).toBe(true);

    const keyword = normalize({
      update_id: 5,
      message: { ...baseMessage, text: "I want to schedule a cleaning" }
    });
    expect(
      keyword &&
        telegramTriggerMatches(keyword, {
          eventType: "keyword",
          keywords: ["schedule", "appointment"],
          matchType: "contains"
        })
    ).toBe(true);
  });

  it("rejects group and bot messages under private defaults", () => {
    const group = normalize({
      update_id: 6,
      message: { ...baseMessage, chat: { id: -300, type: "group" }, text: "hello" }
    });
    expect(group && telegramTriggerMatches(group, { eventType: "message" })).toBe(false);

    const bot = normalize({
      update_id: 7,
      message: {
        ...baseMessage,
        from: { ...baseMessage.from, is_bot: true },
        text: "hello"
      }
    });
    expect(bot && telegramTriggerMatches(bot, { eventType: "message" })).toBe(false);
  });
});
