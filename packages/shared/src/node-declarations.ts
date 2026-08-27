/**
 * Declaration layer — the contract between the workflow graph and the AI
 * Composer that generates the product interface.
 *
 * Doctrine: nodes DECLARE, the composer decides. This file answers exactly two
 * questions about a stored workflowJson, with zero I/O and zero React:
 *
 *   1. What must a human be ASKED for? (inputs no upstream node supplies)
 *   2. What is SHOWN back to them? (results at the ends of the graph)
 *
 * The heart is the merge: two nodes needing the same semantic value become ONE
 * ask carrying both nodeIds, so a hundred backend holes can surface as three
 * on-screen fields. The composer (an LLM) reads this output; it never re-parses
 * the graph itself, which is why this must be the single source of truth for
 * both backend and frontend.
 */

import {
  API_CALL_DEFAULT_OUTPUT_KEY,
  API_CALL_NODE_TYPE,
  BLOCK_NODE_TYPES,
  DEEPGRAM_NODE_TYPES,
  TELEGRAM_NODE_TYPES,
  VOICE_NODE_TYPES,
  getNodeDefinition,
  isBlockNodeType,
  isDesignBrainNodeType,
  nodeDoorsEnabled
} from "./node-registry";
import { KNOWN_PROMPT_VARIABLES, canonicalPromptVariableKey, extractPromptVariables } from "./prompt-variables";

/* ------------------------------------------------------------------------ */
/* Public types — the other builders import these.                          */
/* ------------------------------------------------------------------------ */

export type DeclaredAskKind =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "phone"
  | "email"
  | "url"
  | "choice"
  | "file";

export type DeclaredShowKind = "text" | "visual" | "image" | "media" | "conversation" | "confirmation";

export type ProductShape = "conversation" | "form" | "generation" | "voice" | "hybrid";

export type DeclaredAsk = {
  /** Stable dedupe key: the normalized semantic name (e.g. "city", "latestmessage"). */
  id: string;
  /** Every node that needs this value. Length >= 2 means the ask was MERGED. */
  nodeIds: string[];
  /** Human words derived from the variable/config name and node labels. */
  label: string;
  kind: DeclaredAskKind;
  required: boolean;
  /** Only for kind "choice". */
  choices?: string[];
  /** Set when this ask only makes sense AFTER that node ran (step-splitting). */
  dependsOnNodeId?: string;
  /**
   * Set when a product block already on the canvas (Prompt Box, Model Picker,
   * Styles Gallery) captures this value — the composer must REUSE that block,
   * never place a duplicate control.
   */
  satisfiedByNodeId?: string;
};

export type DeclaredShow = {
  nodeId: string;
  kind: DeclaredShowKind;
  label: string;
  /**
   * Set when a Result Viewer block already on the canvas renders this output —
   * again: reuse, never duplicate.
   */
  satisfiedByNodeId?: string;
};

/**
 * An interactive product block already on the canvas. The composer must place
 * exactly one control for each — the block IS the interface the architect
 * chose, and a composed page that drops it loses the product's own input
 * (an image studio without its prompt box cannot be used at all).
 */
export type DeclaredControl = {
  nodeId: string;
  role: "input" | "choice" | "action";
  label: string;
  choices?: string[];
};

export type WorkflowDeclarations = {
  /** What a human must be asked. NEVER includes internal holes — see below. */
  asks: DeclaredAsk[];
  /**
   * Holes the RUN fills, not the customer: values produced mid-run
   * (dependsOnNodeId) and door-derived parameters on door-enabled nodes when
   * the customer's own words are already collected. Surfacing one of these as
   * a form field is the "asks for latitude" bug — the composer is told they
   * exist precisely so it never creates fields for them.
   */
  internalAsks: DeclaredAsk[];
  shows: DeclaredShow[];
  /** Existing interactive blocks the composer must re-place, one control each. */
  controls: DeclaredControl[];
  /** Overall product shape the composer should start from. */
  shape: ProductShape;
};

/* ------------------------------------------------------------------------ */
/* Graph reading — defensive, the JSON comes from storage.                  */
/* ------------------------------------------------------------------------ */

type GraphNode = {
  id: string;
  type: string;
  /** node.data merged with node.data.config — where config values actually live. */
  config: Record<string, unknown>;
  label: string;
  /** The raw doors switch off node.data — doors default ON when absent. */
  doorsDisabled?: unknown;
};

