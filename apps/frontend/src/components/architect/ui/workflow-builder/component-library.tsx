import { cn } from "@/components/architect/ui/architect-ui";
import { ChevronRight } from "lucide-react";
import { accentStyles } from "./accent-styles";
import { libraryGroups } from "./library";
import { BuilderIcon } from "./icons";
import type { BuilderNodeData, NodeKind } from "./types";

/** dataTransfer key shared with the canvas drop handler. */
export const BUILDER_NODE_DRAG_TYPE = "application/x-triven-builder-node";

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
  const query = searchTerm.trim().toLowerCase();
  const filteredGroups = !query
    ? libraryGroups
    : libraryGroups
        .map((group) => ({
          ...group,
          items: group.items.filter(
            (item) => item.label.toLowerCase().includes(query) || item.helper.toLowerCase().includes(query)
          )
        }))
        .filter((group) => group.items.length > 0);

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

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pb-6 pt-4">
        <button
          type="button"
          onClick={() => onUseTemplate("dental-ai-receptionist")}
          data-testid="library-template-ai-receptionist"
          className="mb-3 w-full rounded-xl border-2 border-violet-300 bg-violet-50 px-3 py-2 text-left transition hover:border-violet-400"
        >
          <span className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <span className="block min-w-0 text-xs font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-dental-text">Dental AI Receptionist</span>
            <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" data-testid="architect-ui-workflow-builder-component-library-dental-badge">Recommended · Latest</span>
          </span>
          <span className="mt-0.5 block text-[11px] leading-snug text-slate-500" data-testid="architect-ui-workflow-builder-component-library-dental-helper-text">6 voice nodes: call → AI → calendar → book → SMS → end</span>
        </button>
        <button
          type="button"
          onClick={() => onUseTemplate("missed-call-text-back")}
          data-testid="library-template-missed-call"
          className="mb-3 w-full rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-left transition hover:border-amber-400"
        >
          <span className="block text-xs font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-missed-call-text">AI Receptionist Template</span>
          <span className="mt-0.5 block text-[11px] text-slate-500" data-testid="architect-ui-workflow-builder-component-library-load-exact-flow-text">Import the 3-node flow</span>
        </button>

        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-component-library-group-title-text">{group.title}</p>
              <div className="grid grid-cols-2 gap-2.5">
                {group.items.map((item) => {
                  const styles = accentStyles[item.accent];
                  return (
                    <button
                      key={`${group.title}-${item.label}`}
                      data-testid={item.testId}
                      type="button"
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(
                          BUILDER_NODE_DRAG_TYPE,
                          JSON.stringify({
                            nodeKind: item.nodeKind,
                            overrides: { ...item.overrides, accent: item.accent, icon: item.icon }
                          })
                        );
                      }}
                      onClick={() => onAddNode(item.nodeKind, { ...item.overrides, accent: item.accent, icon: item.icon })}
                      title={`${item.label}: ${item.helper}`}
                      className={cn(
                        "comp group flex h-[102px] w-full cursor-grab flex-col justify-between overflow-hidden rounded-lg border p-3 text-left transition active:cursor-grabbing hover:-translate-y-0.5 hover:bg-white hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2",
                        styles.border,
                        styles.subtle
                      )}
                    >
                      <span className={cn("flex w-full items-start justify-between gap-2", styles.text)}>
                        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-white/80 shadow-sm ring-1 ring-black/5">
                          <BuilderIcon name={item.icon} className="h-[18px] w-[18px]" />
                        </span>
                        <ChevronRight className="mt-1 h-4 w-4 shrink-0 opacity-70 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0" data-testid="architect-ui-workflow-builder-component-library-label-text">
                        <span className="block break-words text-[13px] font-semibold leading-[1.25] text-slate-800" data-testid="architect-ui-workflow-builder-component-library-label-text-2">{item.label}</span>
                        <span className="sr-only" data-testid="architect-ui-workflow-builder-component-library-helper-text">{item.helper}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Coming Soon nodes and their section are intentionally hidden. */}
      </div>

      {/* <div className="mt-4 border-t border-gray-100 px-4 py-4">
        <p className="flex items-center gap-1.5 text-xs italic text-slate-400" data-testid="architect-ui-workflow-builder-component-library-drag-components-onto-the-canvas-text">
          Drag components onto the canvas
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </p>
      </div> */}
    </div>
  );
}
