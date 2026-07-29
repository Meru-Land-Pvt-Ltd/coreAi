import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

    expect(screen.getByText("Simulate an inbound call")).toBeDefined();
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

    expect(screen.getByText("Simulate a missed call")).toBeDefined();
    expect(screen.getByText("Caller number")).toBeDefined();
    expect(screen.getByText("Caller name")).toBeDefined();
    expect(screen.getByText("Business name")).toBeDefined();
    expect(screen.getByText("Business services")).toBeDefined();
    expect(screen.getByText("Timezone")).toBeDefined();
  });

  it("renders Business name, Business services, Timezone, text input, and attachments for manual trigger workflows", () => {
    render(<TestPanel {...defaultProps} isManualTriggerWorkflow={true} />);

    expect(screen.getByText("Simulate a customer event")).toBeDefined();
    expect(screen.getByText("Trigger message / Text input")).toBeDefined();
    expect(screen.getByText("Trigger attachments")).toBeDefined();
    expect(screen.getByText("Business name")).toBeDefined();
    expect(screen.getByText("Business services")).toBeDefined();
    expect(screen.getByText("Timezone")).toBeDefined();
  });

  it("renders Sender phone, Sender name, Business name, Business services, Timezone, and text input for inbound SMS workflows", () => {
    render(<TestPanel {...defaultProps} isSmsWorkflow={true} isManualTriggerWorkflow={false} />);

    expect(screen.getByText("Simulate an inbound SMS")).toBeDefined();
    expect(screen.getByText("Sender phone")).toBeDefined();
    expect(screen.getByText("Sender name")).toBeDefined();
    expect(screen.getByText("SMS Message / Text input")).toBeDefined();
    expect(screen.getByText("Business name")).toBeDefined();
    expect(screen.getByText("Business services")).toBeDefined();
    expect(screen.getByText("Timezone")).toBeDefined();
  });
});
