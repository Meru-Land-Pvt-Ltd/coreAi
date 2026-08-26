import type { Edge, Node } from "@xyflow/react";

export type BuilderTab = "build" | "test" | "configure" | "publish";
export type MobilePanel = "library" | "settings" | null;
export type NodeKind = "trigger" | "ai" | "condition" | "connector" | "output" | "block";
export type NodeAccent =
  | "amber"
  | "violet"
  | "orange"
  | "green"
  | "blue"
  | "red"
  | "slate"
  | "rose";

/** One tappable style card in a Styles Gallery product block. */
export type BlockPreset = {
  id: string;
  title: string;
  emoji: string;
  promptFragment: string;
};

/** One choice in a Model Picker product block. */
export type BlockModelOption = {
  id: string;
  label: string;
};

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
  voice?: string;
  voiceProvider?: string;
  voiceId?: string;
  voiceName?: string;
  calendarId?: string;
  calendarSummary?: string;
  calendarDescription?: string;
  appointmentStartAt?: string;
  appointmentEndAt?: string;
  appointmentService?: string;
  smsTo?: string;
  smsBody?: string;
  connectionId?: string;
  listenFor?: string;
  ignoreGroups?: string;
  ignoreStatusMessages?: string;
  recipient?: string;
  message?: string;
  whatsappMessageType?: string;
  mediaType?: string;
  mediaId?: string;
  mediaLink?: string;
  caption?: string;
  filename?: string;
  templateName?: string;
  languageCode?: string;
  messageId?: string;
  sendAt?: string;
  outputKey?: string;
  scriptLanguage?: string;
  scriptCode?: string;
  scriptOutputKey?: string;
  scriptTimeoutMs?: string;
  leadSource?: string;
  leadStatus?: string;
  conversationDirection?: string;
  conversationBody?: string;
  handoffReason?: string;
  nextWorkflowId?: string;
  llmProvider?: string;
  llmModel?: string;
  llmRequirements?: string;
  llmSystemPrompt?: string;
  llmPrompt?: string;
  llmContext?: string;
  llmTemperature?: string;
  llmMaxTokens?: string;
  llmOutputFormat?: string;
  llmOutputKey?: string;
  audioSource?: string;
  smartFormat?: string;
  punctuate?: string;
  diarize?: string;
  textSource?: string;
  mode?: string;
  telegramBotNameTemplate?: string;
  telegramBotDescription?: string;
  telegramBotShortDescription?: string;
  telegramWelcomeMessage?: string;
  telegramFallbackMessage?: string;
  telegramEventType?: string;
  telegramCommand?: string;
  telegramKeywords?: string;
  telegramMatchType?: string;
  telegramChatAccess?: string;
  telegramIgnoreBots?: string;
  telegramBookingMode?: string;
  telegramServicesCommand?: string;
  telegramBookCommand?: string;
  telegramMyBookingsCommand?: string;
  telegramRescheduleCommand?: string;
  telegramCancelCommand?: string;
  telegramHelpCommand?: string;
  telegramCustomCommands?: Array<{
    id: string;
    command: string;
    description: string;
    action: "reply" | "services" | "book" | "help";
    response: string;
  }>;
  telegramRequestPhone?: string;
  telegramRequestEmail?: string;
  telegramRequestNotes?: string;
  telegramRecipientSource?: string;
  telegramChatIdExpression?: string;
  telegramMessageIdExpression?: string;
  telegramCallbackIdExpression?: string;
  telegramMessageText?: string;
  telegramCallbackText?: string;
  telegramCaption?: string;
  telegramButtonsJson?: string;
  telegramParseMode?: string;
  telegramShowAlert?: string;
  telegramCallbackUrl?: string;
  telegramReplyToMessageId?: string;
  telegramDisableNotification?: string;
  telegramProtectContent?: string;
  telegramContactButtonText?: string;
  telegramPhotoSource?: string;
  telegramDocumentSource?: string;
  telegramVoiceSource?: string;
  telegramLatitude?: string;
  telegramLongitude?: string;
  telegramLivePeriod?: string;
  attachments?: AIAttachment[];
  /* Product blocks ("Your Product" group) — config lives flat on node.data. */
  placeholder?: string;
  presets?: BlockPreset[];
  options?: BlockModelOption[];
};

export type AIAttachment = {
  name?: string;
  mimeType: string;
  data: string;
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

export type LibraryItemBadge = "NEW" | "POPULAR" | "BETA";

export type LibraryItem = {
  nodeKind: NodeKind;
  label: string;
  helper: string;
  icon: string;
  accent: NodeAccent;
  badge?: LibraryItemBadge;
  /** Era leftover, greyed and untouchable — the one-line reason on hover. */
  parked?: string;
  /** Set on the architect's own custom cards: the frame id delete acts on. */
  deletableFrameId?: string;
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
  /** Plain-English one-liner rendered under the group title. */
  subtitle?: string;
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
