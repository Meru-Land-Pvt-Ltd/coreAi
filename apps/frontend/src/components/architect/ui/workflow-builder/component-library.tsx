"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, Clapperboard, FileText, Image as ImageIcon, MessageCircle, Phone } from "lucide-react";
import {
  ARCHITECT_NODE_GROUP_ORDER,
  defaultArchitectNodePresentation,
  defaultHiddenArchitectNodeTypes
} from "@coreai/shared";
import {
  getArchitectBuilderNodeVisibility,
  type ArchitectBuilderNodePresentation
} from "@/components/architect/features/api";
import { libraryGroups, libraryItemType } from "./library";
import { SidebarNodeCard } from "./card/sidebar-node-card";
import type { BuilderNodeData, LibraryGroup, LibraryItem, NodeKind } from "./types";

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

  useEffect(() => {
    let cancelled = false;
    void getArchitectBuilderNodeVisibility().then((result) => {
      if (cancelled) return;
      if (!result.success || !result.data) return;
      if (result.data.hiddenNodeTypes) setHiddenNodeTypes(result.data.hiddenNodeTypes);
      if (result.data.nodes) setNodes(result.data.nodes);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredGroups = useMemo(
    () => applyAdminPresentation(libraryGroups, nodes, hiddenNodeTypes, searchTerm),
    [hiddenNodeTypes, nodes, searchTerm]
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
        <button
          type="button"
          onClick={() => onUseTemplate("dental-ai-receptionist")}
          data-testid="library-template-ai-receptionist"
          className="mb-3 w-full rounded-xl border-2 border-violet-300 bg-violet-50 px-3 py-2 text-left transition hover:border-violet-400"
        >
          <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="block min-w-0 text-xs font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-dental-text">Dental AI Receptionist</span>
            <span className="inline-flex h-5.5 shrink-0 items-center rounded-md bg-violet-600 px-2.5 text-[11px] font-semibold text-white" data-testid="architect-ui-workflow-builder-component-library-dental-badge rounded-md">Recommended · Latest</span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500" data-testid="architect-ui-workflow-builder-component-library-dental-helper-text">6 voice steps: call → AI → calendar → book → SMS → end</span>
        </button>
        <button
          type="button"
          onClick={() => onUseTemplate("missed-call-text-back")}
          data-testid="library-template-missed-call"
          className="mb-3 w-full rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-left transition hover:border-amber-400"
        >
          <span className="block text-xs font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-missed-call-text">AI Receptionist Template</span>
          <span className="mt-0.5 block text-[11px] text-slate-500" data-testid="architect-ui-workflow-builder-component-library-load-exact-flow-text">Import the 3-step flow</span>
        </button>

        {FACE_TEMPLATE_CARDS.map((card) => (
          <button
            key={card.slug}
            type="button"
            onClick={() => onUseTemplate(card.slug)}
            data-testid={`face-template-${card.slug}`}
            className={`mb-3 w-full rounded-xl border-2 px-3 py-2 text-left transition ${card.cardClasses}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <card.Icon className={`h-4 w-4 shrink-0 ${card.iconClasses}`} aria-hidden="true" />
              <span className="block min-w-0 text-xs font-semibold text-slate-900">{card.title}</span>
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{card.promise}</span>
          </button>
        ))}

        {FACE_COMING_SOON_CARDS.map((card) => (
          <div
            key={card.slug}
            aria-disabled="true"
            data-testid={`face-template-${card.slug}`}
            className="mb-3 w-full cursor-default select-none rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-left opacity-70"
          >
            <span className="flex min-w-0 items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <card.Icon className="h-4 w-4 shrink-0 text-slate-400" aria-hidden="true" />
                <span className="block min-w-0 text-xs font-semibold text-slate-500">{card.title}</span>
              </span>
              <span className="inline-flex shrink-0 items-center rounded-md bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                Coming soon
              </span>
            </span>
            <span className="mt-0.5 block text-[11px] leading-snug text-slate-400">{card.promise}</span>
          </div>
        ))}

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
                  />
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Coming Soon nodes and their section are intentionally hidden. */}
      </div>
    </div>
  );
}
