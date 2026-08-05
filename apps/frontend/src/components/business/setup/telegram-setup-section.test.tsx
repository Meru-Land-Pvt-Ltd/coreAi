import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getBusinessTelegramStatus,
  startBusinessTelegramOwnerAuthorization,
  updateBusinessTelegramSettings
} from "@/components/business/features/api";
import { TelegramSetupSection } from "./telegram-setup-section";

vi.mock("@/components/business/features/api", () => ({
  connectBusinessTelegramManualBot: vi.fn(),
  disconnectBusinessTelegram: vi.fn(),
  getBusinessTelegramStatus: vi.fn(),
  refreshBusinessTelegramHealth: vi.fn(),
  sendBusinessTelegramTestMessage: vi.fn(),
  startBusinessTelegramOwnerAuthorization: vi.fn(),
  updateBusinessTelegramSettings: vi.fn()
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

describe("Business Telegram owner setup", () => {
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
      <TelegramSetupSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        onConnectedChange={vi.fn()}
      />
    );

    const connect = await screen.findByTestId("business-setup-telegram-owner-connect");
    expect(screen.getByText(/No phone number or manual chat ID is required/i)).toBeTruthy();
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

  it("lets the business edit services and define what a custom command does", async () => {
    vi.mocked(getBusinessTelegramStatus).mockResolvedValue({
      success: true,
      data: {
        connection: null,
        manualProvisioningAvailable: true,
        settings,
        services: ["Consultation", "Follow-up"]
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
            action: "services",
            response: ""
          }]
        },
        services: ["Strategy call", "Follow-up"],
        botDisplayName: "Example Business Assistant"
      }
    });

    render(
      <TelegramSetupSection
        installedAgentId="installed-agent"
        businessName="Example Business"
        onConnectedChange={vi.fn()}
      />
    );

    const firstService = await screen.findByTestId("business-setup-telegram-service-0");
    fireEvent.change(firstService, { target: { value: "Strategy call" } });
    fireEvent.click(screen.getByTestId("business-setup-telegram-add-command"));
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-name-0"), {
      target: { value: "/Pricing" }
    });
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-description-0"), {
      target: { value: "View pricing" }
    });
    fireEvent.change(screen.getByTestId("business-setup-telegram-command-action-0"), {
      target: { value: "services" }
    });
    fireEvent.click(screen.getByTestId("business-setup-telegram-save-settings"));

    await waitFor(() => {
      expect(updateBusinessTelegramSettings).toHaveBeenCalledWith(
        "installed-agent",
        expect.objectContaining({
          services: ["Strategy call", "Follow-up"],
          telegramCustomCommands: [{
            command: "pricing",
            description: "View pricing",
            action: "services",
            response: ""
          }]
        })
      );
    });
  });
});
