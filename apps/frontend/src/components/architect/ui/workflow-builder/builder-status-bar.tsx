import { BuilderIcon } from "./icons";

export function BuilderStatusBar({
  nodesCount,
  edgesCount,
  editedLabel = "last edited 2 min ago",
  agentId = "agt_mctb_001",
  estimatedCost = "$0.15/run"
}: {
  nodesCount: number;
  edgesCount: number;
  editedLabel?: string;
  agentId?: string;
  estimatedCost?: string;
}) {
  return (
    <footer className="fixed bottom-0 left-0 z-40 flex h-10 w-full items-center border-t border-gray-100 bg-white px-4 text-xs">
      <div className="flex-1 text-slate-400">
        <span>{nodesCount}</span> nodes - <span>{edgesCount}</span> connections - <span>{editedLabel}</span>
      </div>
      <div className="hidden flex-1 text-center font-mono text-slate-300 sm:block">Agent ID: {agentId}</div>
      <div className="flex flex-1 items-center justify-end gap-1.5 text-slate-500">
        <span>Estimated execution cost: <span className="font-medium text-slate-600">{estimatedCost}</span></span>
        <span className="builder-tooltip cursor-help text-slate-400 hover:text-slate-600">
          <BuilderIcon name="info" className="h-3.5 w-3.5" />
          <span className="builder-tooltip-body">~ $0.12 model + $0.03 SMS per execution</span>
        </span>
      </div>
    </footer>
  );
}
