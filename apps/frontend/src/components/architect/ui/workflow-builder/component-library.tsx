import { cn } from "@/components/architect/ui/architect-ui";
import { accentStyles } from "./accent-styles";
import { comingSoonItems, libraryGroups } from "./library";
import { BuilderIcon } from "./icons";
import type { BuilderNodeData, NodeKind } from "./types";

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

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pt-4">
        <button
          type="button"
          onClick={() => onUseTemplate("dental-ai-receptionist")}
          data-testid="library-template-ai-receptionist"
          className="mb-3 w-full rounded-xl border-2 border-violet-300 bg-violet-50 px-3 py-2 text-left transition hover:border-violet-400"
        >
          <span className="flex items-center justify-between gap-2">
            <span className="block text-xs font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-dental-text">Dental AI Receptionist</span>
            <span className="shrink-0 rounded-full bg-violet-600 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" data-testid="architect-ui-workflow-builder-component-library-dental-badge">Recommended · Latest</span>
          </span>
          <span className="mt-0.5 block text-[11px] text-slate-500" data-testid="architect-ui-workflow-builder-component-library-dental-helper-text">6 voice nodes: call → AI → calendar → book → SMS → end</span>
        </button>
        <button
          type="button"
          onClick={() => onUseTemplate("missed-call-text-back")}
          data-testid="library-template-missed-call"
          className="mb-3 w-full rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-left transition hover:border-amber-400"
        >
          <span className="block text-xs font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-missed-call-text">Missed Call Text-Back</span>
          <span className="mt-0.5 block text-[11px] text-slate-500" data-testid="architect-ui-workflow-builder-component-library-load-exact-flow-text">Import the 3-node flow</span>
        </button>

        <div className="space-y-5">
          {filteredGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-component-library-group-title-text">{group.title}</p>
              <div className="space-y-2">
                {group.items.map((item) => {
                  const styles = accentStyles[item.accent];
                  return (
                    <button
                      key={`${group.title}-${item.label}`}
                      data-testid={item.testId}
                      type="button"
                      onClick={() => onAddNode(item.nodeKind, { ...item.overrides, accent: item.accent, icon: item.icon })}
                      className={cn(
                        "comp flex w-full cursor-grab items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition active:cursor-grabbing hover:-translate-y-0.5 hover:shadow-md",
                        styles.border
                      )}
                    >
                      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-4", styles.icon, styles.ring)}>
                        <BuilderIcon name={item.icon} className="h-5 w-5" />
                      </span>
                      <span className="min-w-0" data-testid="architect-ui-workflow-builder-component-library-label-text">
                        <span className="block truncate text-sm font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-component-library-label-text-2">{item.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500" data-testid="architect-ui-workflow-builder-component-library-helper-text">{item.helper}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <ComingSoonSection query={query} />
      </div>

      <div className="mt-4 border-t border-gray-100 px-4 py-4">
        <p className="flex items-center gap-1.5 text-xs italic text-slate-400" data-testid="architect-ui-workflow-builder-component-library-drag-components-onto-the-canvas-text">
          Drag components onto the canvas
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
          </svg>
        </p>
      </div>
    </div>
  );
}

function ComingSoonSection({ query }: { query: string }) {
  const items = !query
    ? comingSoonItems
    : comingSoonItems.filter(
        (item) =>
          item.label.toLowerCase().includes(query) || item.description.toLowerCase().includes(query)
      );

  if (items.length === 0) return null;

  return (
    <div className="mt-6" data-testid="builder-coming-soon">
      <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-component-library-coming-soon-text">Coming soon</p>
      <div className="space-y-2">
        {items.map((item) => (
          <div
            key={item.type}
            data-testid={item.testId}
            aria-disabled="true"
            title="Coming soon — not executable yet"
            className="flex w-full cursor-not-allowed items-center gap-3 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-3 text-left opacity-70"
          >
            <span className="min-w-0" data-testid="architect-ui-workflow-builder-component-library-label-text-3">
              <span className="block truncate text-sm font-semibold text-slate-500" data-testid="architect-ui-workflow-builder-component-library-label-text-4">{item.label}</span>
              <span className="mt-0.5 block truncate text-xs text-slate-400" data-testid="architect-ui-workflow-builder-component-library-description-text">{item.description}</span>
            </span>
            <span className="ml-auto shrink-0 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500" data-testid="architect-ui-workflow-builder-component-library-soon-text">
              Soon
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
