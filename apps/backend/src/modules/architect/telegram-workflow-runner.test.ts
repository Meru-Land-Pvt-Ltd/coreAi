import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../lib/prisma";
import { runWorkflowTest } from "./workflow-runner";

const RUN = `telegram-workflow-${process.pid}-${Date.now().toString(36)}`;
let dbAvailable = false;
let testUserId = "";
let testWorkflowId = "";

async function databaseIsAvailable() {
  return dbAvailable;
}

beforeAll(async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbAvailable = true;
  } catch {
    return;
  }
  const user = await prisma.user.create({
    data: { email: `${RUN}@test.local`, role: "ARCHITECT" }
  });
  const workflow = await prisma.workflowDefinition.create({
    data: {
      architectUserId: user.id,
      name: RUN,
      workflowJson: { nodes: [], edges: [] }
    }
  });
  testUserId = user.id;
  testWorkflowId = workflow.id;
});

afterAll(async () => {
  if (dbAvailable) {
    await prisma.user.deleteMany({ where: { email: `${RUN}@test.local` } });
  }
  await prisma.$disconnect();
});

describe("Telegram workflow trigger", () => {
  it("publishes Telegram variables and never falls through to Twilio wording", async () => {
    if (!(await databaseIsAvailable())) return;

    const result = await runWorkflowTest({
      userId: testUserId,
      workflowId: testWorkflowId,
      workflowJson: {
        nodes: [
          {
            id: "telegram-trigger",
            data: {
              type: "trigger.telegram_message",
              nodeKind: "trigger",
              title: "Telegram Bot Trigger"
            }
          },
          {
            id: "end",
            data: {
              type: "flow.end",
              nodeKind: "output",
              title: "End Flow"
            }
          }
        ],
        edges: [{ id: "telegram-to-end", source: "telegram-trigger", target: "end" }]
      },
      input: {
        businessName: "Test Business",
        latestMessage: "/services",
        telegramChatId: "10001",
        telegramUserId: "20002",
        telegramUsername: "test_customer",
        telegramMessageId: "3",
        telegramUpdateId: "4",
        telegramChatType: "private",
        telegramPhoneNumber: "+15555550100"
      }
    });

    expect(result.context.telegram).toMatchObject({
      chat_id: "10001",
      user_id: "20002",
      username: "test_customer",
      message_id: "3",
      text: "/services"
    });
    expect(result.context.trigger).toMatchObject({
      telegram: {
        provider: "TELEGRAM",
        chat: { id: "10001", type: "private" },
        sender: { id: "20002", username: "test_customer" },
        message: { id: "3", text: "/services" }
      }
    });
    expect(result.logs[0]?.message).toBe("Telegram bot event received.");
    expect(result.logs.some((log) => /Twilio missed-call/i.test(log.message))).toBe(false);
    expect(result.logs.at(-1)?.message).toBe("Telegram workflow run completed.");
  });

  it("dry-runs Telegram actions without calling the Telegram API", async () => {
    if (!(await databaseIsAvailable())) return;
    const result = await runWorkflowTest({
      userId: testUserId,
      workflowId: testWorkflowId,
      workflowJson: {
        nodes: [
          {
            id: "trigger",
            data: {
              type: "trigger.telegram_message",
              nodeKind: "trigger",
              title: "Telegram Bot Trigger"
            }
          },
          {
            id: "send",
            data: {
              type: "action.telegram_send_message",
              nodeKind: "connector",
              connector: "Telegram Bot",
              connectorAction: "send_message",
              title: "Telegram Send Message",
              telegramMessageText: "Hello {{trigger.telegram.sender.firstName}}"
            }
          }
        ],
        edges: [{ id: "edge", source: "trigger", target: "send" }]
      },
      input: {
        businessName: "Test Business",
        latestMessage: "Hello",
        telegramChatId: "10001",
        telegramUserId: "20002",
        telegramMessageId: "3"
      }
    });

    expect(result.context.telegramAction).toMatchObject({
      success: true,
      chatId: "10001",
      actionType: "telegram.send_message",
      dryRun: true
    });
    expect(result.logs.at(-1)?.message).toContain("no Telegram API request");
  });

  it.each([
    ["action.telegram_send_message", "telegram.send_message", { telegramMessageText: "Hello" }],
    [
      "action.telegram_send_buttons",
      "telegram.send_buttons",
      {
        telegramMessageText: "Choose",
        telegramButtonsJson: '[[{"text":"Book","callbackData":"nav:book"}]]'
      }
    ],
    ["action.telegram_answer_callback", "telegram.answer_callback", { telegramCallbackText: "Done" }],
    ["action.telegram_request_contact", "telegram.request_contact", {}],
    ["action.telegram_send_photo", "telegram.send_photo", { telegramPhotoSource: "A".repeat(24) }],
    ["action.telegram_send_document", "telegram.send_document", { telegramDocumentSource: "A".repeat(24) }],
    ["action.telegram_send_voice", "telegram.send_voice", { telegramVoiceSource: "A".repeat(24) }],
    ["action.telegram_send_location", "telegram.send_location", { telegramLatitude: "1", telegramLongitude: "2" }],
    ["action.telegram_edit_message", "telegram.edit_message", { telegramMessageText: "Updated" }],
    ["action.telegram_delete_message", "telegram.delete_message", {}]
  ])("dry-runs %s with representative output", async (nodeType, actionType, data) => {
    if (!(await databaseIsAvailable())) return;
    const result = await runWorkflowTest({
      userId: testUserId,
      workflowId: testWorkflowId,
      workflowJson: {
        nodes: [
          {
            id: "trigger",
            data: {
              type: "trigger.telegram_message",
              nodeKind: "trigger",
              title: "Telegram Bot Trigger"
            }
          },
          {
            id: "action",
            data: {
              type: nodeType,
              nodeKind: "connector",
              title: nodeType,
              telegramMessageIdExpression: "{{trigger.telegram.message.id}}",
              telegramCallbackIdExpression: "{{trigger.telegram.callback.id}}",
              ...data
            }
          }
        ],
        edges: [{ id: "edge", source: "trigger", target: "action" }]
      },
      input: {
        latestMessage: "Hello",
        telegramChatId: "10001",
        telegramUserId: "20002",
        telegramMessageId: "3",
        telegramCallbackId: "callback-1"
      }
    });

    expect(result.context.telegramAction).toMatchObject({
      success: true,
      actionType,
      dryRun: true
    });
  });

  it.each([
    ["business_owner", "architect-dry-run-owner-chat"],
    ["stored_customer", "architect-dry-run-customer-chat"],
    ["manual", "778899"]
  ])("does not require live %s recipient data during dry run", async (source, expectedChatId) => {
    if (!(await databaseIsAvailable())) return;
    const result = await runWorkflowTest({
      userId: testUserId,
      workflowId: testWorkflowId,
      workflowJson: {
        nodes: [
          {
            id: "trigger",
            data: { type: "trigger.telegram_message", nodeKind: "trigger" }
          },
          {
            id: "send",
            data: {
              type: "action.telegram_send_message",
              nodeKind: "connector",
              telegramRecipientSource: source,
              telegramChatIdExpression: source === "manual" ? "778899" : "",
              telegramMessageText: "Test"
            }
          }
        ],
        edges: [{ id: "edge", source: "trigger", target: "send" }]
      },
      input: {
        telegramChatId: "10001",
        telegramUserId: "20002",
        telegramMessageId: "3"
      }
    });

    expect(result.context.telegramAction?.chatId).toBe(expectedChatId);
  });
});
