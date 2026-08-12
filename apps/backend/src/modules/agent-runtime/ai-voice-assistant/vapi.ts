import type { Context } from "hono";
import { env } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import {
  deployVapiAssistant,
  extractCallRecordingUrls,
  extractVapiCallVoicePipeline,
  genericAssistantTools,
  getVoiceAnswerStatus,
  isRealId,
  isVapiConfigured,
  resolveTranscriberLanguage,
  resolveVapiModel,
  resolveVapiVoice,
  startVapiOutboundCall,
  createVapiInboundTwiml,
  type VapiCallDetails
} from "../../architect/vapi-connector";
import {
  authorizeVapiWebhook,
  buildBusinessContext,
  extractStructuredCallTurns,
  findBusinessByVapiWebhook,
  firstNestedString,
  getAllToolCalls,
  getVapiMetadata,
  isArchitectSandboxBusiness,
  isSandboxExecutionBusiness,
  isVapiInstalledAgentPaused,
  latestActiveInstalledAgent,
  loadDentalToolConfig,
  parseBody,
  parseStoredVoicePipeline,
  recordVapiCallUsage,
  resolveLiveAfterHoursGateContext,
  resolveVapiCallExecutionMode,
  endLiveAfterHoursCall
} from "../../architect/twilio-business-routing";
import { getVoiceSession, updateVoiceSessionState } from "./session";
import { buildUnifiedVoiceSystemPrompt } from "./prompt";
import { executeToolGateway } from "./tools";
import { logVoiceCallEvent, logVoiceToolExecution } from "./observability";
import type { VoiceToolContext } from "./types";

export {
  deployVapiAssistant,
  extractCallRecordingUrls,
  extractVapiCallVoicePipeline,
  genericAssistantTools,
  getVoiceAnswerStatus,
  isRealId,
  isVapiConfigured,
  resolveTranscriberLanguage,
  resolveVapiModel,
  resolveVapiVoice,
  startVapiOutboundCall,
  createVapiInboundTwiml
};
export type { VapiCallDetails };