/** Presentation keys carried on node.data that are never runtime config. */
const PRESENTATION_KEYS = new Set([
  "type",
  "nodeKind",
  "kind",
  "label",
  "title",
  "subtitle",
  "description",
  "icon",
  "accent",
  "connector",
  "connectorAction",
  "testId",
  "doorsDisabled"
]);

function readGraph(workflowJson: unknown): { nodes: GraphNode[]; edges: Array<{ source: string; target: string }> } {
  const graph = (workflowJson ?? {}) as { nodes?: unknown; edges?: unknown };
  const rawNodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const rawEdges = Array.isArray(graph.edges) ? graph.edges : [];

  const nodes: GraphNode[] = [];
  rawNodes.forEach((raw, index) => {
    if (typeof raw !== "object" || raw === null) return;
    const record = raw as Record<string, unknown>;
    const data = typeof record.data === "object" && record.data !== null ? (record.data as Record<string, unknown>) : {};
    const type = String(data.type ?? record.type ?? "");
    // AI Builder is a canvas companion, not part of the product interface.
    if (!type || isDesignBrainNodeType(type)) return;

    // Config lives flat on data (how the builder saves it) or nested under
    // data.config (older rows) — read both so no hole is missed.
    const nested = typeof data.config === "object" && data.config !== null ? (data.config as Record<string, unknown>) : {};
    const config: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (!PRESENTATION_KEYS.has(key) && key !== "config") config[key] = value;
    }
    Object.assign(config, nested);

    nodes.push({
      id: String(record.id ?? `node-${index}`),
      type,
      config,
      label: String(data.label ?? data.title ?? ""),
      doorsDisabled: data.doorsDisabled
    });
  });

  const edges: Array<{ source: string; target: string }> = [];
  for (const raw of rawEdges) {
    if (typeof raw !== "object" || raw === null) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.source === "string" && typeof record.target === "string") {
      edges.push({ source: record.source, target: record.target });
    }
  }

  return { nodes, edges };
}

/** Transitive ancestors per node — "which nodes already ran before me". */
function buildUpstreamMap(nodes: GraphNode[], edges: Array<{ source: string; target: string }>): Map<string, Set<string>> {
  const parents = new Map<string, string[]>();
  for (const edge of edges) {
    const list = parents.get(edge.target) ?? [];
    list.push(edge.source);
    parents.set(edge.target, list);
  }

  const upstream = new Map<string, Set<string>>();
  for (const node of nodes) {
    const seen = new Set<string>();
    const queue = [...(parents.get(node.id) ?? [])];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      for (const parent of parents.get(current) ?? []) {
        if (!seen.has(parent)) queue.push(parent);
      }
    }
    upstream.set(node.id, seen);
  }
  return upstream;
}

/* ------------------------------------------------------------------------ */
/* What each node PRODUCES — registry metadata + documented inferences.     */
/* ------------------------------------------------------------------------ */

/**
 * INFERENCE TABLE (produced variables). The registry does not declare outputs
 * for every node, so these are hand-written once per node type — exactly the
 * "node metadata gets hand-written once" risk the doctrine names:
 *
 *   ai.context_reply          → ai.output / ai.reply (runner stores the reply there)
 *   action.send_sms           → sentSms.* (save_conversation default reads {{sentSms.body}})
 *   chat triggers             → latestMessage (the inbound text every prompt references)
 */
const SYNTHETIC_PRODUCED_BY_TYPE: Record<string, string[]> = {
  "ai.context_reply": ["ai.output", "ai.reply", "reply", "response"],
  "action.send_sms": ["sentSms", "sms.status", "sms.body"],
  "trigger.twilio_inbound_sms": ["latestMessage", "message.text", "caller.phone", "customer.phone"],
  "trigger.twilio_missed_call": ["latestMessage", "caller.phone", "customer.phone", "call.time"],
  [TELEGRAM_NODE_TYPES.trigger]: ["latestMessage"],
  "trigger.whatsapp_message_received": ["latestMessage"]
};

