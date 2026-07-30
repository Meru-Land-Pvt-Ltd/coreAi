import { describe, expect, it } from "vitest";
import type { ParsedInboundWhatsAppMessage } from "./types";
import { parseInboundMessages, workflowHasMatchingWhatsAppTrigger } from "./webhook";

const textPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: {
              display_phone_number: "15551234567",
              phone_number_id: "PHONE_ID_1"
            },
            contacts: [{ wa_id: "16505551234", profile: { name: "Ada Lovelace" } }],
            messages: [
              {
                from: "16505551234",
                id: "wamid.TEXT1",
                timestamp: "1700000000",
                type: "text",
                text: { body: "Hello from WhatsApp" }
              }
            ]
          }
        }
      ]
    }
  ]
};

const imagePayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: "PHONE_ID_1" },
            contacts: [{ wa_id: "16505551234", profile: { name: "Ada" } }],
            messages: [
              {
                from: "16505551234",
                id: "wamid.IMG1",
                timestamp: "1700000001",
                type: "image",
                image: { id: "MEDIA_1", mime_type: "image/jpeg", caption: "X-ray" }
              }
            ]
          }
        }
      ]
    }
  ]
};

describe("parseInboundMessages", () => {
  it("parses text messages with contact name", () => {
    const parsed = parseInboundMessages(textPayload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      connectionPhoneNumberId: "PHONE_ID_1",
      contactPhone: "16505551234",
      contactName: "Ada Lovelace",
      wamid: "wamid.TEXT1",
      type: "text",
      text: "Hello from WhatsApp",
      mediaId: null,
      isGroup: false
    });
  });

  it("parses image messages with media id and caption", () => {
    const parsed = parseInboundMessages(imagePayload);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({
      type: "image",
      text: "X-ray",
      mediaId: "MEDIA_1",
      wamid: "wamid.IMG1"
    });
  });

  it("skips status-only updates", () => {
    const parsed = parseInboundMessages({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: "PHONE_ID_1" },
                statuses: [{ id: "wamid.X", status: "delivered" }],
                messages: []
              }
            }
          ]
        }
      ]
    });
    expect(parsed).toHaveLength(0);
  });
});

describe("workflowHasMatchingWhatsAppTrigger", () => {
  const inbound: ParsedInboundWhatsAppMessage = {
    connectionPhoneNumberId: "PHONE_ID_1",
    contactPhone: "16505551234",
    contactName: "Ada",
    wamid: "wamid.TEXT1",
    type: "text",
    text: "hi",
    mediaId: null,
    mediaUrl: null,
    timestamp: new Date(),
    isGroup: false,
    isStatus: false
  };

  it("matches when connectionId empty or equal and listenFor allows", () => {
    const workflow = {
      nodes: [
        {
          data: {
            type: "trigger.whatsapp_message_received",
            connectionId: "",
            listenFor: "text",
            ignoreGroups: "true",
            ignoreStatusMessages: "true"
          }
        }
      ]
    };
    expect(workflowHasMatchingWhatsAppTrigger(workflow, "conn-1", inbound)).toBe(true);
  });

  it("rejects mismatched connectionId", () => {
    const workflow = {
      nodes: [
        {
          data: {
            type: "trigger.whatsapp_message_received",
            connectionId: "other",
            listenFor: "all"
          }
        }
      ]
    };
    expect(workflowHasMatchingWhatsAppTrigger(workflow, "conn-1", inbound)).toBe(false);
  });

  it("respects listenFor and ignoreGroups", () => {
    const imageInbound = { ...inbound, type: "image" };
    const textOnly = {
      nodes: [{ data: { type: "trigger.whatsapp_message_received", listenFor: "text" } }]
    };
    expect(workflowHasMatchingWhatsAppTrigger(textOnly, "conn-1", imageInbound)).toBe(false);

    const groupInbound = { ...inbound, isGroup: true };
    const ignoreGroups = {
      nodes: [{ data: { type: "trigger.whatsapp_message_received", ignoreGroups: "true" } }]
    };
    expect(workflowHasMatchingWhatsAppTrigger(ignoreGroups, "conn-1", groupInbound)).toBe(false);
  });
});
