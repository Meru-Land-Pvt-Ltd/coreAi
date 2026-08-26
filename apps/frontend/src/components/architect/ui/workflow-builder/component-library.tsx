"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Clapperboard, FileText, Image as ImageIcon, MessageCircle, Phone, Sparkles } from "lucide-react";
import {
  ARCHITECT_NODE_GROUP_ORDER,
  defaultArchitectNodePresentation,
  defaultHiddenArchitectNodeTypes
} from "@coreai/shared";
import {
  deleteArchitectFrameCard,
  getArchitectBuilderNodeVisibility,
  type ArchitectBuilderConnector,
  type ArchitectBuilderNodePresentation
} from "@/components/architect/features/api";
import { libraryGroups, libraryItemType } from "./library";
import { SidebarNodeCard } from "./card/sidebar-node-card";
import type { BuilderNodeData, LibraryGroup, LibraryItem, NodeAccent, NodeKind } from "./types";

/** Re-export for canvas drop handler consumers. */
export { BUILDER_NODE_DRAG_TYPE } from "./card/sidebar-node-card";

type FaceTemplateCard = {
  slug: string;
  title: string;
  promise: string;
  Icon: typeof MessageCircle;
  /** Literal Tailwind classes (JIT needs them spelled out). */
  cardClasses: string;
  iconClasses: string;
};

/**
 * "Start with a Face" — one tap imports a fully wired, working product via the
 * same template mechanism as the Dental/Receptionist cards (slug → import).
 * Only faces whose runtime fully works today get a live card.
 */
const FACE_TEMPLATE_CARDS: FaceTemplateCard[] = [
  {
    slug: "chatbot",
    title: "Chatbot",
    promise: "A ChatGPT-style product with your knowledge",
    Icon: MessageCircle,
    cardClasses: "border-emerald-300 bg-emerald-50 hover:border-emerald-400",
    iconClasses: "text-emerald-600"
  },
  {
    slug: "voice-agent",
    title: "Voice Agent",
    promise: "Answers the phone, chats, and books appointments",
    Icon: Phone,
    cardClasses: "border-violet-300 bg-violet-50 hover:border-violet-400",
    iconClasses: "text-violet-600"
  },
  {
    slug: "image-studio",
    title: "Image Studio",
    promise: "Describe it, pick a style, get a picture",
    Icon: ImageIcon,
    cardClasses: "border-sky-300 bg-sky-50 hover:border-sky-400",
    iconClasses: "text-sky-600"
  },
  {
    slug: "form-tool",
    title: "Form Tool",
    promise: "Turns a short request into a finished report",
    Icon: FileText,
    cardClasses: "border-amber-300 bg-amber-50 hover:border-amber-400",
    iconClasses: "text-amber-600"
  }
];

/** No working engine yet — honest "Coming soon" cards with no click action. */
const FACE_COMING_SOON_CARDS: Array<Pick<FaceTemplateCard, "slug" | "title" | "promise" | "Icon">> = [
  {
    slug: "video-studio",
    title: "Video Studio",
    promise: "Clips made from a written idea",
    Icon: Clapperboard
  },
  {
    slug: "monitor",
    title: "Monitor",
    promise: "Watches things for you and reports back",
    Icon: Activity
  }
];

/**
 * Turn each connector's own declaration into a card in the Hands group.
 *
 * The node type is namespaced with the connector id so two connectors can
 * never collide, and `connectorId` is what the engine dispatches on at run
 * time — a step placed from here runs through the one connector engine, with
 * its retries, its ceiling and its honesty check already applied.
 */
function withConnectors(groups: LibraryGroup[], connectors: ArchitectBuilderConnector[]): LibraryGroup[] {
  if (connectors.length === 0) return groups;

  const toItem = (connector: ArchitectBuilderConnector): LibraryItem => ({
    nodeKind: "connector" as NodeKind,
    // The card is one line of about twelve characters. The full name lives on
    // the node itself and in the hover tooltip.
    label: connector.shortLabel || connector.label,
    helper: connector.description,
    // The same icon the API Call and Webhook cards use — a connector is a
    // step that reaches out to another service, and it should read as one.
    icon: "globe",
    accent: "amber" as NodeAccent,
    testId: `node-connector-${connector.id.replace(/[^a-z0-9]+/gi, "-")}`,
    overrides: {
      type: `connector.${connector.id}`,
      nodeKind: "connector",
      connectorId: connector.id,
      connector: connector.provider,
      kind: connector.provider.toUpperCase(),
      title: connector.label,
      subtitle: connector.description
    }
  });

  /* THE FIFTH SHELF (founder, 2026-08-26). Every card that reaches an outside
     service — Apollo and Instantly as much as the ones an architect built
     this morning — is the same species: a described connection, not one of
     the four Elements. They all live here together, and only the
     architect's own carry a delete. */
  const items: LibraryItem[] = connectors.map((connector) =>
    connector.mine ? { ...toItem(connector), deletableFrameId: connector.id } : toItem(connector)
  );

  return items.length > 0
    ? [...groups, { title: "Custom nodes", subtitle: "Connections to outside services", items }]
    : groups;
}