/** Canonical keys of everything a node writes into the run context. */
function producedKeys(node: GraphNode): string[] {
  const def = getNodeDefinition(node.type);
  const produced: string[] = [...(def?.producedVariables ?? []), ...(SYNTHETIC_PRODUCED_BY_TYPE[node.type] ?? [])];

  // Dynamic output keys the architect can rename per node (API Call, Deepgram,
  // Output). The rename is the real contract, so it wins over the default.
  for (const key of ["apiOutputKey", "outputKey"]) {
    const value = node.config[key];
    if (typeof value === "string" && value.trim()) produced.push(value.trim());
  }
  if (node.type === API_CALL_NODE_TYPE) produced.push(API_CALL_DEFAULT_OUTPUT_KEY);

  return produced.map(canonicalPromptVariableKey).filter(Boolean);
}

/**
 * Platform-supplied context the engine injects on every run — business profile,
 * clock, system values. These are never asks: no human on the product page can
 * or should supply them.
 */
const KNOWN_CONTEXT_KEYS = new Set(KNOWN_PROMPT_VARIABLES.map((name) => canonicalPromptVariableKey(name)));
const CONTEXT_PREFIXES = ["business", "system", "workflow", "run", "current", "today", "tomorrow", "now", "timezone"];

function isPlatformContext(canonicalKey: string): boolean {
  if (KNOWN_CONTEXT_KEYS.has(canonicalKey)) return true;
  return CONTEXT_PREFIXES.some((prefix) => canonicalKey.startsWith(prefix));
}

/* ------------------------------------------------------------------------ */
/* Ask kind inference.                                                       */
/* ------------------------------------------------------------------------ */

/**
 * INFERENCE TABLE (ask kinds). The registry stores no field types, so the kind
 * is inferred from the semantic name, checked in this order (first match wins):
 *
 *   override  smsTo/recipient → phone, gmailTo → email    (known key names)
 *   choice    an explicit `<key>Choices` / `<key>Options` string list on the node
 *   email     …email…
 *   phone     …phone… / …mobile… / …cell…                 (NOT "tel" — telegram)
 *   url       …url… / …link… / …website… / …webhook… / …endpoint…
 *   file      …file… / …image… / …photo… / …audio… / …video… / …document… /
 *             …upload… / …attachment… / …media…
 *   date      …date… / …time… / …slot… / …schedule… / …deadline… / …birthday…
 *             (unless …zone… — timezones are text)
 *   number    …count… / …quantity… / …qty… / …amount… / …price… / …budget… /
 *             …latitude… / …longitude… / …minutes… / …hours… / …days… / …tokens… / …limit…
 *   longtext  …prompt… / …message… / …body… / …description… / …notes… /
 *             …instruction… / …question… / …text… / …content… / …summary…
 *   text      everything else
 */
const KEY_KIND_OVERRIDES: Record<string, DeclaredAskKind> = {
  smsto: "phone",
  recipient: "phone",
  gmailto: "email",
  customrecipient: "email"
};

const KIND_PATTERNS: Array<[DeclaredAskKind, RegExp]> = [
  ["email", /email/],
  ["phone", /phone|mobile|cell/],
  ["url", /url|link|website|webhook|endpoint/],
  ["file", /file|image|photo|picture|audio|video|document|upload|attachment|media/],
  ["date", /date|time|slot|schedule|deadline|birthday/],
  ["number", /count|quantity|qty|amount|price|budget|latitude|longitude|minutes|hours|days|tokens|limit/],
  ["longtext", /prompt|message|body|description|notes|instruction|question|text|content|summary/]
];

function inferKind(canonicalKey: string): DeclaredAskKind {
  const override = KEY_KIND_OVERRIDES[canonicalKey];
  if (override) return override;
  for (const [kind, pattern] of KIND_PATTERNS) {
    if (kind === "date" && /zone/.test(canonicalKey)) continue;
    if (pattern.test(canonicalKey)) return kind;
  }
  return "text";
}

/** An explicit option list the architect put on the node (e.g. serviceChoices). */
function explicitChoices(config: Record<string, unknown>, canonicalKey: string): string[] | undefined {
  for (const [key, value] of Object.entries(config)) {
    const ck = canonicalPromptVariableKey(key);
    if (ck !== `${canonicalKey}choices` && ck !== `${canonicalKey}options`) continue;
    if (!Array.isArray(value)) continue;
    const list = value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (typeof item === "object" && item !== null) {
          const record = item as Record<string, unknown>;
          return String(record.label ?? record.value ?? "").trim();
        }
        return "";
      })
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  return undefined;
}

