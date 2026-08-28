/**
 * Maps Memory Engine output -> Provider Engine input, and provider response -> NodeMemoryPayload.
 * This is the integration contract between Gaurav (memory) and Akhil (provider).
 */
import { normalizeLlmProviderId } from "@coreai/shared";
import type { AIExecuteRequest, AIExecuteResponse } from "../ai-provider-engine/types";
import type { ContextBundle, NodeMemoryPayload } from "./types";

/** Minimal node shape from workflow-runner - avoids importing the whole runner module. */
export type AiBrainNodeConfig = {
  id: string;
  nodeType: string;
  nodeLabel?: string;
  data?: {
    type?: unknown;
    label?: unknown;
    title?: unknown;
    prompt?: unknown;
    instructions?: unknown;
    provider?: unknown;
    model?: unknown;
    temperature?: unknown;
    maxTokens?: unknown;
    outputFormat?: unknown;
    backlinkNodeIds?: unknown;
    // LLM Call node fields (ai.llm_call) - mapped before reaching here,
    // but kept for reference / direct fallback
    llmProvider?: unknown;
    llmModel?: unknown;
    llmRequirements?: unknown;
    llmSystemPrompt?: unknown;
    llmPrompt?: unknown;
    llmContext?: unknown;
    /** The customer's own words this run — presented as the authoritative
     * user turn, never buried inside the author's prompt template. */
    llmCustomerMessage?: unknown;
    llmTemperature?: unknown;
    llmMaxTokens?: unknown;
    llmOutputFormat?: unknown;
    /** "How hard it thinks" — see ai-provider-engine/types.ts. */
    reasoningEffort?: unknown;
    llmOutputKey?: unknown;
    attachments?: unknown;
  };
};

