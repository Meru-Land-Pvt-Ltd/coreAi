import {
  toAiSafeAppointmentActionResult,
  toAiSafeAvailabilityResult,
  toAiSafeBookingResult
} from "../../compliance/ai-safe-results";
import { gateLiveAfterHoursAction } from "../../architect/after-hours-live-gate";
import { logAfterHoursRouting } from "../../business/after-hours-state";
import { CallStateUnavailableError } from "../../architect/call-contact-store";
import {
  runBookAppointmentTool,
  runCancelAppointmentTool,
  runCheckAvailabilityTool,
  runLookupKnowledgeTool,
  runRecordSmsConsentTool,
  runRescheduleAppointmentTool,
  runSendNotificationTool,
  runUpdateAppointmentContactTool,
  runVerifyAndLookupAppointmentTool,
  dryRunAvailabilitySlots,
  todayInZone,
  CANCEL_FAILED_MESSAGE,
  RESCHEDULE_FAILED_MESSAGE
} from "../../architect/twilio-business-routing";
import type { NormalizedToolResult, VoiceToolContext } from "./types";

export interface ToolCallInput {
  id: string;
  name: string;
  parameters: Record<string, unknown>;
}

export interface ToolExecutionResponse {
  name: string;
  toolCallId: string;
  result: string;
}

