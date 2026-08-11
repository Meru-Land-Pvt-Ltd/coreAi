import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TestPanel } from "./test-panel";

afterEach(() => cleanup());

const defaultProps = {
  hasGmailFlow: false,
  hasEmailNode: false,
  isVoiceWorkflow: false,
  isDentalWorkflow: false,
  gmailConnected: false,
  gmailEmail: null,
  calendarConnected: false,
  connectingGmail: false,
  running: false,
  startingLive: false,
  stoppingLive: false,
  callerNumber: "+15550000000",
  callerName: "Test Caller",
  businessName: "Test Business",
  businessType: "Service Business",
  calendarId: "primary",
  timeZone: "America/Los_Angeles",
  appointmentService: "General Consultation",
  testDeployment: null,
  runLogs: [],
  runContext: {},
  conversationMessages: [],
  conversationLogs: [],
  conversationToolCalls: [],
  chatting: false,
  triggerMessage: "",
  triggerAttachments: [],
  isManualTriggerWorkflow: false,
  isMissedCallWorkflow: false,
  isSmsWorkflow: false,
  onConnectGmail: vi.fn(),
  onDisconnectGoogle: vi.fn(),
  onRefreshConnections: vi.fn(),
  onRunTest: vi.fn(),
  onStartLiveTest: vi.fn(),
  onStopLiveTest: vi.fn(),
  onStartVapiCall: vi.fn(),
  onSendConversationMessage: vi.fn(),
  onResetConversationTest: vi.fn(),
  onCallerNumberChange: vi.fn(),
  onCallerNameChange: vi.fn(),
  onBusinessNameChange: vi.fn(),
  onBusinessTypeChange: vi.fn(),
  onCalendarIdChange: vi.fn(),
  onTimeZoneChange: vi.fn(),
  onAppointmentServiceChange: vi.fn(),
  onTriggerMessageChange: vi.fn(),
  onTriggerAttachmentsChange: vi.fn()
};

describe("TestPanel dynamic trigger fields & standard business fields", () => {
  it("renders Business name, Business services, and Timezone for inbound call workflows while hiding extra business fields", () => {
    render(<TestPanel {...defaultProps} isVoiceWorkflow={true} isManualTriggerWorkflow={false} />);

    expect(screen.getByText("Trigger — inbound call")).toBeDefined();
    expect(screen.getByText("Caller phone")).toBeDefined();
    expect(screen.getByText("Caller name")).toBeDefined();
    expect(screen.getByText("Business name")).toBeDefined();
    expect(screen.getByText("Business services")).toBeDefined();
    expect(screen.getByText("Timezone")).toBeDefined();

    expect(screen.queryByText("Business type")).toBeNull();
    expect(screen.queryByText("Business-hours state")).toBeNull();
    expect(screen.queryByText("Requested date")).toBeNull();
  });

  it("renders Business name, Business services, and Timezone for missed call workflows", () => {
    render(<TestPanel {...defaultProps} isMissedCallWorkflow={true} isManualTriggerWorkflow={false} />);

    expect(screen.getByText("Trigger — missed call")).toBeDefined();
    expect(screen.getByText("Caller number")).toBeDefined();
    expect(screen.getByText("Caller name")).toBeDefined();
    expect(screen.getByText("Business name")).toBeDefined();
    expect(screen.getByText("Business services")).toBeDefined();
    expect(screen.getByText("Timezone")).toBeDefined();
  });

  it("renders text input only for manual trigger workflows, omitting attachments and business fields", () => {
    render(<TestPanel {...defaultProps} isManualTriggerWorkflow={true} />);

    expect(screen.getByText("Trigger")).toBeDefined();
    expect(screen.getByText("Trigger message / Text input")).toBeDefined();
    expect(screen.queryByText("Trigger attachments")).toBeNull();
    expect(screen.queryByText("Business name")).toBeNull();
    expect(screen.queryByText("Business services")).toBeNull();
    expect(screen.queryByText("Timezone")).toBeNull();
  });

  it("renders Sender phone, Sender name, Business name, Business services, Timezone, and text input for inbound SMS workflows", () => {
    render(<TestPanel {...defaultProps} isSmsWorkflow={true} isManualTriggerWorkflow={false} />);

    expect(screen.getByText("Trigger — inbound SMS")).toBeDefined();
    expect(screen.getByText("Sender phone")).toBeDefined();
    expect(screen.getByText("Sender name")).toBeDefined();
    expect(screen.getByText("SMS Message / Text input")).toBeDefined();
    expect(screen.getByText("Business name")).toBeDefined();
    expect(screen.getByText("Business services")).toBeDefined();
    expect(screen.getByText("Timezone")).toBeDefined();
  });

  it("puts Telegram commands and multiple test services in the live Test section", () => {
    render(
      <TestPanel
        {...defaultProps}
        isTelegramWorkflow={true}
        needsAnyTestConnection={true}
        appointmentService={"Consultation\nCleaning"}
        telegramCommandSettings={{
          telegramBookingMode: true,
          telegramServicesCommand: true,
          telegramBookCommand: true,
          telegramMyBookingsCommand: false,
          telegramRescheduleCommand: false,
          telegramCancelCommand: false,
          telegramHelpCommand: true
        }}
      />
    );

    expect(screen.getByTestId("builder-test-telegram-commands")).toBeDefined();
    expect(screen.getByText("/start")).toBeDefined();
    expect(screen.getByText("/services")).toBeDefined();
    expect((screen.getByTestId("builder-test-appointment-service-input") as HTMLTextAreaElement).value)
      .toBe("Consultation\nCleaning");
  });

  it("lets the Architect define a custom Telegram command and its behavior", () => {
    const onTelegramCustomCommandsChange = vi.fn();
    render(
      <TestPanel
        {...defaultProps}
        isTelegramWorkflow={true}
        needsAnyTestConnection={true}
        telegramCustomCommands={[{
          id: "command-contact",
          command: "contact",
          description: "Show contact information",
          action: "reply",
          response: "Contact {{business.name}}"
        }]}
        onTelegramCustomCommandsChange={onTelegramCustomCommandsChange}
      />
    );

    expect(screen.getByTestId("builder-test-telegram-custom-commands")).toBeDefined();
    expect((screen.getByTestId("builder-test-telegram-custom-command-name") as HTMLInputElement).value)
      .toBe("contact");
    expect((screen.getByTestId("builder-test-telegram-custom-command-response") as HTMLTextAreaElement).value)
      .toContain("{{business.name}}");

    fireEvent.change(screen.getByTestId("builder-test-telegram-custom-command-action"), {
      target: { value: "services" }
    });
    expect(onTelegramCustomCommandsChange).toHaveBeenCalledWith([
      expect.objectContaining({ command: "contact", action: "services" })
    ]);
  });
});
