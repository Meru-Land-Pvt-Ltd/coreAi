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
        <span data-testid="architect-ui-workflow-builder-builder-status-bar-nodes-count-text">{nodesCount}</span> nodes - <span data-testid="architect-ui-workflow-builder-builder-status-bar-edges-count-text">{edgesCount}</span> connections - <span data-testid="architect-ui-workflow-builder-builder-status-bar-edited-label-text">{editedLabel}</span>
      </div>
    </footer>
  );
}