export async function executeToolGateway(
  toolCall: ToolCallInput,
  ctx: VoiceToolContext
): Promise<ToolExecutionResponse> {
  const rawFnName = toolCall.name.toLowerCase().replace(/[^a-z]/g, "");
  const isConsent = rawFnName.includes("consent");
  const isLookup = !isConsent && (rawFnName.includes("knowledge") || rawFnName.startsWith("lookup"));
  const isUpdateContact = !isConsent && !isLookup && rawFnName.includes("update") && rawFnName.includes("contact");
  const isCancel = !isConsent && !isLookup && !isUpdateContact && rawFnName.includes("cancel");
  const isReschedule = !isConsent && !isLookup && !isCancel && rawFnName.includes("resched");
  const isVerify = !isConsent && !isLookup && !isUpdateContact && !isCancel && !isReschedule && rawFnName.includes("verify");
  const isCheck = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && (rawFnName.startsWith("check") || rawFnName.includes("availab"));
  const isBook = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && rawFnName.startsWith("book");
  const isNotify = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && (rawFnName.startsWith("send") || rawFnName.includes("notif"));
  const isTransfer = !isConsent && !isLookup && !isCancel && !isReschedule && !isVerify && (rawFnName.includes("transfer") || rawFnName.includes("forward"));

  // Gate check
  const gatedAction = isCheck
    ? ("check_availability" as const)
    : isBook || isCancel || isReschedule || isVerify
      ? ("book_appointment" as const)
      : null;

  const afterHoursBlock = gatedAction && ctx.afterHours
    ? gateLiveAfterHoursAction(ctx.afterHours, gatedAction)
    : { allowed: true as const };

  let payload: unknown;
  let afterHoursBlocked = false;
  let callStateUnavailable = false;

  if (!afterHoursBlock.allowed && ctx.afterHours) {
    afterHoursBlocked = true;
    payload = {
      success: false,
      code: afterHoursBlock.code,
      message: afterHoursBlock.message
    };
    logAfterHoursRouting({
      event: "live_tool_blocked",
      businessId: ctx.business?.businessId ?? null,
      installedAgentId: ctx.installedAgentId ?? null,
      callId: ctx.callId,
      route: ctx.afterHours.state?.route ?? null,
      executionMode: ctx.executionMode,
      outcome: afterHoursBlock.code,
      callerPhone: ctx.customerPhone || null
    });
  } else {
    try {
      if (isConsent) {
        payload = await runRecordSmsConsentTool(toolCall.parameters, ctx as never);
      } else if (isLookup) {
        payload = await runLookupKnowledgeTool(toolCall.parameters, ctx as never);
      } else if (isUpdateContact) {
        payload = await runUpdateAppointmentContactTool(toolCall.parameters, ctx as never);
      } else if (isCancel) {
        payload = await runCancelAppointmentTool(toolCall.parameters, ctx as never);
      } else if (isReschedule) {
        payload = await runRescheduleAppointmentTool(toolCall.parameters, ctx as never);
      } else if (isVerify) {
        payload = await runVerifyAndLookupAppointmentTool(toolCall.parameters, ctx as never);
      } else if (isCheck) {
        payload = await runCheckAvailabilityTool(toolCall.parameters, ctx as never);
      } else if (isBook) {
        payload = await runBookAppointmentTool(toolCall.parameters, ctx as never);
      } else if (isNotify) {
        payload = await runSendNotificationTool(toolCall.parameters, ctx as never);
      } else if (isTransfer) {
        payload = await runTransferCallTool(toolCall.parameters, ctx);
      } else {
        payload = { ok: true };
      }
    } catch (error) {
      if (error instanceof CallStateUnavailableError) {
        console.error(`[tool-gateway] call state unavailable — failing closed`, {
          tool: toolCall.name,
          callId: ctx.callId
        });
        callStateUnavailable = true;
        payload = {
          success: false,
          code: "CALL_STATE_UNAVAILABLE",
          cancelled: false,
          rescheduled: false,
          consent_recorded: false,
          updated: false,
          sms_allowed: false,
          customerSpeechCode: "SYSTEM_UNAVAILABLE",
          customerSafeMessage:
            "I'm sorry, our booking system is briefly unavailable. I can't confirm or change anything right now.",
          message:
            "Distributed call state is unavailable. Do NOT book, update a phone number, record consent, or send any text. Apologize briefly, take the caller's name and callback number, and tell them the team will follow up."
        };
      } else {
        console.error(`[tool-gateway] tool ${toolCall.name} failed (returning safe result)`, error);
        payload = isLookup
          ? { found: false, sections: [], message: "Knowledge lookup is unavailable right now. Use the business context you already have or the fallback response." }
          : isCheck
            ? { available_slots: dryRunAvailabilitySlots(ctx.dental as never), date: todayInZone(ctx.timeZone), source: "demo", calendar_status: "needs_reconnect" }
            : isBook
              ? { success: false, message: "Could not complete the booking right now. Please try again." }
              : isConsent
                ? { success: false, consent_recorded: false, message: "Could not record consent. Do not send texts." }
                : isCancel
                  ? { cancelled: false, code: "CANCELLATION_FAILED", message: CANCEL_FAILED_MESSAGE }
                  : isReschedule
                    ? { rescheduled: false, code: "RESCHEDULE_FAILED", message: RESCHEDULE_FAILED_MESSAGE }
                    : { success: false };
      }
    }
  }

  // Normalize AI-safe payload
  if (payload && typeof payload === "object" && !afterHoursBlocked && !callStateUnavailable) {
    if (isCheck) payload = toAiSafeAvailabilityResult(payload as Record<string, unknown>);
    else if (isBook) payload = toAiSafeBookingResult(payload as Record<string, unknown>);
    else if (isCancel || isReschedule) {
      payload = toAiSafeAppointmentActionResult(payload as Record<string, unknown>);
    }
  }

  return {
    name: toolCall.name,
    toolCallId: toolCall.id,
    result: typeof payload === "string" ? payload : JSON.stringify(payload)
  };
}

async function runTransferCallTool(
  params: Record<string, unknown>,
  ctx: VoiceToolContext
): Promise<NormalizedToolResult> {
  const target = (params.destinationNumber as string) || (params.department as string) || ctx.business?.teamPhone;
  if (!target) {
    return {
      success: false,
      code: "NO_TRANSFER_DESTINATION",
      message: "No transfer phone number or department configured for this business."
    };
  }

  return {
    success: true,
    code: "TRANSFER_INITIATED",
    message: `Transferring call to ${target}. Please stay on the line.`,
    data: { destination: target }
  };
}
