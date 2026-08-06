import { libraryGroups } from "./library";
import { SidebarNodeCard } from "./card/sidebar-node-card";
import type { BuilderNodeData, NodeKind } from "./types";

/** Re-export for canvas drop handler consumers. */
export { BUILDER_NODE_DRAG_TYPE } from "./card/sidebar-node-card";

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

      <div className="builder-sidebar-scroll flex-1 overflow-y-auto overflow-x-hidden px-4 pb-6 pt-4">
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
