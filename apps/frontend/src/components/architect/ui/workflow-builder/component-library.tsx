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
import { isParkedNodeType } from "@coreai/shared";
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
  const groupsOut = [...ARCHITECT_NODE_GROUP_ORDER, ...extra]
    .filter((title) => (buckets.get(title)?.length ?? 0) > 0)
    .map((title) => ({ title, subtitle: subtitles.get(title), items: buckets.get(title) ?? [] }));

  /* THE PARKED SHELF (the founder's ruling, 2026-08-26): sleepers do not sit
     between working cards — they gather on one grey shelf at the bottom, so
     the working shelves read clean and the parked read honest. */
  const parked: LibraryItem[] = [];
  const working = groupsOut
    .map((group) => {
      const keep = group.items.filter((item) => {
        const type = libraryItemType(item);
        if (type && isParkedNodeType(type)) {
          parked.push(item);
          return false;
        }
        return true;
      });
      return { ...group, items: keep };
    })
    .filter((group) => group.items.length > 0);

  return parked.length > 0
    ? [...working, { title: "Parked", subtitle: "Asleep, not gone — each says why", items: parked }]
    : working;
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

        {/* The ready-made faces are gone (the founder's ruling, 2026-08-26):
            templates were training wheels from before the book — the Builder
            generates products on demand now, and a shelf of pre-built faces
            taught assembly in a palette whose law is generation. */}

        {/* Coming Soon nodes and their section are intentionally hidden. */}
      </div>
    </div>
  );
}
