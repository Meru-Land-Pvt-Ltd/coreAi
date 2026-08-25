import { MarkerType, type Edge } from "@xyflow/react";
import { accentStyles } from "./accent-styles";
import type { NodeAccent } from "./types";

export function createFlowEdge({
  id,
  source,
  target,
  accent = "amber",
  sourceHandle,
  label
}: {
  id: string;
  source: string;
  target: string;
  accent?: NodeAccent;
  sourceHandle?: string;
  label?: string;
}): Edge {
  const styles = accentStyles[accent];

  return {
    id,
    source,
    target,
    sourceHandle,
    label,
    /* Every wire can be cut. Joining two steps took one drag; separating them
       used to take knowing that a wire can be clicked and that Delete then
       removes it — written in grey in the corner of the canvas, where nobody
       reads it. */
    type: "removable",
    animated: true,
    className: `workflow-edge ${styles.edgeClass}`,
    markerEnd: { type: MarkerType.ArrowClosed, color: styles.edge },
    style: {
      stroke: styles.edge,
      strokeWidth: 2.6
    },
    labelStyle: {
      fill: styles.edge,
      fontWeight: 800,
      fontSize: 11
    },
    labelBgStyle: {
      fill: "#ffffff",
      fillOpacity: 0.92
    },
    labelBgPadding: [8, 4],
    labelBgBorderRadius: 999
  };
}
