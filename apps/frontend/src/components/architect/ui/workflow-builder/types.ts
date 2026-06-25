import type { Edge, Node } from "@xyflow/react";

export type BuilderTab = "build" | "test" | "configure" | "publish";
export type MobilePanel = "library" | "settings" | null;
export type NodeKind = "trigger" | "ai" | "condition" | "connector" | "output";
export type NodeAccent =
  | "amber"
  | "violet"
  | "orange"
  | "green"
  | "blue"
  | "red"
  | "slate";

export type BuilderNodeData = Record<string, unknown> & {
  label: string;
  title: string;
  nodeKind: NodeKind;
  kind: string;
  accent: NodeAccent;
  icon: string;
  subtitle?: string;
  footer?: string;
  prompt?: string;
  condition?: string;
  connector?: string;
  connectorAction?: string;
  gmailQuery?: string;
  gmailTo?: string;
  gmailSubject?: string;
  gmailBody?: string;
  vapiAssistantId?: string;
  vapiPhoneNumberId?: string;
  calendarId?: string;
  calendarSummary?: string;
  calendarDescription?: string;
  appointmentStartAt?: string;
  appointmentEndAt?: string;
  appointmentService?: string;
  smsTo?: string;
  smsBody?: string;
  sendAt?: string;
  outputKey?: string;
  leadSource?: string;
  leadStatus?: string;
  conversationDirection?: string;
  conversationBody?: string;
  handoffReason?: string;
  nextWorkflowId?: string;
};

export type BuilderNode = Node<BuilderNodeData, "coreNode">;

export type AccentStyle = {
  solid: string;
  soft: string;
  subtle: string;
  border: string;
  selectedBorder: string;
  icon: string;
  chip: string;
  text: string;
  handle: string;
  edge: string;
  edgeClass: string;
  ring: string;
  glow: string;
};

export type LibraryItem = {
  nodeKind: NodeKind;
  label: string;
  helper: string;
  icon: string;
  accent: NodeAccent;
  overrides?: Partial<BuilderNodeData>;
  testId?: string;
};

export type ComingSoonItem = {
  type: string;
  label: string;
  description: string;
  testId: string;
};

export type LibraryGroup = {
  title: string;
  items: LibraryItem[];
};

export type BuilderFlow = {
  nodes: BuilderNode[];
  edges: Edge[];
};

export type AgentTemplate = {
  id: "missed-call" | "gmail-reply" | "ai-receptionist";
  title: string;
  description: string;
  accent: NodeAccent;
  icon: string;
  flow: () => BuilderFlow;
};

export type SmsTestInput = {
  callerNumber: string;
  callerName: string;
  businessName: string;
};
