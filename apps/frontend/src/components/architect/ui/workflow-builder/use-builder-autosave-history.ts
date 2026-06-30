"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Edge } from "@xyflow/react";
import { updateArchitectWorkflow } from "@/components/architect/features/api";
import { defaultAgentName } from "./node-defaults";
import type { BuilderNode } from "./types";

const COMMIT_DEBOUNCE_MS = 400; // coalesce dragging / typing into one history entry
const AUTOSAVE_DEBOUNCE_MS = 2000; // 1.5–3s after the last change
const MAX_HISTORY = 50;

export type BuilderSnapshot = {
  nodes: BuilderNode[];
  edges: Edge[];
  agentName: string;
  tagline: string;
};

export function isMeaningfulWorkflow(snap: { nodes: { length: number }; agentName: string }): boolean {
  if (snap.nodes.length > 0) return true;
  const name = (snap.agentName || "").trim().toLowerCase();
  return name.length > 0 && name !== "untitled" && name !== defaultAgentName.trim().toLowerCase();
}

/** Stable identity of a builder state — ignores volatile React Flow fields (selected/measured). */
function snapshotKey(snap: BuilderSnapshot): string {
  return JSON.stringify({
    n: snap.nodes.map((node) => ({
      i: node.id,
      t: node.type,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
      d: node.data
    })),
    e: snap.edges.map((edge) => ({
      i: edge.id,
      s: edge.source,
      t: edge.target,
      sh: edge.sourceHandle ?? null,
      th: edge.targetHandle ?? null
    })),
    name: snap.agentName,
    tag: snap.tagline
  });
}

type Options = {
  workflowId: string;
  loading: boolean;
  /** False when the agent is locked (under review) — disables history + auto-save. */
  enabled: boolean;
  nodes: BuilderNode[];
  edges: Edge[];
  agentName: string;
  tagline: string;
  setNodes: (nodes: BuilderNode[]) => void;
  setEdges: (edges: Edge[]) => void;
  setAgentName: (name: string) => void;
  setTagline: (tagline: string) => void;
  setStatus: (message: string) => void;
};

