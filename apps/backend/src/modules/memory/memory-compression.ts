import type { MergedWorkflowMemory, NodeMemoryRecord } from "./types";

const MAX_CONTEXT_ITEMS = 20;

function isEmptyOutput(output: unknown): boolean {
  if (output === null || output === undefined) return true;
  if (typeof output === "string") return output.trim().length === 0;
  if (Array.isArray(output)) return output.length === 0;
  if (typeof output === "object") return Object.keys(output as object).length === 0;
  return false;
}

export function compressNodeMemories(memories: NodeMemoryRecord[]): NodeMemoryRecord[] {
  return memories
    .filter((memory) => !isEmptyOutput(memory.output) || Boolean(memory.summary))
    .map((memory) => ({
      ...memory,
      summary: memory.summary?.trim() || undefined,
    }));
}

export function compressMergedMemory(merged: MergedWorkflowMemory): MergedWorkflowMemory {
  const uniqueSummaries = [...new Set(merged.summaries.map((s) => s.trim()).filter(Boolean))];
  const uniqueOutputs = merged.outputs.filter(
    (item, index, arr) =>
      !isEmptyOutput(item.output) &&
      arr.findIndex(
        (x) => x.nodeId === item.nodeId && JSON.stringify(x.output) === JSON.stringify(item.output)
      ) === index
  );
  const uniqueFiles = [
    ...new Map(merged.files.map((file) => [`${file.url}:${file.name}`, file])).values(),
  ];
  return {
    ...merged,
    summaries: uniqueSummaries.slice(0, MAX_CONTEXT_ITEMS),
    outputs: uniqueOutputs.slice(0, MAX_CONTEXT_ITEMS),
    files: uniqueFiles.slice(0, MAX_CONTEXT_ITEMS),
  };
}

export function extractTextFromOutput(output: unknown): string {
  if (output === null || output === undefined) return "";
  if (typeof output === "string") return output.trim();
  if (typeof output === "object") {
    const o = output as Record<string, unknown>;
    for (const key of ["text", "body", "output", "message", "content", "result"]) {
      if (typeof o[key] === "string" && (o[key] as string).trim()) {
        return (o[key] as string).trim();
      }
    }
    const cleanEntries = Object.entries(o).filter(
      ([k]) =>
        ![
          "icon",
          "accent",
          "kind",
          "nodeKind",
          "type",
          "footer",
          "subtitle",
          "providerId",
          "modelName",
          "nodeRunId",
          "outputKey",
          "status",
          "error"
        ].includes(k)
    );
    if (cleanEntries.length > 0) {
      return cleanEntries
        .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
        .join("\n");
    }
  }
  return String(output);
}

/** Final prompt text the AI Brain node sends to OpenAI, Claude, Manus, etc. */
export function buildCompressedPrompt(merged: MergedWorkflowMemory): string {
  const sections: string[] = [];
  if (merged.originalPrompt) {
    sections.push(`# User Prompt\n${merged.originalPrompt}`);
  }
  if (merged.summaries.length > 0) {
    sections.push(`# Summaries\n${merged.summaries.join("\n")}`);
  }
  if (merged.outputs.length > 0) {
    sections.push(
      `# Previous Outputs\n${merged.outputs
        .map((item) => {
          const text = extractTextFromOutput(item.output);
          return `## ${item.nodeId} (${item.nodeType})\n${text || JSON.stringify(item.output)}`;
        })
        .join("\n\n")}`
    );
  }
  if (Object.keys(merged.variables).length > 0) {
    sections.push(`# Variables\n${JSON.stringify(merged.variables, null, 2)}`);
  }
  if (merged.files.length > 0) {
    sections.push(`# Artifacts\n${merged.files.map((f) => `- ${f.name}: ${f.url}`).join("\n")}`);
  }
  if (merged.metadata && Object.keys(merged.metadata).length > 0) {
    sections.push(`# Workflow Metadata\n${JSON.stringify(merged.metadata, null, 2)}`);
  }
  return sections.join("\n\n");
}

export type MemoryAttachment = {
  name?: string;
  mimeType?: string;
  data?: string;
};

export type ExecutedNodeSummary = {
  nodeId: string;
  label?: string;
  status: string;
  message?: string;
  output?: unknown;
};

