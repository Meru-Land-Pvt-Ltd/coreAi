"use client";

/**
 * THE CANVAS CHECKS ITSELF.
 *
 * No button. Every time an architect adds, removes or rewires a step, the whole
 * orchestration is checked and the answer appears on the steps themselves.
 *
 * Two decisions about when it speaks, and both are about being worth reading.
 *
 * It waits until the canvas stops moving. Checking on every keystroke means a
 * step turns red halfway through typing a value, which trains people to ignore
 * red.
 *
 * And it says nothing at all until there is something to judge. A half-built
 * canvas is the normal state of an architect at work; shouting at every step
 * while somebody is still placing them is how a warning becomes wallpaper.
 */

import { useEffect, useRef, useState } from "react";
import { apiPost } from "@/lib/api";

export type WiringProblem = {
  nodeId: string;
  nodeLabel: string;
  kind: "missing_value" | "unreachable" | "needs_upstream";
  wanted: string;
  message: string;
};

export type WiringState = {
  /** Problems for one step, keyed by node id. */
  byNode: Record<string, WiringProblem[]>;
  problems: WiringProblem[];
  healthy: Set<string>;
  checking: boolean;
  /** False until the first answer, so nothing is painted before it is known. */
  known: boolean;
};

const QUIET_MS = 600;

/** A step's settings without where it sits. Moving a box cannot break it. */
function withoutPosition(data: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!data) return {};
  const { position: _position, ...rest } = data;
  return rest;
}

export function useWiringCheck(
  nodes: Array<{ id: string; data?: Record<string, unknown> }>,
  edges: Array<{ source: string; target: string }>
): WiringState {
  const [state, setState] = useState<WiringState>({
    byNode: {},
    problems: [],
    healthy: new Set<string>(),
    checking: false,
    known: false
  });

  // Only the parts that change the answer. Positions change constantly while
  // somebody drags a step around, and moving a step cannot break its wiring.
  const shape = JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, data: withoutPosition(node.data) })),
    edges: edges.map((edge) => ({ source: edge.source, target: edge.target }))
  });

  const latest = useRef(0);
  const empty = nodes.length === 0;

  useEffect(() => {
    if (empty) {
      setState({ byNode: {}, problems: [], healthy: new Set<string>(), checking: false, known: false });
      return;
    }

    const run = ++latest.current;
    setState((current) => ({ ...current, checking: true }));

    const timer = setTimeout(() => {
      const parsed = JSON.parse(shape) as {
        nodes: Array<{ id: string; data?: Record<string, unknown> }>;
        edges: Array<{ source: string; target: string }>;
      };

      void apiPost<{ ok: boolean; problems: WiringProblem[]; healthyNodeIds: string[] }>(
        "/architect/wiring-check",
        parsed
      ).then((result) => {
        // A slower earlier answer must never overwrite a newer one.
        if (run !== latest.current) return;

        if (!result.success || !result.data) {
          setState((current) => ({ ...current, checking: false }));
          return;
        }

        const byNode: Record<string, WiringProblem[]> = {};
        for (const problem of result.data.problems) {
          byNode[problem.nodeId] = [...(byNode[problem.nodeId] ?? []), problem];
        }

        setState({
          byNode,
          problems: result.data.problems,
          healthy: new Set(result.data.healthyNodeIds),
          checking: false,
          known: true
        });
      });
    }, QUIET_MS);

    return () => clearTimeout(timer);
  }, [shape, empty]);

  return state;
}