function applyAdminPresentation(
  groups: LibraryGroup[],
  nodes: ArchitectBuilderNodePresentation[],
  hiddenNodeTypes: string[],
  searchTerm: string
): LibraryGroup[] {
  const byType = new Map(nodes.map((node) => [node.type, node]));
  const hidden = new Set(
    nodes.length > 0 ? nodes.filter((node) => !node.visible).map((node) => node.type) : hiddenNodeTypes
  );
  const query = searchTerm.trim().toLowerCase();
  const subtitles = new Map(groups.map((group) => [group.title, group.subtitle]));
  const buckets = new Map<string, LibraryItem[]>();

  for (const group of groups) {
    for (const item of group.items) {
      const type = libraryItemType(item);
      if (type && hidden.has(type)) continue;
      const presentation = type ? byType.get(type) : undefined;
      const label =
        presentation && presentation.label !== presentation.defaultLabel ? presentation.label : item.label;
      const groupTitle =
        presentation && presentation.group !== presentation.defaultGroup ? presentation.group : group.title;
      if (
        query &&
        !label.toLowerCase().includes(query) &&
        !item.helper.toLowerCase().includes(query) &&
        !groupTitle.toLowerCase().includes(query)
      ) {
        continue;
      }
      const next: LibraryItem =
        label !== item.label
          ? { ...item, label, overrides: { ...item.overrides, title: label } }
          : item;
      const list = buckets.get(groupTitle) ?? [];
      list.push(next);
      buckets.set(groupTitle, list);
    }
  }

  const extra = [...buckets.keys()].filter((title) => !ARCHITECT_NODE_GROUP_ORDER.includes(title));
  return [...ARCHITECT_NODE_GROUP_ORDER, ...extra]
    .filter((title) => (buckets.get(title)?.length ?? 0) > 0)
    .map((title) => ({ title, subtitle: subtitles.get(title), items: buckets.get(title) ?? [] }));
}

