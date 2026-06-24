import {
  createGmailDraft,
  readGmailEmail,
  sendGmailEmail
} from "./gmail-connector";

export type WorkflowRunLog = {
  nodeId: string;
  label: string;
  status: "success" | "waiting" | "error";
  message: string;
  output?: unknown;
};

type RunnerNodeData = {
  label?: unknown;
  nodeKind?: unknown;
  description?: unknown;
  prompt?: unknown;
  connector?: unknown;
  connectorAction?: unknown;
  gmailQuery?: unknown;
  gmailTo?: unknown;
  gmailSubject?: unknown;
  gmailBody?: unknown;
  condition?: unknown;
  outputKey?: unknown;
};

type RunnerNode = {
  id: string;
  position?: {
    x?: number;
    y?: number;
  };
  data?: RunnerNodeData;
};

type RunnerEdge = {
  id: string;
  source: string;
  target: string;
};

type RunnerContext = {
  gmail?: {
    emails?: {
      id: string;
      from: string;
      senderEmail: string;
      subject: string;
      body: string;
    }[];
    senderEmail?: string;
    subject?: string;
    body?: string;
  };
  ai?: {
    output?: string;
  };
  approved?: boolean;
  sentEmail?: {
    id: string | null;
    to: string;
    subject: string;
    body: string;
  };
  draftEmail?: {
    id: string | null;
    to: string;
    subject: string;
    body: string;
  };
  output?: unknown;
  [key: string]: unknown;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function isRunnerNode(value: unknown): value is RunnerNode {
  if (typeof value !== "object" || value === null) return false;
  return typeof (value as Partial<RunnerNode>).id === "string";
}

function isRunnerEdge(value: unknown): value is RunnerEdge {
  if (typeof value !== "object" || value === null) return false;

  const edge = value as Partial<RunnerEdge>;

  return (
    typeof edge.id === "string" &&
    typeof edge.source === "string" &&
    typeof edge.target === "string"
  );
}

export function parseRunnerWorkflowJson(value: unknown) {
  if (typeof value !== "object" || value === null) {
    return {
      nodes: [] as RunnerNode[],
      edges: [] as RunnerEdge[]
    };
  }

  const workflowJson = value as {
    nodes?: unknown;
    edges?: unknown;
  };

  return {
    nodes: Array.isArray(workflowJson.nodes)
      ? workflowJson.nodes.filter(isRunnerNode)
      : [],
    edges: Array.isArray(workflowJson.edges)
      ? workflowJson.edges.filter(isRunnerEdge)
      : []
  };
}

function sortNodesForRun(nodes: RunnerNode[]) {
  return [...nodes].sort((a, b) => {
    const ax = typeof a.position?.x === "number" ? a.position.x : 0;
    const bx = typeof b.position?.x === "number" ? b.position.x : 0;

    if (ax !== bx) return ax - bx;

    const ay = typeof a.position?.y === "number" ? a.position.y : 0;
    const by = typeof b.position?.y === "number" ? b.position.y : 0;

    return ay - by;
  });
}

function resolveContextPath(context: RunnerContext, path: string): unknown {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (typeof current !== "object" || current === null) return undefined;
    return (current as Record<string, unknown>)[segment];
  }, context);
}

function renderTemplate(input: unknown, context: RunnerContext) {
  const template = asString(input);

  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path: string) => {
    const value = resolveContextPath(context, path);

    if (value === undefined || value === null) return "";

    return String(value);
  });
}

function createLog(
  node: RunnerNode,
  status: WorkflowRunLog["status"],
  message: string,
  output?: unknown
): WorkflowRunLog {
  return {
    nodeId: node.id,
    label: asString(node.data?.label, node.id),
    status,
    message,
    output
  };
}

function runTriggerNode(node: RunnerNode, logs: WorkflowRunLog[]) {
  logs.push(createLog(node, "success", "Trigger started the workflow."));
}

function runAiNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  const prompt = asString(node.data?.prompt, "Draft a professional response.");

  const emailSubject = context.gmail?.subject ?? "Customer email";
  const emailBody = context.gmail?.body ?? "No email body available.";

  const output = `Draft reply for "${emailSubject}": Thanks for reaching out. We reviewed your message: "${emailBody}". We will help you with this and get back shortly.`;

  context.ai = {
    output
  };

  logs.push(
    createLog(node, "success", "AI generated a draft response.", {
      prompt,
      output
    })
  );
}

