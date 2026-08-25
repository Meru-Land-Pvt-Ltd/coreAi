"use client";

/**
 * WHAT THE PLATFORM ALLOWS ON A NODE.
 *
 * An architect should meet a limit where they are working — a button that
 * politely stops and says why — rather than at publish, or worse, in a run
 * log. So the builder asks the platform once and holds the answer.
 *
 * A failed ask returns the shipped default rather than nothing: a builder that
 * cannot draw a node because a settings row was slow is far worse than one that
 * allows a road too many for a minute.
 */

import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";

export type NodeLimits = {
  /** The most roads out one Condition may have. */
  conditionRoads: number;
};

/** The same number the backend ships as its default (admin/node-limits.ts). */
export const DEFAULT_NODE_LIMITS: NodeLimits = { conditionRoads: 8 };

let cached: NodeLimits | null = null;
let cachedAt = 0;
const CACHE_MS = 60_000;
let inFlight: Promise<NodeLimits> | null = null;

async function fetchLimits(): Promise<NodeLimits> {
  if (cached && Date.now() - cachedAt < CACHE_MS) return cached;
  if (inFlight) return inFlight;

  inFlight = apiGet<{ limits?: Partial<NodeLimits> }>("/architect/builder-nodes")
    .then((response) => {
      const limits = response.success ? response.data?.limits : undefined;
      cached = {
        conditionRoads: Number(limits?.conditionRoads) || DEFAULT_NODE_LIMITS.conditionRoads
      };
      cachedAt = Date.now();
      return cached;
    })
    .catch(() => DEFAULT_NODE_LIMITS)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useNodeLimits(): NodeLimits {
  const [limits, setLimits] = useState<NodeLimits>(cached ?? DEFAULT_NODE_LIMITS);

  useEffect(() => {
    let alive = true;
    void fetchLimits().then((next) => {
      if (alive) setLimits(next);
    });
    return () => {
      alive = false;
    };
  }, []);

  return limits;
}
