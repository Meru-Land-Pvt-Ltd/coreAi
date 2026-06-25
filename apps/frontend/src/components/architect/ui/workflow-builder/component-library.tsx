import { cn } from "@/components/architect/ui/architect-ui";
import { accentStyles } from "./accent-styles";
import { libraryGroups } from "./library";
import { BuilderIcon } from "./icons";
import type { BuilderNodeData, NodeKind } from "./types";

export function ComponentLibrary({
  searchTerm,
  onSearchChange,
  onLoadTemplate,
  onAddNode
}: {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onLoadTemplate: (templateId: "missed-call" | "gmail-reply") => void;
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
          <input
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search components..."
            className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-400/50"
          />
        </div>
      </div>

      <div className="scroll-thin flex-1 overflow-y-auto px-4 pt-4">
        <div className="mb-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onLoadTemplate("missed-call")}
            className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-left transition hover:border-amber-400"
          >
            <span className="block text-xs font-semibold text-slate-900">Missed Call</span>
            <span className="mt-0.5 block text-[11px] text-slate-500">Load exact flow</span>
          </button>
          <button
            type="button"
            onClick={() => onLoadTemplate("gmail-reply")}
            className="rounded-xl border-2 border-gray-200 bg-white px-3 py-2 text-left transition hover:border-amber-200"
          >
            <span className="block text-xs font-semibold text-slate-900">Gmail Reply</span>
            <span className="mt-0.5 block text-[11px] text-slate-500">Use Gmail nodes</span>
          </button>
        </div>

        <div className="space-y-5">
          {filteredGroups.map((group) => (
            <div key={group.title}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-400">{group.title}</p>
              <div className="space-y-2">
                {group.items.map((item) => {
                  const styles = accentStyles[item.accent];
                  return (
                    <button
                      key={`${group.title}-${item.label}`}
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
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-900">{item.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">{item.helper}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-4 border-t border-gray-100 px-4 py-4">
        <p className="flex items-center gap-1.5 text-xs italic text-slate-400">
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