/* ------------------------------------------------------------------------ */
/* Labels.                                                                   */
/* ------------------------------------------------------------------------ */

const LABEL_PREFIX_WORDS = new Set(["telegram", "gmail", "whatsapp", "sms", "api", "calendly", "vapi", "twilio", "input", "user"]);
const LABEL_SPECIAL_WORDS: Record<string, string> = { url: "URL", id: "ID", sms: "SMS", api: "API" };

/** "input.city" → "City", "telegramMessageText" → "Message text". */
function humanizeName(raw: string): string {
  const words = raw
    .replace(/[._\-{}]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LABEL_PREFIX_WORDS.has(words[0])) words.shift();
  if (words.length === 0) return "Value";
  const mapped = words.map((word) => LABEL_SPECIAL_WORDS[word] ?? word);
  const first = LABEL_SPECIAL_WORDS[words[0]] ?? mapped[0].charAt(0).toUpperCase() + mapped[0].slice(1);
  return [first, ...mapped.slice(1)].join(" ");
}

/** Dedupe id: canonical name, with the "input"/"user" wrapper stripped so
 *  {{city}} and {{input.city}} land on the SAME ask. */
function askId(rawName: string): string {
  const canonical = canonicalPromptVariableKey(rawName);
  for (const prefix of ["input", "user"]) {
    if (canonical.startsWith(prefix) && canonical.length - prefix.length >= 3) {
      return canonical.slice(prefix.length);
    }
  }
  return canonical;
}

/* ------------------------------------------------------------------------ */
/* Block satisfaction — existing on-canvas answers.                          */
/* ------------------------------------------------------------------------ */

/**
 * THE GUESSING GAME, REPLACED BY THE DECLARED DOOR.
 *
 * The Prompt Box declares what it gives — `text` — in the node registry, and
 * docs/NODE-SOP.md says a door that is not written down is not a door.
 *
 * This was that door being guessed at. Eight hard-coded words, and what a
 * customer typed reached a node only if that node happened to ask for one of
 * them. An architect who called their input `userQuestion` got silence, with no
 * warning anywhere on the canvas.
 *
 * The list is now the registry's own answer, read once. The old eight stay
 * alongside it as names already saved on live canvases — they are aliases for
 * one declared door now, not a door of their own — and adding a ninth is no
 * longer how a node gets the customer's words. Declaring it is.
 */
const DECLARED_PROMPT_OUTPUTS =
  getNodeDefinition(BLOCK_NODE_TYPES.promptComposer)?.producedVariables ?? [];

const PROMPT_LIKE_IDS = new Set([
  ...DECLARED_PROMPT_OUTPUTS.map((key) => key.toLowerCase()),
  // Names architects already saved before the door was written down. Kept so
  // no existing canvas silently stops working; nothing new is added here.
  "latestmessage",
  "prompt",
  "message",
  "input",
  "query",
  "question",
  "request"
]);
const MODEL_LIKE_IDS = new Set(["model", "aimodel"]);
const PRESET_LIKE_IDS = new Set(["preset", "style"]);

/**
 * Blocks are placed, not wired — their canvas presence alone is their meaning
 * (same rule as workflow-graph.ts) — so satisfaction is canvas-wide.
 */
function blockSatisfying(blocks: GraphNode[], id: string): GraphNode | undefined {
  return blocks.find((block) => {
    if (block.type === BLOCK_NODE_TYPES.promptComposer) return PROMPT_LIKE_IDS.has(id);
    if (block.type === BLOCK_NODE_TYPES.modelPicker) return MODEL_LIKE_IDS.has(id);
    if (block.type === BLOCK_NODE_TYPES.presetGallery) return PRESET_LIKE_IDS.has(id);
    return false;
  });
}

/* ------------------------------------------------------------------------ */
/* deriveDeclarations                                                        */
/* ------------------------------------------------------------------------ */

