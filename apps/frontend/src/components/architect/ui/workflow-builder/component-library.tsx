import { cn } from "@/components/architect/ui/architect-ui";
import { accentStyles } from "./accent-styles";
import { agentTemplates, libraryGroups } from "./library";
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
    <div className="h-full overflow-y-auto p-4">
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
        </span>
        <input
          value={searchTerm}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search components..."
          className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-300 focus:bg-white focus:ring-2 focus:ring-amber-400/50"
        />
      </div>

      <div className="mt-4 grid gap-2">
        {agentTemplates.map((template) => {
          const styles = accentStyles[template.accent];
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => onLoadTemplate(template.id)}
              className={cn(
                "w-full rounded-xl border px-4 py-3 text-left text-sm font-black shadow-sm transition hover:-translate-y-0.5",
                template.id === "missed-call"
                  ? "border-transparent bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-amber-500/25"
                  : `${styles.border} bg-white text-slate-900 hover:border-amber-200`
              )}
            >
              <span className="flex items-center gap-2">
                <BuilderIcon name={template.icon} className="h-4 w-4" />
                {template.title}
              </span>
              <span className={cn("mt-1 block text-xs font-semibold", template.id === "missed-call" ? "text-white/80" : "text-slate-500")}>
                {template.description}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-5">
        {filteredGroups.map((group) => (
          <div key={group.title}>
            <p className="mb-2 text-[11px] font-black uppercase tracking-wider text-slate-400">{group.title}</p>
            <div className="space-y-2">
              {group.items.map((item) => {
                const styles = accentStyles[item.accent];
                return (
                  <button
                    key={`${group.title}-${item.label}`}
                    type="button"
                    onClick={() => onAddNode(item.nodeKind, { ...item.overrides, accent: item.accent, icon: item.icon })}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                      styles.border
                    )}
                  >
                    <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-xl ring-4", styles.icon, styles.ring)}>
                      <BuilderIcon name={item.icon} className="h-5 w-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-black text-slate-900">{item.label}</span>
                      <span className="mt-0.5 block text-xs font-medium text-slate-500">{item.helper}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
