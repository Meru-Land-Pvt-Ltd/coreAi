/**
 * The Product Spec renderer — public surface.
 *
 * Import from here, not from the individual files: the split between
 * `nodes/layout-nodes` and `nodes/content-nodes` is an implementation detail,
 * and the wired-node fleet only needs `SpecRenderer`, `SpecNodes`, the shell
 * helpers and the tokens.
 */

export {
  SpecRenderer,
  SpecNodeView,
  SpecNodes,
  useSpecRuntime,
  groupPageBands,
  paintsSomething,
  type SpecRendererProps,
  type SpecNodeRenderer,
  type SpecNodeRenderContext,
  type SpecNodesProps
} from "./spec-renderer";

export {
  buildSpecTheme,
  hexContrast,
  surfaceInk,
  textToneColor,
  type SpecTheme,
  type SpecSurface,
  type SpecMode,
  type SpecFont,
  type SurfaceInk
} from "./spec-theme";

export {
  nodeShell,
  childAlign,
  childSurface,
  resolveNodeAlign,
  shellInk,
  type NodeShell,
  type NodeShellOptions
} from "./node-shell";

export {
  cx,
  bgToneSurface,
  styleBoxClasses,
  tonePaint,
  CARD_SHELL,
  CONTAINER,
  GRID_COLUMNS,
  GRID_GAP,
  ICON_BOX,
  ICON_PIXELS,
  IMAGE_RATIO,
  MAX_WIDTH,
  MAX_WIDTH_PLACEMENT,
  PILL_SHELL,
  ROW_GAP,
  ROW_JUSTIFY,
  SECTION_PADDING,
  SPACER_HEIGHT,
  STACK_ALIGN,
  STACK_GAP,
  TEXT_ALIGN,
  TEXT_SCALE,
  HEADING_SCALE,
  type ToneName,
  type ToneSurface
} from "./spec-tokens";

export { resolveIcon, hasIcon, normalizeIconName, ICON_NAMES, FALLBACK_ICON } from "./spec-icon";

export {
  BadgeNodeView,
  DividerNodeView,
  HeadingNodeView,
  IconNodeView,
  ImageNodeView,
  ListNodeView,
  QuoteNodeView,
  SpacerNodeView,
  StatNodeView,
  TextNodeView,
  deltaTone,
  type ContentNodeProps
} from "./nodes/content-nodes";

export {
  GridNodeView,
  ImplicitSection,
  RowNodeView,
  SectionNodeView,
  StackNodeView,
  type LayoutNodeProps
} from "./nodes/layout-nodes";

// --- The wired half: sockets into the agent's backend graph. ---------------

export {
  SpecProduct,
  specSectionRenderNode,
  useWiredNodeRenderer,
  type SpecProductProps
} from "./wired-nodes";

export { LiveProductSite, type LiveProductSiteProps } from "./live-product-site";

export {
  SpecRunProvider,
  useSpecRun,
  channelOf,
  collectActionChannels,
  collectSpecFields,
  composeSpecPrompt,
  resolveResultChannel,
  ANSWER_NOW_LINE,
  DEFAULT_CHANNEL,
  MAX_PROMPT_LENGTH,
  MAX_RETAINED_RESULTS,
  type ComposeField,
  type ComposedPrompt,
  type SpecField,
  type SpecFieldKind,
  type SpecRunContextValue,
  type SpecRunProviderProps,
  type SpecRunRequest,
  type SpecRunResult,
  type SpecRunValue
} from "./spec-run";

export {
  ButtonNodeView,
  ChoiceNodeView,
  InputNodeView,
  UploadNodeView,
  type InteractiveNodeProps
} from "./nodes/interactive-nodes";

export {
  HistoryNodeView,
  ResultNodeView,
  type OutputNodeProps
} from "./nodes/output-nodes";
