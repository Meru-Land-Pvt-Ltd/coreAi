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
  void agentId;
  void estimatedCost;

  return (
    <footer className="fixed bottom-0 left-0 z-40 flex h-10 w-full min-w-0 items-center border-t border-gray-100 bg-white px-3 text-xs sm:px-4">
      <div className="min-w-0 flex-1 truncate text-slate-400">
        <span data-testid="architect-ui-workflow-builder-builder-status-bar-nodes-count-text">{nodesCount}</span>
        {" "}nodes
        <span className="mx-1 text-slate-300">·</span>
        <span data-testid="architect-ui-workflow-builder-builder-status-bar-edges-count-text">{edgesCount}</span>
        {" "}connections
        <span className="mx-1 hidden text-slate-300 sm:inline">·</span>
        <span className="hidden sm:inline" data-testid="architect-ui-workflow-builder-builder-status-bar-edited-label-text">
          {editedLabel}
        </span>
      </div>
    </footer>
  );
}
