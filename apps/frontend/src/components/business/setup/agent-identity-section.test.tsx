import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AgentIdentitySection } from "./agent-identity-section";

vi.mock("@/components/business/features/api", () => ({
  getVoiceSamplePreview: vi.fn().mockResolvedValue({
    success: true,
    data: { audioBase64: "AAAA", mimeType: "audio/mpeg" }
  })
}));

describe("AgentIdentitySection component", () => {
  const defaultProps = {
    showVoice: true,
    assistantName: "Maya",
    businessName: "Meru Salon",
    voiceChoice: "triven-default",
    customVoiceId: "",
    tone: "friendly",
    onAssistantName: vi.fn(),
    onVoiceChoice: vi.fn(),
    onCustomVoiceId: vi.fn(),
    onTone: vi.fn()
  };

  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders voice select dropdown and preview button side-by-side", () => {
    render(<AgentIdentitySection {...defaultProps} />);

    const selectBtn = screen.getByTestId("business-setup-voice-select");
    expect(selectBtn).toBeTruthy();
    expect(selectBtn.textContent).toContain("Triven Default Voice");
    expect(selectBtn.textContent).toContain("Platform default");
    expect(screen.getByTestId("business-setup-voice-play")).toBeTruthy();
  });

  it("opens popover on click and calls onVoiceChoice when user selects a voice option", async () => {
    const user = userEvent.setup();
    const onVoiceChoice = vi.fn();
    render(<AgentIdentitySection {...defaultProps} onVoiceChoice={onVoiceChoice} />);

    const selectBtn = screen.getByTestId("business-setup-voice-select");
    await user.click(selectBtn);

    const rubyOption = await screen.findByTestId("business-setup-voice-option-ruby");
    expect(rubyOption.textContent).toContain("Ruby");
    expect(rubyOption.textContent).toContain("Warm receptionist");

    await user.click(rubyOption);
    expect(onVoiceChoice).toHaveBeenCalledWith("ruby");
  });

  it("shows custom voice input field when voiceChoice is 'custom'", () => {
    render(<AgentIdentitySection {...defaultProps} voiceChoice="custom" customVoiceId="eleven-123" />);

    expect(screen.getByTestId("business-setup-voice-custom-id")).toBeTruthy();
    expect((screen.getByTestId("business-setup-voice-custom-id") as HTMLInputElement).value).toBe("eleven-123");
  });

  it("triggers voice preview play on button click", async () => {
    const user = userEvent.setup();
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());

    render(<AgentIdentitySection {...defaultProps} />);

    const playBtn = screen.getByTestId("business-setup-voice-play");
    await user.click(playBtn);

    await waitFor(() => {
      expect(playSpy).toHaveBeenCalled();
    });
  });
});