export function ComponentLibrary({
  searchTerm,
  onSearchChange,
  onUseTemplate,
  onAddNode
}: {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onUseTemplate: (slug: string) => void;
  onAddNode: (nodeKind: NodeKind, overrides?: Partial<BuilderNodeData>) => void;
}) {
  const [hiddenNodeTypes, setHiddenNodeTypes] = useState<string[]>(() => defaultHiddenArchitectNodeTypes());
  const [nodes, setNodes] = useState<ArchitectBuilderNodePresentation[]>(() => defaultArchitectNodePresentation());
  const [connectors, setConnectors] = useState<ArchitectBuilderConnector[]>([]);

  useEffect(() => {
    let cancelled = false;
    void getArchitectBuilderNodeVisibility().then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) return;
      if (result.data.hiddenNodeTypes) setHiddenNodeTypes(result.data.hiddenNodeTypes);
      if (result.data.nodes) setNodes(result.data.nodes);
      if (result.data.connectors) setConnectors(result.data.connectors);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The library, with every registered connector added to Hands.
   *
   * This is what a connector file buys: no card is written here, no icon is
   * chosen here, and no edit happens here when the next one ships. The
   * connector described itself, and the sidebar read the description.
   */
  const groups = useMemo(() => withConnectors(libraryGroups, connectors), [connectors]);

  const filteredGroups = useMemo(
    () => applyAdminPresentation(groups, nodes, hiddenNodeTypes, searchTerm),
    [groups, hiddenNodeTypes, nodes, searchTerm]
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-white">
      <div className="px-4 pt-4">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </span>
          <input data-testid="component-library-search-components-input"
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search components..."
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
      </div>

      <div className="builder-sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4">
        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <div key={group.title}>
              <p
                className={`${group.subtitle ? "mb-0.5" : "mb-2"} text-xs font-bold uppercase tracking-wider text-slate-400`}
                data-testid="architect-ui-workflow-builder-component-library-group-title-text"
              >
                {group.title}
              </p>
              {group.subtitle ? (
                <p
                  className="mb-2 text-[11px] text-slate-500"
                  data-testid="architect-ui-workflow-builder-component-library-group-subtitle-text"
                >
                  {group.subtitle}
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-2">
                {group.items.map((item) => (
                  <SidebarNodeCard
                    key={`${group.title}-${item.label}`}
                    item={item}
                    onAddNode={onAddNode}
                    onDeleteFrame={(frameId) => {
                      void deleteArchitectFrameCard(frameId).then((result) => {
                        if (result.success) {
                          setConnectors((current) => current.filter((entry) => entry.id !== frameId));
                        }
                      });
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* The founder's order (2026-08-26): templates live BELOW the nodes —
            the palette leads with the pieces, the ready-made faces close it. */}
        {/* One set: the two existing industry cards stay first and unchanged,
            the generic faces follow, coming-soon faces close the list. */}
        <p
          className="mb-0.5 text-xs font-bold uppercase tracking-wider text-slate-400"
          data-testid="face-template-section-title"
        >
          Start with a Face
        </p>
        <p className="mb-2 text-[11px] text-slate-500" data-testid="face-template-section-subtitle">
          One tap builds a working product you can restyle
        </p>
        {/* The founder's order (2026-08-26): the faces wear the same square
            card as every node, two to a row — a wall of wide rectangles at
            the end of the palette pulled the eye away from the work. */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onUseTemplate("dental-ai-receptionist")}
            data-testid="library-template-ai-receptionist"
            className="h-[78px] w-full overflow-hidden rounded-2xl border border-violet-200 bg-violet-50 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <span className="flex h-full w-full flex-col justify-center gap-2">
              <span className="flex items-center gap-1.5">
                <Sparkles className="h-5 w-5 shrink-0 text-violet-600" aria-hidden="true" />
                <span className="inline-flex h-[18px] items-center rounded-full bg-neutral-900 px-2 text-[9px] font-bold uppercase tracking-wide text-white">
                  Latest
                </span>
              </span>
              <span
                className="block truncate text-[12px] font-bold leading-5 text-violet-900"
                data-testid="architect-ui-workflow-builder-component-library-dental-text"
              >
                Dental Receptionist
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => onUseTemplate("missed-call-text-back")}
            data-testid="library-template-missed-call"
            className="h-[78px] w-full overflow-hidden rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]"
          >
            <span className="flex h-full w-full flex-col justify-center gap-2">
              <Phone className="h-5 w-5 shrink-0 text-amber-600" aria-hidden="true" />
              <span
                className="block truncate text-[12px] font-bold leading-5 text-amber-900"
                data-testid="architect-ui-workflow-builder-component-library-missed-call-text"
              >
                AI Receptionist
              </span>
            </span>
          </button>

          {FACE_TEMPLATE_CARDS.map((card) => (
            <button
              key={card.slug}
              type="button"
              onClick={() => onUseTemplate(card.slug)}
              data-testid={`face-template-${card.slug}`}
              title={`${card.title} — ${card.promise}`}
              className={`h-[78px] w-full overflow-hidden rounded-2xl border px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] ${card.cardClasses}`}
            >
              <span className="flex h-full w-full flex-col justify-center gap-2">
                <card.Icon className={`h-5 w-5 shrink-0 ${card.iconClasses}`} aria-hidden="true" />
                <span className="block truncate text-[12px] font-bold leading-5 text-slate-800">
                  {card.title}
                </span>
              </span>
            </button>
          ))}

          {FACE_COMING_SOON_CARDS.map((card) => (
            <div
              key={card.slug}
              aria-disabled="true"
              data-testid={`face-template-${card.slug}`}
              title={`${card.title} — coming soon`}
              className="h-[78px] w-full cursor-not-allowed select-none overflow-hidden rounded-2xl bg-slate-100 px-3 py-2.5 text-left opacity-80 grayscale"
            >
              <span className="flex h-full w-full flex-col justify-center gap-2">
                <span className="flex items-center gap-1.5">
                  <card.Icon className="h-5 w-5 shrink-0 text-slate-400" aria-hidden="true" />
                  <span className="inline-flex h-[18px] items-center rounded-md bg-slate-200 px-2 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                    Soon
                  </span>
                </span>
                <span className="block truncate text-[12px] font-bold leading-5 text-slate-500">
                  {card.title}
                </span>
              </span>
            </div>
          ))}
        </div>

        {/* Coming Soon nodes and their section are intentionally hidden. */}
      </div>
    </div>
  );
}