export function useBuilderAutosaveHistory(opts: Options) {
  const { workflowId, loading, nodes, edges, agentName, tagline } = opts;

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const optsRef = useRef(opts);
  optsRef.current = opts;

  const pastRef = useRef<BuilderSnapshot[]>([]);
  const futureRef = useRef<BuilderSnapshot[]>([]);
  const presentSnapRef = useRef<BuilderSnapshot | null>(null);
  const presentKeyRef = useRef<string | null>(null);
  const latestRef = useRef<BuilderSnapshot | null>(null);
  const skipRef = useRef(false); // suppress capturing the next change as a user edit
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const mountedRef = useRef(true);
  const commitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveRef = useRef<() => void>(() => {});

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, []);

  // Reset history + draft tracking whenever the edited workflow changes.
  useEffect(() => {
    pastRef.current = [];
    futureRef.current = [];
    presentSnapRef.current = null;
    presentKeyRef.current = null;
    latestRef.current = null;
    skipRef.current = false;
    dirtyRef.current = false;
    setCanUndo(false);
    setCanRedo(false);
  }, [workflowId]);

  const scheduleAutoSave = useCallback(() => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(() => autoSaveRef.current(), AUTOSAVE_DEBOUNCE_MS);
  }, []);

  // Latest auto-save impl (reads current workflowId/state via refs to avoid stale closures).
  autoSaveRef.current = async () => {
    if (!dirtyRef.current || !optsRef.current.enabled) return;
    const snap = latestRef.current;
    if (!snap || !isMeaningfulWorkflow(snap)) return;
    if (savingRef.current) {
      scheduleAutoSave();
      return;
    }
    const keyAtSave = snapshotKey(snap);
    savingRef.current = true;
    optsRef.current.setStatus("Saving…");
    const res = await updateArchitectWorkflow(optsRef.current.workflowId, {
      name: snap.agentName,
      description: snap.tagline,
      workflowJson: { nodes: snap.nodes, edges: snap.edges }
    });
    savingRef.current = false;
    if (!mountedRef.current) return;
    if (!res.success) {
      optsRef.current.setStatus("Save failed");
      return;
    }
    // Clear the unsaved flag only if nothing changed while the save was in flight.
    if (latestRef.current && snapshotKey(latestRef.current) === keyAtSave) {
      dirtyRef.current = false;
      optsRef.current.setStatus("Saved");
    } else {
      scheduleAutoSave();
    }
  };

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    optsRef.current.setStatus("Unsaved changes");
    scheduleAutoSave();
  }, [scheduleAutoSave]);

  const commitHistory = useCallback(() => {
    const snap = latestRef.current;
    if (!snap) return;
    const key = snapshotKey(snap);
    if (key === presentKeyRef.current) return; // no real change (e.g. selection only)
    if (presentSnapRef.current) {
      pastRef.current.push(presentSnapRef.current);
      if (pastRef.current.length > MAX_HISTORY) pastRef.current.shift();
    }
    futureRef.current = [];
    presentSnapRef.current = snap;
    presentKeyRef.current = key;
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(false);
    markDirty();
  }, [markDirty]);

  // Capture user edits → history (debounced) + auto-save. Loads/undo/redo don't count.
  useEffect(() => {
    if (loading) return;
    const snap: BuilderSnapshot = { nodes, edges, agentName, tagline };
    latestRef.current = snap;
    const key = snapshotKey(snap);

    if (presentKeyRef.current === null) {
      // Baseline established after a load — never a user edit.
      presentKeyRef.current = key;
      presentSnapRef.current = snap;
      return;
    }
    if (skipRef.current) {
      // Programmatic change from undo/redo — adopt as present, don't push history.
      skipRef.current = false;
      presentKeyRef.current = key;
      presentSnapRef.current = snap;
      return;
    }
    if (key === presentKeyRef.current) return; // selection / dimension change only

    if (commitTimerRef.current) clearTimeout(commitTimerRef.current);
    commitTimerRef.current = setTimeout(() => commitHistory(), COMMIT_DEBOUNCE_MS);
  }, [nodes, edges, agentName, tagline, loading, commitHistory]);

  const applySnapshot = useCallback((snap: BuilderSnapshot) => {
    skipRef.current = true;
    presentSnapRef.current = snap;
    presentKeyRef.current = snapshotKey(snap);
    optsRef.current.setNodes(snap.nodes);
    optsRef.current.setEdges(snap.edges);
    optsRef.current.setAgentName(snap.agentName);
    optsRef.current.setTagline(snap.tagline);
    markDirty(); // restored state is unsaved → allow auto-save
  }, [markDirty]);

  const undo = useCallback(() => {
    if (!optsRef.current.enabled || pastRef.current.length === 0) return;
    if (presentSnapRef.current) futureRef.current.unshift(presentSnapRef.current);
    const prev = pastRef.current.pop() as BuilderSnapshot;
    applySnapshot(prev);
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    if (!optsRef.current.enabled || futureRef.current.length === 0) return;
    if (presentSnapRef.current) pastRef.current.push(presentSnapRef.current);
    const next = futureRef.current.shift() as BuilderSnapshot;
    applySnapshot(next);
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(futureRef.current.length > 0);
  }, [applySnapshot]);

  /** Called after a successful MANUAL save so auto-save doesn't redundantly re-save. */
  const markSaved = useCallback(() => {
    dirtyRef.current = false;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
  }, []);

  // Keyboard: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo. Skip while typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!optsRef.current.enabled) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target?.isContentEditable) return;
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        undo();
      } else if ((key === "z" && event.shiftKey) || key === "y") {
        event.preventDefault();
        redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo]);

  return { canUndo, canRedo, undo, redo, markSaved };
}
