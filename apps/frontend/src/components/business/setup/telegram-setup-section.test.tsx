import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  disconnectBusinessTelegram,
  getBusinessTelegramStatus,
  startBusinessTelegramOwnerAuthorization,
  updateBusinessTelegramSettings,
  generateBusinessTelegramCommands
} from "@/components/business/features/api";
import { TelegramConnectSection, TelegramConfigSection } from "./telegram-setup-section";

vi.mock("@/components/business/features/api", () => ({
  connectBusinessTelegramManualBot: vi.fn(),
  disconnectBusinessTelegram: vi.fn(),
  getBusinessTelegramStatus: vi.fn(),
  refreshBusinessTelegramHealth: vi.fn(),
  sendBusinessTelegramTestMessage: vi.fn(),
  startBusinessTelegramOwnerAuthorization: vi.fn(),
  updateBusinessTelegramSettings: vi.fn(),
  generateBusinessTelegramCommands: vi.fn()
}));

const settings = {
  telegramWelcomeMessage: "Welcome",
  telegramFallbackMessage: "Try again",
  telegramBookingMode: true,
  telegramServicesCommand: true,
  telegramBookCommand: true,
  telegramMyBookingsCommand: true,
  telegramRescheduleCommand: true,
  telegramCancelCommand: true,
  telegramHelpCommand: true,
  telegramCustomCommands: [],
  telegramRequestPhone: true,
  telegramRequestEmail: true,
  telegramRequestNotes: true
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("Business Telegram setup", () => {
  it("connects the owner through a private one-time link without asking for a chat ID", async () => {
    vi.mocked(getBusinessTelegramStatus).mockResolvedValue({
      success: true,
      data: {
        connection: {
          id: "telegram-connection",
          status: "ACTIVE",
          provisioningMode: "MANUAL",
          provisioningStatus: "READY",
          webhookStatus: "HEALTHY",
          ownerNotificationStatus: "NOT_CONNECTED",
          requestedUsername: "business_bot",
          botUsername: "business_bot",
          botDisplayName: "Business Bot",
          botUrl: "https://t.me/business_bot",
          lastWebhookAt: null,
          lastSuccessfulSendAt: null,
          lastProviderErrorCode: null,
          lastError: null,
          credentialRotatedAt: null,
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z"
        },
        manualProvisioningAvailable: true,
        settings,
        services: ["Consultation", "Follow-up"]
      }
    });
    vi.mocked(startBusinessTelegramOwnerAuthorization).mockResolvedValue({
      success: true,
      data: {
        authorizationUrl: "https://t.me/business_bot?start=owner_secure-token",
        status: "PENDING",
        expiresAt: "2026-08-05T00:15:00.000Z"
      }
    });
    const open = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <TelegramConnectSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        onConnectedChange={vi.fn()}
      />
    );

    const connect = await screen.findByTestId("business-setup-telegram-owner-connect");
    expect(screen.getByText(/Pair your personal Telegram account to receive instant private booking alerts/i)).toBeTruthy();
    fireEvent.click(connect);

    await waitFor(() => {
      expect(startBusinessTelegramOwnerAuthorization).toHaveBeenCalledWith("installed-agent");
      expect(open).toHaveBeenCalledWith(
        "https://t.me/business_bot?start=owner_secure-token",
        "_blank",
        "noopener,noreferrer"
      );
    });
    expect(await screen.findByText(/press Start within 15 minutes/i)).toBeTruthy();
  });

  it("opens custom disconnect modal when disconnect is clicked and calls disconnect endpoint on confirm", async () => {
    vi.mocked(getBusinessTelegramStatus).mockResolvedValue({
      success: true,
      data: {
        connection: {
          id: "telegram-connection",
          status: "ACTIVE",
          provisioningMode: "MANUAL",
          provisioningStatus: "READY",
          webhookStatus: "HEALTHY",
          ownerNotificationStatus: "CONNECTED",
          requestedUsername: "business_bot",
          botUsername: "business_bot",
          botDisplayName: "Business Bot",
          botUrl: "https://t.me/business_bot",
          lastWebhookAt: null,
          lastSuccessfulSendAt: null,
          lastProviderErrorCode: null,
          lastError: null,
          credentialRotatedAt: null,
          createdAt: "2026-08-05T00:00:00.000Z",
          updatedAt: "2026-08-05T00:00:00.000Z"
        },
        manualProvisioningAvailable: true,
        settings,
        services: ["Consultation"]
      }
    });
    vi.mocked(disconnectBusinessTelegram).mockResolvedValue({
      success: true,
      data: { disconnected: true }
    });

    render(
      <TelegramConnectSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        onConnectedChange={vi.fn()}
      />
    );

    const disconnectBtn = await screen.findByTestId("business-setup-telegram-disconnect-trigger");
    fireEvent.click(disconnectBtn);

    // Modal should open
    expect(await screen.findByTestId("business-setup-telegram-disconnect-modal")).toBeTruthy();
    expect(screen.getByText(/Disconnect Telegram Bot\?/i)).toBeTruthy();

    // Click confirm in modal
    const confirmBtn = screen.getByTestId("business-setup-telegram-disconnect-confirm");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(disconnectBusinessTelegram).toHaveBeenCalledWith("installed-agent");
    });
  });

  it("does not require a bot reply for the default /commands command", async () => {
    vi.mocked(getBusinessTelegramStatus).mockResolvedValue({
      success: true,
      data: {
        connection: null,
        manualProvisioningAvailable: true,
        settings,
        services: ["Consultation"]
      }
    });
    vi.mocked(updateBusinessTelegramSettings).mockResolvedValue({
      success: true,
      data: {
        settings: {
          ...settings,
          telegramCustomCommands: [
            {
              command: "commands",
              description: "Show list of all active bot commands",
              action: "reply",
              response: "Show a list of all active bot commands."
            }
          ]
        },
        services: ["Consultation"],
        botDisplayName: "Example Business Assistant"
      }
    });

    render(
      <TelegramConfigSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        services={["Consultation"]}
      />
    );

    await screen.findByTestId("business-setup-telegram-command-0");
    fireEvent.click(screen.getByTestId("business-setup-telegram-save-settings"));

    await waitFor(() => {
      expect(updateBusinessTelegramSettings).toHaveBeenCalledWith(
        "installed-agent",
        expect.objectContaining({
          services: ["Consultation"],
          telegramCustomCommands: expect.arrayContaining([
            expect.objectContaining({
              command: "commands",
              action: "reply"
            })
          ])
        })
      );
    });

    expect(screen.queryByTestId("business-setup-telegram-validation-error")).toBeNull();
  });

  it("lets the business define custom commands in configuration step", async () => {
    vi.mocked(getBusinessTelegramStatus).mockResolvedValue({
      success: true,
      data: {
        connection: null,
        manualProvisioningAvailable: true,
        settings,
        services: ["Strategy call", "Follow-up"]
      }
    });
    vi.mocked(updateBusinessTelegramSettings).mockResolvedValue({
      success: true,
      data: {
        settings: {
          ...settings,
          telegramCustomCommands: [{
            command: "pricing",
            description: "View pricing",
            action: "reply",
            response: "Standard rates start at $50"
          }]
        },
        services: ["Strategy call", "Follow-up"],
        botDisplayName: "Example Business Assistant"
      }
    });

    render(
      <TelegramConfigSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        services={["Strategy call", "Follow-up"]}
      />
    );

    fireEvent.click(await screen.findByTestId("business-setup-telegram-add-command"));
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-name-1"), {
      target: { value: "/Pricing" }
    });
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-description-1"), {
      target: { value: "View pricing" }
    });
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-action-1"), {
      target: { value: "reply" }
    });
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-response-1"), {
      target: { value: "Standard rates start at $50" }
    });
    fireEvent.click(screen.getByTestId("business-setup-telegram-save-settings"));

    await waitFor(() => {
      expect(updateBusinessTelegramSettings).toHaveBeenCalledWith(
        "installed-agent",
        expect.objectContaining({
          services: ["Strategy call", "Follow-up"],
          telegramCustomCommands: expect.arrayContaining([
            expect.objectContaining({
              command: "pricing",
              description: "View pricing",
              action: "reply",
              response: "Standard rates start at $50"
            })
          ])
        })
      );
    });
  });

  it("generates commands via AI when user clicks generate commands", async () => {
    vi.mocked(getBusinessTelegramStatus).mockResolvedValue({
      success: true,
      data: {
        connection: null,
        manualProvisioningAvailable: true,
        settings,
        services: ["Strategy call"]
      }
    });

    vi.mocked(generateBusinessTelegramCommands).mockResolvedValue({
      success: true,
      data: {
        welcomeMessage: "Hello, welcome to our business!",
        fallbackMessage: "I didn't understand. Type /help.",
        commands: [
          {
            command: "hours",
            description: "View business hours",
            action: "reply",
            response: "We are open 9am to 5pm."
          },
          {
            command: "book",
            description: "Book an appointment",
            action: "book",
            response: "Prompt user for name and time."
          }
        ]
      }
    });

    render(
      <TelegramConfigSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        services={["Strategy call"]}
      />
    );

    // AI Command Generator should be present
    expect(await screen.findByText("AI Bot Command Generator")).toBeTruthy();
    
    // Fill text area
    const textarea = screen.getByPlaceholderText(/paste website content/i);
    fireEvent.change(textarea, { target: { value: "We are open 9am to 5pm, book appointment with us" } });

    // Click Generate Commands button
    const generateBtn = screen.getByText("Generate Commands");
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(generateBusinessTelegramCommands).toHaveBeenCalledWith(
        "installed-agent",
        "We are open 9am to 5pm, book appointment with us",
        undefined
      );
    });

    // Success alert should be present
    expect(await screen.findByText(/Commands generated successfully/i)).toBeTruthy();

    // Verify it updated welcome message field
    const welcomeTextarea = screen.getByPlaceholderText(/Hi! Welcome!/i);
    expect((welcomeTextarea as HTMLTextAreaElement).value).toBe("Hello, welcome to our business!");
  });
});
