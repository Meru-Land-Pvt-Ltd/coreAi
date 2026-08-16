import { DesignBrainChat } from "./design-brain-chat";

/**
 * Design Brain chat — lives inside the node properties sidebar. The architect
 * types how the page should look ("dark theme, pin the box at the bottom") and
 * the backend applies a validated design patch; the reply lands here and the
 * Test preview refreshes through onDesignApplied.
 *
 * The chat UI itself lives in design-brain-chat.tsx (shared with the column
 * docked beside the Test preview); this wrapper keeps the sidebar's exact
 * look, props and testids.
 */
export function DesignBrainPanel({
  workflowId,
  previewVisible = false,
  onDesignApplied
}: {
  /** Saved workflow id — null while a brand-new agent has not autosaved yet. */
  workflowId: string | null;
  /** True while the architect is watching the Test preview. */
  previewVisible?: boolean;
  /**
   * Called after a patch lands so the Test preview refetches the page.
   * `graphChanged` true means the saved canvas graph changed too and the
   * builder should reload nodes/edges from the server.
   */
  onDesignApplied?: (result: { graphChanged?: boolean }) => void;
}) {
  return (
    <DesignBrainChat
      variant="inspector"
      workflowId={workflowId}
      previewVisible={previewVisible}
      onApplied={onDesignApplied}
    />
  );
}
