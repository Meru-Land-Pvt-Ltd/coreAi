import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  BLOCK_NODE_TYPES,
  CALENDLY_NODE_TYPES,
  DEEPGRAM_NODE_TYPES,
  DESIGN_BRAIN_NODE_TYPE,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_TYPES
} from "@coreai/shared";
import { ComponentLibrary } from "./component-library";
import { libraryGroups } from "./library";

/**
 * Face/Brain/Hands regroup + "Start with a Face" templates.
 *
 * The palette is exactly three groups with plain-English subtitles, every
 * pre-regroup item survives with its testId, the four live face templates
 * import via the same slug mechanism as the Dental card, and the two
 * engine-less faces (Video Studio, Monitor) are honest disabled cards.
 */

afterEach(cleanup);

/** Registry testId for a node type (mirrors node-registry's slug()). */
function tid(type: string): string {
  return `node-${type.replace(/[._]/g, "-")}`;
}

function renderLibrary(overrides: Partial<Parameters<typeof ComponentLibrary>[0]> = {}) {
  const onUseTemplate = vi.fn();
  const onAddNode = vi.fn();
  render(
    <ComponentLibrary
      searchTerm=""
      onSearchChange={() => undefined}
      onUseTemplate={onUseTemplate}
      onAddNode={onAddNode}
      {...overrides}
    />
  );
  return { onUseTemplate, onAddNode };
}

describe("library groups (Face / Brain / Hands)", () => {
  it("has exactly three groups with the founder's titles and subtitles", () => {
    expect(libraryGroups.map((group) => group.title)).toEqual(["Face", "Brain", "Hands"]);
    expect(libraryGroups.map((group) => group.subtitle)).toEqual([
      "What your customer sees",
      "How it thinks",
      "How it acts in the world"
    ]);
  });

  it("keeps every pre-regroup item (31 total) with its testId", () => {
    const testIds = libraryGroups.flatMap((group) => group.items.map((item) => item.testId));
    expect(testIds).toHaveLength(31);

    // Face: all block.* + design.brain
    const faceIds = libraryGroups[0].items.map((item) => item.testId);
    expect(faceIds).toEqual([
      tid(DESIGN_BRAIN_NODE_TYPE),
      tid(BLOCK_NODE_TYPES.promptComposer),
      tid(BLOCK_NODE_TYPES.presetGallery),
      tid(BLOCK_NODE_TYPES.modelPicker),
      tid(BLOCK_NODE_TYPES.actionButton),
      tid(BLOCK_NODE_TYPES.outputStage),
      tid(BLOCK_NODE_TYPES.continueChain),
      tid(BLOCK_NODE_TYPES.historyShelf)
    ]);

    // Brain: AI items + the business-hours rule check
    const brainIds = libraryGroups[1].items.map((item) => item.testId);
    expect(brainIds).toEqual([
      tid(VOICE_NODE_TYPES.voiceConversation),
      tid("ai.context_reply"),
      tid("ai.memory"),
      tid("ai.image_generation"),
      tid(DEEPGRAM_NODE_TYPES.stt),
      tid(DEEPGRAM_NODE_TYPES.tts),
      "library-ai-llm-call",
      tid("logic.condition")
    ]);

    // Hands: listen-items first, then act-items
    const handIds = libraryGroups[2].items.map((item) => item.testId);
    expect(handIds).toEqual([
      tid(VOICE_NODE_TYPES.phoneCallTrigger),
      tid(TELEGRAM_NODE_TYPES.trigger),
      tid("trigger.twilio_inbound_sms"),
      tid("trigger.twilio_missed_call"),
      tid("trigger.whatsapp_message_received"),
      tid(CALENDLY_NODE_TYPES.trigger),
      tid("trigger.manual"),
      tid(VOICE_NODE_TYPES.calendarAvailability),
      tid(VOICE_NODE_TYPES.bookAppointment),
      tid(CALENDLY_NODE_TYPES.action),
      tid(VOICE_NODE_TYPES.sendEmail),
      tid(VOICE_NODE_TYPES.sendSms),
      tid("action.send_whatsapp"),
      tid(TELEGRAM_NODE_TYPES.sendMessage),
      tid(VOICE_NODE_TYPES.endFlow)
    ]);
  });

  it("renders the three group titles with subtitles underneath", () => {
    renderLibrary();
    const titles = screen
      .getAllByTestId("architect-ui-workflow-builder-component-library-group-title-text")
      .map((el) => el.textContent);
    expect(titles).toEqual(["Face", "Brain", "Hands"]);

    const subtitles = screen
      .getAllByTestId("architect-ui-workflow-builder-component-library-group-subtitle-text")
      .map((el) => el.textContent);
    expect(subtitles).toEqual(["What your customer sees", "How it thinks", "How it acts in the world"]);
  });

  it("renders every palette item card", () => {
    renderLibrary();
    for (const group of libraryGroups) {
      for (const item of group.items) {
        expect(item.testId).toBeTruthy();
        expect(screen.getByTestId(item.testId as string)).toBeTruthy();
      }
    }
  });
});

describe("Start with a Face templates", () => {
  it("renders the section heading above the groups", () => {
    renderLibrary();
    expect(screen.getByTestId("face-template-section-title").textContent).toBe("Start with a Face");
    expect(screen.getByTestId("face-template-section-subtitle").textContent).toBe(
      "One tap builds a working product you can restyle"
    );
  });

  it.each([
    ["face-template-chatbot", "chatbot"],
    ["face-template-voice-agent", "voice-agent"],
    ["face-template-image-studio", "image-studio"],
    ["face-template-form-tool", "form-tool"]
  ])("%s imports the %s template on click", async (testId, slug) => {
    const { onUseTemplate } = renderLibrary();
    await userEvent.click(screen.getByTestId(testId));
    expect(onUseTemplate).toHaveBeenCalledTimes(1);
    expect(onUseTemplate).toHaveBeenCalledWith(slug);
  });

  it("keeps the two existing template cards working with their testIds", async () => {
    const { onUseTemplate } = renderLibrary();
    await userEvent.click(screen.getByTestId("library-template-ai-receptionist"));
    expect(onUseTemplate).toHaveBeenLastCalledWith("dental-ai-receptionist");
    await userEvent.click(screen.getByTestId("library-template-missed-call"));
    expect(onUseTemplate).toHaveBeenLastCalledWith("missed-call-text-back");
  });

  it.each([["face-template-video-studio"], ["face-template-monitor"]])(
    "%s is a disabled coming-soon card with no click action",
    async (testId) => {
      const { onUseTemplate } = renderLibrary();
      const card = screen.getByTestId(testId);
      expect(card.tagName).not.toBe("BUTTON");
      expect(card.getAttribute("aria-disabled")).toBe("true");
      expect(card.textContent).toContain("Coming soon");
      await userEvent.click(card);
      expect(onUseTemplate).not.toHaveBeenCalled();
    }
  );
});