/** Aliases and provider ids live in the shared LLM catalog. */
export function normalizeProviderId(raw: unknown): string {
  return normalizeLlmProviderId(raw);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function buildWorkflowLlmSystemPrompt(params: {
  bundle: ContextBundle;
  legacySystemPrompt: string;
  outputFormat: "text" | "json";
  hasCustomerMessage: boolean;
}): string {
  const { bundle, legacySystemPrompt, outputFormat, hasCustomerMessage } = params;
  const sections = [
    "You are executing one AI step inside a Triven AI workflow.",
    "The workflow author may write rough, non-technical requirements. Convert those requirements into the best useful output for this step.",
    "Use the workflow context, previous-node memory, and any additional context provided with the request.",
    "Do not ask follow-up questions unless the workflow author explicitly asks you to ask one.",
    // One-shot runs get no second turn — anything the customer already said
    // must be used, never asked for again.
    ...(hasCustomerMessage
      ? ["If the user's message already contains details, use them; never re-ask for provided details."]
      : []),
    "Preserve template variables exactly as written, including values like {{business.name}}, {{customer.phone}}, and {{ai.output}}.",
    outputFormat === "json"
      ? "Return only valid JSON. Do not wrap it in markdown fences or add explanatory text."
      : "Return concise plain text unless the workflow author asks for another format.",
  ];

  if (legacySystemPrompt) {
    sections.push(`Legacy workflow instructions:\n${legacySystemPrompt}`);
  }

  sections.push(`Memory context prepared for this node:\n${bundle.compressedPrompt}`);

  return sections.join("\n\n");
}

function buildWorkflowLlmUserPrompt(params: {
  requirements: string;
  context: string;
  customerMessage: string;
}): string {
  const sections = [`Workflow author's rough requirements:\n${params.requirements}`];

  if (params.context) {
    sections.push(`Additional context / knowledge:\n${params.context}`);
  }

  // The customer's own message closes the user turn as the authoritative ask —
  // labeled and last, never buried mid-template. Skipped only when the
  // author's template already embedded the exact message text.
  if (params.customerMessage && !params.requirements.includes(params.customerMessage)) {
    sections.push(
      `The customer's message (authoritative — answer this, using every detail it contains):\n${params.customerMessage}`
    );
  }

  return sections.join("\n\n");
}

import { resolveAttachments } from "./attachment-resolver";

/** ContextBundle + node config -> request for getProviderEngine().executeWithProvider() */
export async function contextBundleToExecuteRequest(
  bundle: ContextBundle,
  node: AiBrainNodeConfig
): Promise<AIExecuteRequest> {
  const data = node.data ?? {};
  const outputFormat = data.outputFormat === "json" ? "json" : "text";

  // Workflow authors write plain-language requirements. Legacy prompt fields
  // remain fallbacks so existing saved workflows continue to execute.
  const requirements =
    asString(data.llmRequirements) ||
    asString(data.llmPrompt) ||
    asString(data.prompt) ||
    asString(data.instructions) ||
    asString(bundle.merged.originalPrompt) ||
    "Execute this workflow step using the provided context.";

  const legacySystemPrompt =
    asString(data.llmSystemPrompt) ||
    asString(data.instructions);

  const customerMessage = asString(data.llmCustomerMessage);

  const systemPrompt = buildWorkflowLlmSystemPrompt({
    bundle,
    legacySystemPrompt,
    outputFormat,
    hasCustomerMessage: customerMessage.length > 0,
  });

  const userPrompt = buildWorkflowLlmUserPrompt({
    requirements,
    context: asString(data.llmContext),
    customerMessage,
  });

  const rawAttachments = [
    ...(Array.isArray(data.attachments) ? data.attachments : []),
    ...(Array.isArray(bundle.merged.files)
      ? bundle.merged.files.map((file) => ({
          name: file.name,
          mimeType: file.mimeType || "application/octet-stream",
          data: file.url,
        }))
      : []),
  ];

  const resolvedAttachments = await resolveAttachments(rawAttachments);

  return {
    systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
    model: asString(data.model) || undefined,
    temperature: asNumber(data.temperature) ?? 0.7,
    /* THE DIAL THE ARCHITECT TURNED AND NOTHING READ. It is carried to the
       provider now; adapters that have no such setting ignore it. */
    ...(data.reasoningEffort === "low" ||
    data.reasoningEffort === "medium" ||
    data.reasoningEffort === "high"
      ? { reasoningEffort: data.reasoningEffort }
      : {}),
    maxTokens: (() => {
      const tokens = asNumber(data.maxTokens);
      return (tokens === undefined || tokens <= 250) ? 2048 : tokens;
    })(),
    outputFormat,
    attachments: resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
    workflowContext: {
      workflowRunId: bundle.workflowRunId,
      nodeId: bundle.nodeId,
      threadId: bundle.threadId,
      merged: bundle.merged,
      contextLinkCount: bundle.contextLinks.length,
    },
    previousNodeMemory: bundle.previousMemory
      ? {
          nodeId: bundle.previousMemory.nodeId,
          nodeType: bundle.previousMemory.nodeType,
          summary: bundle.previousMemory.summary,
          // Memory Node output is the full raw memory string; the smart-memory
          // layer already delivers it (resolved) — never forward it raw here.
          output: bundle.previousMemory.nodeType === "ai.memory" ? undefined : bundle.previousMemory.output,
        }
      : undefined,
    metadata: {
      workflowRunId: bundle.workflowRunId,
      nodeId: bundle.nodeId,
      threadId: bundle.threadId,
      backLinkedNodeIds: bundle.backLinkedMemories.map((m) => m.nodeId),
    },
  };
}

/** Provider response -> payload for memoryBroker.saveNodeMemory() */
export function providerResponseToNodeMemory(params: {
  bundle: ContextBundle;
  node: AiBrainNodeConfig;
  response: AIExecuteResponse;
  executionOrder: number;
  startedAt: string;
  finishedAt: string;
}): NodeMemoryPayload {
  const { bundle, node, response, executionOrder, startedAt, finishedAt } = params;
  const durationMs = Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime());
  /* A CALL THAT COSTS LESS THAN A CENT COSTS ZERO. Almost every AI call does
     — a tenth of a cent is normal — and this rounded to whole cents, so the
     stored cost of a run was zero however much it really cost, permanently,
     in the ledger the platform reconciles against. Kept in millionths now;
     the cents field stays for whatever already reads it. */
  const totalCostUsd = response.cost?.totalCostUsd;
  const costMicroUsd = totalCostUsd ? Math.round(totalCostUsd * 1_000_000) : undefined;
  const costCents = totalCostUsd ? Math.round(totalCostUsd * 100) : undefined;

  return {
    workflowRunId: bundle.workflowRunId,
    nodeId: node.id,
    nodeType: node.nodeType,
    nodeLabel: node.nodeLabel,
    status: response.status === "success" ? "success" : "error",
    executionOrder,
    threadId: bundle.threadId,
    input: {
      prompt: node.data?.llmRequirements ?? node.data?.prompt ?? node.data?.instructions,
      provider: normalizeProviderId(node.data?.provider),
      model: node.data?.model,
      compressedPrompt: bundle.compressedPrompt,
    },
    output: {
      text: response.text,
      structuredOutput: response.structuredOutput,
      status: response.status,
      error: response.error,
    },
    summary: response.text?.slice(0, 240) ?? response.error ?? undefined,
    provider: response.providerId,
    model: response.modelName,
    tokenInput: response.usage.promptTokens,
    tokenOutput: response.usage.completionTokens,
    costCents,
    costMicroUsd,
    startedAt,
    finishedAt,
    durationMs,
    files: [
      ...(Array.isArray(bundle.merged.files) ? bundle.merged.files : []),
      ...(Array.isArray(node.data?.attachments)
        ? node.data.attachments.map((att: any) => ({
            name: att.name,
            url: att.data,
            mimeType: att.mimeType,
          }))
        : []),
    ],
    errorMessage: response.status === "error" ? response.error ?? "Provider execution failed" : undefined,
  };
}
