"use client";

/**
 * A WIRE YOU CAN CUT.
 *
 * Joining two nodes took one drag. Separating them took knowing that a wire can
 * be clicked and that the Delete key then removes it — which is written in the
 * corner of the canvas in grey, and which nobody reads. An architect who wants
 * to put a step in the middle of a working agent had no way out and no way to
 * ask; the wire simply looked permanent.
 *
 * So the wire shows a cross when you point at it. That is the whole feature.
 * Hidden until it is wanted, so a canvas of twenty steps is not twenty crosses,
 * and visible the instant a person's hand goes near the thing they want to
 * change.
 */

import { useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  useReactFlow,
  type Edge,
  type EdgeProps
} from "@xyflow/react";

export function RemovableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  labelStyle,
  labelBgStyle,
  labelBgPadding,
  labelBgBorderRadius,
  selected
}: EdgeProps) {
  const { setEdges } = useReactFlow();
  const [hovered, setHovered] = useState(false);

  const [path, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition
  });

  const showCut = hovered || selected;

  return (
    <>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} />

      {/* A wide invisible path, because a 2.6px line is not something a hand can
          reliably point at. This is the thing being hovered, not the wire. */}
      <path
        d={path}
        fill="none"
        strokeWidth={22}
        stroke="transparent"
        style={{ pointerEvents: "stroke", cursor: "pointer" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      <EdgeLabelRenderer>
        {label ? (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY - 16}px)`,
              pointerEvents: "none",
              ...(labelBgStyle ?? {}),
              padding: labelBgPadding ? `${labelBgPadding[1]}px ${labelBgPadding[0]}px` : undefined,
              borderRadius: labelBgBorderRadius,
              ...(labelStyle ?? {})
            }}
          >
            {label}
          </div>
        ) : null}

        <button
          type="button"
          aria-label="Disconnect these two steps"
          data-testid={`edge-cut-${id}`}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onClick={(event) => {
            event.stopPropagation();
            setEdges((current: Edge[]) => current.filter((edge) => edge.id !== id));
          }}
          style={{
            position: "absolute",
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: "all",
            opacity: showCut ? 1 : 0,
            transition: "opacity .12s ease",
            /* Above the steps. The middle of a wire is very often underneath a
               node — two steps in a column put it directly behind the lower one
               — and a cross you can see but cannot click is worse than none. */
            zIndex: 1200
          }}
          className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-200 bg-white text-slate-400 shadow-sm transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