export function extractExecutedNodeText(node: ExecutedNodeSummary): string {
  let textOutput = "";

  if (node.output !== undefined && node.output !== null) {
    if (typeof node.output === "string") {
      textOutput = node.output.trim();
    } else if (typeof node.output === "object") {
      const record = node.output as Record<string, unknown>;
      if (typeof record.text === "string" && record.text.trim()) {
        textOutput = record.text.trim();
      } else if (typeof record.body === "string" && record.body.trim()) {
        textOutput = record.body.trim();
      } else if (typeof record.output === "string" && record.output.trim()) {
        textOutput = record.output.trim();
      } else if (typeof record.message === "string" && record.message.trim()) {
        textOutput = record.message.trim();
      } else {
        // Filter out internal UI keys if object is printed
        const cleanEntries = Object.entries(record).filter(
          ([k]) =>
            ![
              "icon",
              "accent",
              "kind",
              "nodeKind",
              "type",
              "footer",
              "subtitle",
              "providerId",
              "modelName",
              "nodeRunId",
              "outputKey"
            ].includes(k)
        );
        if (cleanEntries.length > 0) {
          textOutput = cleanEntries
            .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
            .join(", ");
        }
      }
    } else {
      textOutput = String(node.output);
    }
  }

  if (!textOutput && node.message) {
    textOutput = node.message;
  }

  return textOutput;
}

export function extractMemoryVariableLines(
  variables: Record<string, unknown>,
  maxValueChars = 300
): string[] {
  const varLines: string[] = [];
  const IGNORED_KEYS = new Set([
    "node",
    "business",
    "missedCall",
    "llmPipeline",
    "ai",
    "condition",
    "capturedLead",
    "sentSms",
    "queuedSms",
    "vapiCall",
    "voiceConversation",
    "inboundSms",
    "handoff",
    "nextWorkflow",
    "smsNotification"
  ]);

  for (const [key, value] of Object.entries(variables)) {
    if (key.startsWith("_") || key.startsWith("memory") || IGNORED_KEYS.has(key)) continue;

    // Skip internal node metadata aliases
    if (typeof value === "object" && value !== null) {
      const obj = value as Record<string, unknown>;
      if (obj.icon || obj.nodeKind || obj.type || obj.accent) continue;
    }

    let valStr = "";
    if (typeof value === "string") {
      valStr = value.trim();
    } else if (typeof value === "number" || typeof value === "boolean") {
      valStr = String(value);
    }

    if (valStr && !key.includes(".") && !key.includes(" ")) {
      if (maxValueChars > 0 && valStr.length > maxValueChars) valStr = valStr.slice(0, maxValueChars) + "...";
      varLines.push(`${key}: ${valStr}`);
    }
  }

  return varLines;
}

export function buildCompactMemoryString(params: {
  executedNodes?: ExecutedNodeSummary[];
  variables?: Record<string, unknown>;
  attachments?: MemoryAttachment[];
  customNotes?: string;
}): string {
  const sections: string[] = [];

  const docLines: string[] = [];
  if (params.customNotes?.trim()) {
    docLines.push(`• Notes: ${params.customNotes.trim()}`);
  }

  if (params.attachments && params.attachments.length > 0) {
    for (const att of params.attachments) {
      const name = att.name || "Attachment";
      let textContent = att.data || "";
      if (textContent.startsWith("data:")) {
        // Do not dump raw Base64 strings into text prompt memory
        const mime = att.mimeType || "file";
        textContent = `[Attached ${mime} file: ${name}]`;
      } else if (!textContent.startsWith("http") && textContent.length > 2000) {
        textContent = textContent.slice(0, 2000) + "...";
      }
      docLines.push(`• ${name}: ${textContent}`);
    }
  }

  if (docLines.length > 0) {
    sections.push(`[DOCUMENTS]\n${docLines.join("\n")}`);
  }

  if (params.executedNodes && params.executedNodes.length > 0) {
    const stepLines: string[] = [];
    params.executedNodes.forEach((node) => {
      const label = node.label || node.nodeId;
      const textOutput = extractExecutedNodeText(node);

      if (textOutput) {
        stepLines.push(`[${label}]\n${textOutput}`);
      }
    });

    if (stepLines.length > 0) {
      sections.push(`[PREVIOUS STEPS]\n${stepLines.join("\n\n")}`);
    }
  }

  if (params.variables && Object.keys(params.variables).length > 0) {
    const varLines = extractMemoryVariableLines(params.variables);

    if (varLines.length > 0) {
      sections.push(`[KEY VARIABLES]\n${varLines.join("\n")}`);
    }
  }

  if (sections.length === 0) {
    return "=== MEMORY ===\n(No prior step history or documents stored)";
  }

  return `=== MEMORY ===\n\n${sections.join("\n\n")}`;
}