export function deriveDeclarations(workflowJson: unknown): WorkflowDeclarations {
  const { nodes, edges } = readGraph(workflowJson);
  const upstream = buildUpstreamMap(nodes, edges);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const blocks = nodes.filter((node) => isBlockNodeType(node.type));
  const engineNodes = nodes.filter((node) => !isBlockNodeType(node.type));

  const producedByNode = new Map<string, string[]>();
  for (const node of nodes) producedByNode.set(node.id, producedKeys(node));

  /** The upstream node whose output covers this variable, if any. */
  const upstreamProducer = (nodeId: string, canonicalKey: string): GraphNode | undefined => {
    for (const ancestorId of upstream.get(nodeId) ?? []) {
      const produced = producedByNode.get(ancestorId) ?? [];
      // Prefix match so {{api.response.main.temp}} is covered by "api.response".
      if (produced.some((key) => canonicalKey === key || canonicalKey.startsWith(key))) {
        return nodeById.get(ancestorId);
      }
    }
    return undefined;
  };

  // -- Asks -----------------------------------------------------------------
  const asks = new Map<string, DeclaredAsk>();

  const addAsk = (
    node: GraphNode,
    rawName: string,
    opts: { dependsOnNodeId?: string } = {}
  ) => {
    const id = askId(rawName);
    if (!id) return;
    const kind = inferKind(id);
    const choices = explicitChoices(node.config, id);
    const satisfier = blockSatisfying(blocks, id);
    // A Model Picker's own options double as the ask's choice list.
    const blockChoices = satisfier ? explicitChoices({ options: satisfier.config.options, choices: satisfier.config.choices }, "") : undefined;

    const existing = asks.get(id);
    if (existing) {
      if (!existing.nodeIds.includes(node.id)) existing.nodeIds.push(node.id);
      // A specific kind learned from any node beats the "text" fallback.
      if (existing.kind === "text" && kind !== "text") existing.kind = kind;
      if (!existing.choices && (choices || blockChoices)) {
        existing.choices = choices ?? blockChoices;
        existing.kind = "choice";
      }
      if (!existing.dependsOnNodeId && opts.dependsOnNodeId) existing.dependsOnNodeId = opts.dependsOnNodeId;
      return;
    }

    const ask: DeclaredAsk = {
      id,
      nodeIds: [node.id],
      label: humanizeName(rawName),
      kind: choices || blockChoices ? "choice" : kind,
      required: true
    };
    const choiceList = choices ?? blockChoices;
    if (choiceList) ask.choices = choiceList;
    if (opts.dependsOnNodeId) ask.dependsOnNodeId = opts.dependsOnNodeId;
    if (satisfier) ask.satisfiedByNodeId = satisfier.id;
    asks.set(id, ask);
  };

  for (const node of engineNodes) {
    const def = getNodeDefinition(node.type);

    // 1. Required config the architect left empty — a hole someone must fill.
    for (const key of def?.requiredConfig ?? []) {
      const value = node.config[key];
      if (typeof value === "string" ? value.trim() === "" : value === undefined || value === null) {
        addAsk(node, key);
      }
    }

    // 2. Template holes in config strings — {{vars}} no upstream node supplies.
    //    This is where the real holes live (API Call URLs/bodies/headers,
    //    prompts, message templates).
    const stringValues: string[] = [];
    for (const value of Object.values(node.config)) {
      if (typeof value === "string") stringValues.push(value);
      else if (Array.isArray(value)) {
        for (const item of value) if (typeof item === "string") stringValues.push(item);
      }
    }
    for (const text of stringValues) {
      const variables = extractPromptVariables(text);
      if (variables.length === 0) continue;

      const unsatisfied: string[] = [];
      let producerInSameString: GraphNode | undefined;
      for (const variable of variables) {
        const canonical = canonicalPromptVariableKey(variable);
        if (isPlatformContext(canonical)) continue;
        const producer = upstreamProducer(node.id, canonical);
        if (producer) {
          // Remember the producer: any human hole in the SAME string only
          // makes sense after that node ran (step-splitting).
          if (!producerInSameString) producerInSameString = producer;
          continue;
        }
        unsatisfied.push(variable);
      }
      for (const variable of unsatisfied) {
        addAsk(node, variable, producerInSameString ? { dependsOnNodeId: producerInSameString.id } : {});
      }
    }

    // 3. Registry-declared required variables not covered by any ancestor.
    for (const variable of def?.requiredVariables ?? []) {
      const canonical = canonicalPromptVariableKey(variable);
      if (isPlatformContext(canonical)) continue;
      if (upstreamProducer(node.id, canonical)) continue;
      addAsk(node, variable);
    }
  }

  // -- Shows ----------------------------------------------------------------
  const shows: DeclaredShow[] = [];
  const outputStages = blocks.filter((block) => block.type === BLOCK_NODE_TYPES.outputStage);
  const firstStageId = outputStages[0]?.id;

  const chatTriggerTypes = new Set([
    TELEGRAM_NODE_TYPES.trigger,
    "trigger.whatsapp_message_received",
    "trigger.twilio_inbound_sms",
    "trigger.twilio_missed_call"
  ]);
  const hasChatTrigger = engineNodes.some((node) => chatTriggerTypes.has(node.type));

  // Result Viewer blocks are themselves shows — already placed, so satisfied.
  for (const stage of outputStages) {
    const configured = String(stage.config.kind ?? "").toLowerCase();
    const kind: DeclaredShowKind =
      configured === "image" ? "image" : configured === "video" || configured === "audio" || configured === "media" ? "media" : configured === "text" ? "text" : "visual";
    shows.push({ nodeId: stage.id, kind, label: stage.label || "Result", satisfiedByNodeId: stage.id });
  }

  // Engine outputs at the ends of the graph. An edge into a block is not an
  // engine continuation, so a brain wired only into a Result Viewer is an end.
  const hasEngineSuccessor = (nodeId: string): boolean =>
    edges.some((edge) => {
      if (edge.source !== nodeId) return false;
      const target = nodeById.get(edge.target);
      return Boolean(target && !isBlockNodeType(target.type));
    });

  const isTtsNode = (node: GraphNode): boolean =>
    node.type === DEEPGRAM_NODE_TYPES.tts ||
    (node.type === DEEPGRAM_NODE_TYPES.speech && String(node.config.mode ?? "") === "tts");

  const showKindForEndNode = (node: GraphNode): DeclaredShowKind | null => {
    const def = getNodeDefinition(node.type);
    const kind = def?.runtime.nodeKind;
    if (kind === "trigger" || kind === "condition" || kind === "block") return null;

    if (node.type === "ai.image_generation") return "image";
    if (isTtsNode(node)) return "media";
    if (node.type === "ai.context_reply") return hasChatTrigger ? "conversation" : "text";
    if (node.type === VOICE_NODE_TYPES.voiceConversation) return "conversation";
    if (node.type === "output.result") {
      // The Output node relays whatever fed it, so its face is its feeder's.
      const feeders = edges.filter((edge) => edge.target === node.id).map((edge) => nodeById.get(edge.source));
      for (const feeder of feeders) {
        if (!feeder) continue;
        if (feeder.type === "ai.image_generation") return "image";
        if (isTtsNode(feeder)) return "media";
        if (feeder.type === API_CALL_NODE_TYPE) return "visual";
      }
      return feeders.some((feeder) => feeder && getNodeDefinition(feeder.type)?.runtime.nodeKind === "ai") ? "text" : "visual";
    }
    // Sends, saves, handoffs, end-of-flow: the customer sees "done", not data.
    if (
      /^(action|communication)\.send_/.test(node.type) ||
      node.type.startsWith("action.telegram_send") ||
      node.type === "integration.gmail_send_email" ||
      node.type === VOICE_NODE_TYPES.sendEmail ||
      node.type === VOICE_NODE_TYPES.sendSms ||
      node.type === VOICE_NODE_TYPES.endFlow ||
      node.type === "action.save_lead" ||
      node.type === "action.human_handoff"
    ) {
      return "confirmation";
    }
    if (kind === "ai") return "text";
    if (kind === "output") return "text";
    return "visual";
  };

  for (const node of engineNodes) {
    if (hasEngineSuccessor(node.id)) continue;
    const kind = showKindForEndNode(node);
    if (!kind) continue;
    const def = getNodeDefinition(node.type);
    shows.push({
      nodeId: node.id,
      kind,
      label: node.label || def?.label || node.type,
      // An existing Result Viewer renders engine results — reuse it.
      ...(firstStageId ? { satisfiedByNodeId: firstStageId } : {})
    });
  }

  // -- Shape ----------------------------------------------------------------
  const voiceTypes = new Set([
    VOICE_NODE_TYPES.phoneCallTrigger,
    VOICE_NODE_TYPES.voiceConversation,
    "trigger.vapi_tool_call",
    "action.start_vapi_call"
  ]);
  const hasVoice = engineNodes.some((node) => voiceTypes.has(node.type));
  const hasGeneration =
    engineNodes.some((node) => node.type === "ai.image_generation" || isTtsNode(node)) ||
    outputStages.some((stage) => ["image", "video", "media", "audio"].includes(String(stage.config.kind ?? "").toLowerCase())) ||
    blocks.some((block) => block.type === BLOCK_NODE_TYPES.presetGallery);
  // A History Shelf on the canvas means the architect built an ongoing
  // conversation product, whatever the trigger is.
  const hasConversation =
    hasChatTrigger ||
    shows.some((show) => show.kind === "conversation") ||
    blocks.some((block) => block.type === BLOCK_NODE_TYPES.historyShelf);
  const hasScreenBlocks = blocks.some((block) => block.type === BLOCK_NODE_TYPES.promptComposer);

  let shape: ProductShape;
  if (hasVoice) {
    // A phone product's face may be just a number — but generation output or an
    // on-page prompt box means it is also a screen product.
    shape = hasGeneration || hasScreenBlocks ? "hybrid" : "voice";
  } else if (hasConversation && hasGeneration) {
    shape = "hybrid";
  } else if (hasConversation) {
    shape = "conversation";
  } else if (hasGeneration) {
    shape = "generation";
  } else {
    shape = "form";
  }

  // -- Internal vs human asks ----------------------------------------------
  // The customer's own words are collected when a latestMessage-style ask
  // exists or a Prompt Box block is on the canvas. Once that is true, template
  // holes on door-enabled engine nodes are the DOORS' job to fill (that is
  // what the entry doors are for) — asking a human for "channel id" or
  // "latitude" next to a working message box is how a product looks broken.
  const askList = Array.from(asks.values());
  const customerWordsCollected =
    askList.some((ask) => PROMPT_LIKE_IDS.has(ask.id)) ||
    blocks.some((block) => block.type === BLOCK_NODE_TYPES.promptComposer);

  const isInternal = (ask: DeclaredAsk): boolean => {
    // A step-split ask (dependsOnNodeId) can still be a real human question —
    // "answer this follow-up" — so it is NOT internal by itself. The doors
    // rule below is what catches produced-value holes like latitude.
    if (PROMPT_LIKE_IDS.has(ask.id)) return false;
    if (!customerWordsCollected) return false;
    // Every node needing this value has its doors on → the doors derive it
    // from the customer's words and the run so far.
    return ask.nodeIds.every((nodeId) => {
      const node = nodeById.get(nodeId);
      return node ? nodeDoorsEnabled({ doorsDisabled: node.doorsDisabled }) : false;
    });
  };

  const humanAsks: DeclaredAsk[] = [];
  const internalAsks: DeclaredAsk[] = [];
  for (const ask of askList) (isInternal(ask) ? internalAsks : humanAsks).push(ask);

  // -- Existing interactive blocks: one control each, always ----------------
  const controls: DeclaredControl[] = [];
  for (const block of blocks) {
    if (block.type === BLOCK_NODE_TYPES.promptComposer) {
      controls.push({
        nodeId: block.id,
        role: "input",
        label: String(block.config.placeholder ?? block.label ?? "Your message")
      });
    } else if (block.type === BLOCK_NODE_TYPES.modelPicker || block.type === BLOCK_NODE_TYPES.presetGallery) {
      const options = explicitChoices(
        { options: block.config.options, choices: block.config.choices, presets: block.config.presets },
        ""
      );
      controls.push({
        nodeId: block.id,
        role: "choice",
        label: String(block.label ?? (block.type === BLOCK_NODE_TYPES.presetGallery ? "Style" : "Model")),
        ...(options ? { choices: options } : {})
      });
    } else if (block.type === BLOCK_NODE_TYPES.actionButton) {
      controls.push({
        nodeId: block.id,
        role: "action",
        label: String(block.config.label ?? block.label ?? "Run")
      });
    }
  }

  return { asks: humanAsks, internalAsks, shows, controls, shape };
}