async function runGmailConnectorNode({
  userId,
  node,
  context,
  logs
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
}) {
  const action = asString(node.data?.connectorAction, "read_emails");

  if (action === "read_emails") {
    const query = asString(node.data?.gmailQuery, "newer_than:7d");
    const email = await readGmailEmail({
      userId,
      query
    });

    if (!email) {
      logs.push(createLog(node, "error", `No Gmail emails found for query: ${query}`));
      return;
    }

    context.gmail = {
      emails: [email],
      senderEmail: email.senderEmail,
      subject: email.subject,
      body: email.body
    };

    logs.push(
      createLog(node, "success", `Read Gmail email using query: ${query}`, {
        email
      })
    );

    return;
  }

  if (action === "send_email") {
    const to = renderTemplate(node.data?.gmailTo, context);
    const subject = renderTemplate(node.data?.gmailSubject, context);
    const body = renderTemplate(node.data?.gmailBody, context);

    if (!to || !subject || !body) {
      logs.push(
        createLog(
          node,
          "error",
          "Gmail send failed because To, Subject, or Body is empty."
        )
      );
      return;
    }

    const sentEmail = await sendGmailEmail({
      userId,
      to,
      subject,
      body
    });

    context.sentEmail = sentEmail;

    logs.push(createLog(node, "success", "Gmail email sent successfully.", sentEmail));
    return;
  }

  if (action === "draft_reply") {
    const to = renderTemplate(node.data?.gmailTo, context);
    const subject = renderTemplate(node.data?.gmailSubject, context);
    const body = renderTemplate(node.data?.gmailBody, context);

    if (!to || !subject || !body) {
      logs.push(
        createLog(
          node,
          "error",
          "Gmail draft failed because To, Subject, or Body is empty."
        )
      );
      return;
    }

    const draftEmail = await createGmailDraft({
      userId,
      to,
      subject,
      body
    });

    context.draftEmail = draftEmail;

    logs.push(createLog(node, "success", "Gmail draft created successfully.", draftEmail));
    return;
  }

  logs.push(createLog(node, "error", `Unsupported Gmail action: ${action}`));
}

async function runConnectorNode({
  userId,
  node,
  context,
  logs
}: {
  userId: string;
  node: RunnerNode;
  context: RunnerContext;
  logs: WorkflowRunLog[];
}) {
  const connector = asString(node.data?.connector, "Gmail");

  if (connector === "Gmail") {
    await runGmailConnectorNode({
      userId,
      node,
      context,
      logs
    });
    return;
  }

  logs.push(createLog(node, "success", `${connector} connector simulated.`));
}

function runConditionNode(node: RunnerNode, logs: WorkflowRunLog[]) {
  const condition = asString(node.data?.condition, "No condition configured");
  logs.push(createLog(node, "success", `Condition passed: ${condition}`));
}

function runApprovalNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  context.approved = true;
  logs.push(createLog(node, "waiting", "Human approval simulated as approved."));
}

function runOutputNode(node: RunnerNode, context: RunnerContext, logs: WorkflowRunLog[]) {
  const outputKey = asString(node.data?.outputKey, "result");

  context.output = {
    key: outputKey,
    value: context.sentEmail ?? context.draftEmail ?? context.ai ?? context.gmail ?? null
  };

  logs.push(createLog(node, "success", `Output saved as ${outputKey}.`, context.output));
}

export async function runWorkflowTest({
  userId,
  workflowId,
  workflowJson
}: {
  userId: string;
  workflowId: string;
  workflowJson: unknown;
}) {
  const parsedWorkflow = parseRunnerWorkflowJson(workflowJson);
  const logs: WorkflowRunLog[] = [];
  const context: RunnerContext = {};

  if (parsedWorkflow.nodes.length === 0) {
    return {
      workflowId,
      logs: [
        {
          nodeId: "empty",
          label: "Empty workflow",
          status: "error" as const,
          message: "Please add at least one node before running test."
        }
      ],
      context
    };
  }

  for (const node of sortNodesForRun(parsedWorkflow.nodes)) {
    const nodeKind = asString(node.data?.nodeKind);

    try {
      if (nodeKind === "trigger") {
        runTriggerNode(node, logs);
        continue;
      }

      if (nodeKind === "connector") {
        await runConnectorNode({
          userId,
          node,
          context,
          logs
        });
        continue;
      }

      if (nodeKind === "ai") {
        runAiNode(node, context, logs);
        continue;
      }

      if (nodeKind === "condition") {
        runConditionNode(node, logs);
        continue;
      }

      if (nodeKind === "approval") {
        runApprovalNode(node, context, logs);
        continue;
      }

      if (nodeKind === "output") {
        runOutputNode(node, context, logs);
        continue;
      }

      logs.push(createLog(node, "error", `Unknown node kind: ${nodeKind}`));
    } catch (error) {
      logs.push(
        createLog(
          node,
          "error",
          error instanceof Error ? error.message : "Node execution failed"
        )
      );
    }
  }

  return {
    workflowId,
    logs,
    context
  };
}