export async function handleVapiWebhook(c: Context) {
  const startTime = Date.now();
  const body = ((await parseBody(c).catch(() => ({}))) as Record<string, unknown>) ?? {};
  const toolCalls = getAllToolCalls(body);
  const receivedType = firstNestedString(body, [["message", "type"], ["type"]]) || "(unknown)";

  logVoiceCallEvent({
    event: "webhook_received",
    message: `Received ${c.req.method} request with type '${receivedType}' and ${toolCalls.length} tool calls`,
    details: { method: c.req.method, path: c.req.path, receivedType, toolCount: toolCalls.length }
  });

  const auth = authorizeVapiWebhook(c, body);
  if (!auth.authorized) {
    logVoiceCallEvent({
      event: "webhook_unauthorized",
      status: 401,
      message: `Unauthorized webhook: ${auth.reason}`
    });
    return c.json({ success: false, error: "Unauthorized", code: "VAPI_WEBHOOK_UNAUTHORIZED" }, 401);
  }

  try {
    const metadata = getVapiMetadata(body);
    const business = await findBusinessByVapiWebhook(body);

    if (auth.requiresArchitectSandbox && !(business && (await isArchitectSandboxBusiness(business)))) {
      return c.json({ success: false, error: "Unauthorized", code: "VAPI_WEBHOOK_UNAUTHORIZED" }, 401);
    }

    const businessContext = business ? buildBusinessContext(business) : null;
    const metadataInstalledAgentId =
      typeof metadata.installedAgentId === "string" ? metadata.installedAgentId : undefined;
    const sandboxBusiness = businessContext?.businessId
      ? await isSandboxExecutionBusiness(businessContext.businessId, metadataInstalledAgentId)
      : false;
    const callType = firstNestedString(body, [["message", "call", "type"], ["call", "type"]]);
    const executionMode = resolveVapiCallExecutionMode(metadata, sandboxBusiness, callType);
    const callId = firstNestedString(body, [["message", "call", "id"], ["call", "id"], ["id"]]) || `call_${Date.now()}`;
    const customerPhone =
      firstNestedString(body, [["message", "call", "customer", "number"], ["call", "customer", "number"]]) ||
      (typeof metadata.customerPhone === "string" ? metadata.customerPhone : "");
    const conversationId = typeof metadata.conversationId === "string" ? metadata.conversationId : undefined;
    const messageType = firstNestedString(body, [["message", "type"], ["type"]]);
    const summary = firstNestedString(body, [["message", "summary"], ["summary"]]);
    const transcript =
      firstNestedString(body, [["message", "transcript"], ["transcript"]]) ||
      extractStructuredCallTurns(body)
        .map((turn) => `${turn.role === "assistant" ? "AI" : "User"}: ${turn.content}`)
        .join("\n");

    const agentPaused = businessContext?.businessId
      ? await isVapiInstalledAgentPaused(businessContext.businessId, metadataInstalledAgentId)
      : false;

    const existingCallRow =
      agentPaused && callId
        ? await prisma.vapiCall.findUnique({ where: { callId }, select: { id: true } }).catch(() => null)
        : null;

    if (agentPaused && !existingCallRow) {
      if (toolCalls.length === 0) return c.json({ ok: true, paused: true });
      return c.json({
        results: toolCalls.map((toolCall) => ({
          name: toolCall.name,
          toolCallId: toolCall.id,
          result: JSON.stringify({
            success: false,
            code: "AGENT_PAUSED",
            message: "This agent is paused. No workflow action was performed."
          })
        }))
      });
    }

    // Persist call state row
    if (businessContext?.businessId && callId) {
      try {
        await prisma.vapiCall.upsert({
          where: { callId },
          update: {
            status: messageType || "UPDATED",
            executionMode,
            transcript: transcript || undefined,
            summary: summary || undefined,
            endedAt: /end|ended|report/.test(messageType ?? "") ? new Date() : undefined,
            metadataJson: body as never
          },
          create: {
            businessId: businessContext.businessId,
            installedAgentId: metadataInstalledAgentId,
            conversationId,
            callId,
            customerPhone,
            executionMode,
            status: messageType || "STARTED",
            transcript: transcript || null,
            summary: summary || null,
            metadataJson: body as never
          }
        });
      } catch (error) {
        console.error("[ai-voice-assistant] vapiCall.upsert failed (non-fatal)", error);
      }
    }

    const isEndOfCallEvent = /end-of-call-report|end|ended|report/i.test(messageType ?? "");
    const settleLiveEndOfCall = async () => {
      if (!businessContext?.businessId || !callId || executionMode !== "LIVE" || !isEndOfCallEvent) return;
      const liveBusinessId = businessContext.businessId;

      const installedAgent = await (async () => {
        const storedCall = await prisma.vapiCall.findUnique({
          where: { callId },
          select: { installedAgentId: true }
        });
        const directIds = [metadataInstalledAgentId, storedCall?.installedAgentId].filter(
          (id): id is string => Boolean(id)
        );
        if (directIds.length > 0) {
          const directAgents = await prisma.installedAgent.findMany({
            where: { businessId: liveBusinessId, id: { in: [...new Set(directIds)] } },
            select: { id: true, workflowId: true }
          });
          const directById = new Map(directAgents.map((agent) => [agent.id, agent]));
          for (const id of directIds) {
            const direct = directById.get(id);
            if (direct) return direct;
          }
        }
        return latestActiveInstalledAgent(liveBusinessId);
      })().catch(() => null);

      if (installedAgent?.workflowId) {
        try {
          await prisma.workflowRun.upsert({
            where: { callProvider_externalCallId: { callProvider: "VAPI", externalCallId: callId } },
            update: { status: "COMPLETED", finishedAt: new Date() },
            create: {
              workflowId: installedAgent.workflowId,
              installedAgentId: installedAgent.id,
              businessId: liveBusinessId,
              mode: "LIVE",
              status: "COMPLETED",
              callProvider: "VAPI",
              externalCallId: callId,
              finishedAt: new Date(),
              inputJson: { source: "vapi_end_of_call", callId }
            }
          });
        } catch (error) {
          console.error("[ai-voice-assistant] WorkflowRun upsert failed (non-fatal)", error);
        }
      }

      try {
        await recordVapiCallUsage({
          businessId: liveBusinessId,
          installedAgentId: installedAgent?.id,
          callId,
          customerPhone,
          webhookBody: body
        });
      } catch (error) {
        console.error("[ai-voice-assistant] USAGE SETTLEMENT FAILED", error);
      }
    };

    const clearAfterHoursOnCallEnd = async () => {
      if (executionMode === "LIVE" && isEndOfCallEvent) {
        await endLiveAfterHoursCall(businessContext?.businessId, callId);
      }
    };

    if (toolCalls.length === 0) {
      await settleLiveEndOfCall();
      await clearAfterHoursOnCallEnd();
      return c.json(agentPaused ? { ok: true, paused: true } : { ok: true });
    }

    await settleLiveEndOfCall();

    if (agentPaused) {
      await clearAfterHoursOnCallEnd();
      return c.json({
        results: toolCalls.map((toolCall) => ({
          name: toolCall.name,
          toolCallId: toolCall.id,
          result: JSON.stringify({
            success: false,
            code: "AGENT_PAUSED",
            message: "This agent is paused. No workflow action was performed."
          })
        }))
      });
    }

    const afterHoursGate = await resolveLiveAfterHoursGateContext({
      businessId: businessContext?.businessId,
      installedAgentId: metadataInstalledAgentId,
      callId,
      executionMode,
      body
    });

    const dental = businessContext?.businessId ? await loadDentalToolConfig(businessContext.businessId) : null;
    const session = businessContext?.businessId
      ? await getVoiceSession(businessContext.businessId, callId, {
          installedAgentId: metadataInstalledAgentId,
          conversationId,
          customerPhone,
          executionMode,
          timeZone: dental?.testTimeZone || businessContext?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE
        })
      : {
          businessId: "unknown",
          callId,
          executionMode,
          timeZone: env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
          updatedAt: new Date().toISOString(),
          version: "v2" as const
        };

    const baseCtx: VoiceToolContext = {
      session,
      business: businessContext,
      dental,
      timeZone: dental?.testTimeZone || businessContext?.timeZone || env.GOOGLE_CALENDAR_DEFAULT_TIMEZONE,
      customerPhone,
      patientPhone: customerPhone,
      conversationId,
      callId,
      summary,
      transcript,
      executionMode,
      installedAgentId: metadataInstalledAgentId,
      afterHours: afterHoursGate,
      callTurns: extractStructuredCallTurns(body)
    };

    const results: Array<{ name: string; toolCallId: string; result: string }> = [];
    for (const toolCall of toolCalls) {
      const toolStart = Date.now();
      const toolResponse = await executeToolGateway(toolCall, baseCtx);
      const toolLatencyMs = Date.now() - toolStart;

      logVoiceToolExecution(toolCall.name, toolLatencyMs, true, callId, businessContext?.businessId);
      results.push(toolResponse);
    }

    await clearAfterHoursOnCallEnd();

    logVoiceCallEvent({
      callId,
      businessId: businessContext?.businessId,
      event: "webhook_completed",
      latencyMs: Date.now() - startTime,
      details: { toolResultsCount: results.length }
    });

    return c.json({ results });
  } catch (error) {
    console.error("[ai-voice-assistant] webhook handler unhandled error", error);
    if (toolCalls.length === 0) return c.json({ ok: true });
    return c.json({
      results: toolCalls.map((toolCall) => ({
        name: toolCall.name,
        toolCallId: toolCall.id,
        result: JSON.stringify({ success: false, message: "Temporary issue handling the request." })
      }))
    });
  }
}
