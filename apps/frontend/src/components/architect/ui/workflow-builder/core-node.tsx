import { Handle, Position, type NodeProps } from "@xyflow/react";
import { getNodeDefinition, isBlockNodeType } from "@coreai/shared";
import type { CSSProperties } from "react";
import { cn } from "@/components/architect/ui/architect-ui";
import { BuilderIcon } from "./icons";
import type { BuilderNode, NodeAccent } from "./types";

const nodePalette: Record<NodeAccent, {
  border: string;
  headerBg: string;
  headerBorder: string;
  dot: string;
  text: string;
  icon: string;
  rgb: string;
  handle: string;
}> = {
  amber: { border: "border-amber-300", headerBg: "bg-amber-50", headerBorder: "border-amber-100", dot: "bg-amber-500", text: "text-amber-700", icon: "text-amber-600", rgb: "245,158,11", handle: "#f59e0b" },
  violet: { border: "border-violet-200", headerBg: "bg-violet-50", headerBorder: "border-violet-100", dot: "bg-violet-500", text: "text-violet-700", icon: "text-violet-600", rgb: "139,92,246", handle: "#8b5cf6" },
  orange: { border: "border-orange-200", headerBg: "bg-orange-50", headerBorder: "border-orange-100", dot: "bg-orange-500", text: "text-orange-700", icon: "text-orange-600", rgb: "249,115,22", handle: "#f97316" },
  green: { border: "border-green-200", headerBg: "bg-green-50", headerBorder: "border-green-100", dot: "bg-green-500", text: "text-green-700", icon: "text-green-600", rgb: "34,197,94", handle: "#22c55e" },
  blue: { border: "border-blue-200", headerBg: "bg-blue-50", headerBorder: "border-blue-100", dot: "bg-blue-500", text: "text-blue-700", icon: "text-blue-600", rgb: "59,130,246", handle: "#3b82f6" },
  red: { border: "border-red-200", headerBg: "bg-red-50", headerBorder: "border-red-100", dot: "bg-red-500", text: "text-red-700", icon: "text-red-600", rgb: "239,68,68", handle: "#ef4444" },
  slate: { border: "border-slate-200", headerBg: "bg-slate-50", headerBorder: "border-slate-100", dot: "bg-slate-500", text: "text-slate-700", icon: "text-slate-600", rgb: "100,116,139", handle: "#64748b" },
  rose: { border: "border-rose-200", headerBg: "bg-rose-50", headerBorder: "border-rose-100", dot: "bg-rose-500", text: "text-rose-700", icon: "text-rose-600", rgb: "244,63,94", handle: "#f43f5e" }
};

export function CoreNode({ data, selected }: NodeProps<BuilderNode>) {
  const palette = nodePalette[data.accent] ?? nodePalette.slate;

  /*
   * The step's own health, put there by the canvas after every change.
   *
   * Deliberately quiet. A step that is fine gets a small green dot, not a green
   * card — the canvas is for reading the flow, and painting two thirds of it a
   * different colour would make the one broken step harder to see, not easier.
   * A step with a problem gets a red ring and says what is wrong on hover.
   */
  const health = (data as { wiringProblems?: Array<{ message: string }> }).wiringProblems;
  const broken = Array.isArray(health) && health.length > 0;
  const verified = (data as { wiringChecked?: boolean }).wiringChecked === true && !broken;
  const isCondition = data.nodeKind === "condition";
  const isTelegramTrigger = data.type === "trigger.telegram_message";
  const hasInput = data.nodeKind !== "trigger";
  const cssVars = { "--glow-rgb": palette.rgb } as CSSProperties;
  /* The header says what this node IS.
     It used to say "PRODUCT" for every Face node — Prompt Box, Result Viewer,
     Button, all of them wearing the same word. Somebody looking at a canvas
     needs to know which one they are looking at, so the header now carries the
     node's own name. data.kind cannot be used here: on a Result Viewer it
     doubles as that node's saved setting ("auto"/"image"/…). */
  const isProductBlock = data.nodeKind === "block" || isBlockNodeType(String(data.type ?? ""));
  const definition = getNodeDefinition(String(data.type ?? ""));
  const kindLabel = isProductBlock
    ? (definition?.label ?? data.title ?? "PRODUCT").toUpperCase()
    : data.kind;

  /* What this node hands to the next one, straight from its declaration.
     docs/NODE-SOP.md question 4 — and if it is written on the node, nobody has
     to open a panel to find out what a wire will carry. */
  const gives = definition?.producedVariables ?? [];

  return (
    <div
      className={cn("core-node group relative w-56 outline-none", selected && "selected")}
      style={cssVars}
      role="group"
      aria-label={`${kindLabel}: ${data.title}`}
    >
      {hasInput ? (
        <Handle
          type="target"
          position={Position.Left}
          className="core-port"
          style={{ background: palette.handle }}
        />
      ) : null}

      <div
        className={cn(
          "node-card relative rounded-2xl border-2 bg-white shadow-lg",
          broken ? "border-red-400 ring-2 ring-red-200" : palette.border
        )}
        {...(broken ? { title: health!.map((problem) => problem.message).join("\n") } : {})}
        data-testid={broken ? "core-node-broken" : verified ? "core-node-verified" : undefined}
      >
        {broken ? (
          <span
            className="absolute -right-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full bg-red-500 text-[11px] font-bold text-white shadow"
            aria-label={`${health!.length} problem${health!.length === 1 ? "" : "s"} with this step`}
          >
            !
          </span>
        ) : verified ? (
          <span
            className="absolute -right-1 -top-1 z-10 h-2.5 w-2.5 rounded-full bg-emerald-500 shadow"
            aria-label="This step gets everything it needs"
          />
        ) : null}
        <div className={cn("flex items-center gap-2 rounded-t-[14px] border-b px-4 py-2.5", palette.headerBg, palette.headerBorder)}>
          <span className={cn("h-2 w-2 rounded-full", palette.dot)} />
          <span className={cn("text-[11px] font-bold uppercase tracking-wider", palette.text)} data-testid="architect-ui-workflow-builder-core-node-kind-text-2">{kindLabel}</span>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <BuilderIcon name={data.icon} className={cn("h-4 w-4 shrink-0", palette.icon)} />
            <span className="node-title truncate text-sm font-semibold leading-tight text-slate-900" data-testid="architect-ui-workflow-builder-core-node-title-text">{data.title}</span>
          </div>
          {data.subtitle ? <p className="mt-1 line-clamp-2 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-core-node-subtitle-text">{data.subtitle}</p> : null}

          {gives.length > 0 ? (
            <p className="mt-2 flex flex-wrap items-center gap-1" data-testid="core-node-gives">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Gives</span>
              {gives.map((key) => (
                <span
                  key={key}
                  className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                >
                  {key}
                </span>
              ))}
            </p>
          ) : null}
        </div>

        {data.footer ? (
          <div className="rounded-b-[14px] border-t border-gray-100 bg-gray-50 px-4 py-2">
            <span className="font-mono text-[11px] text-slate-400" data-testid="architect-ui-workflow-builder-core-node-footer-text">{data.footer}</span>
          </div>
        ) : null}
      </div>

      {isCondition ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Right}
            className="core-port"
            style={{ top: "35%", background: "#22c55e" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Right}
            className="core-port"
            style={{ top: "65%", background: "#ef4444" }}
          />
          <span className="absolute -right-[26px] top-[35%] -translate-y-1/2 text-[10px] font-bold text-green-600" data-testid="architect-ui-workflow-builder-core-node-yes-text">Yes</span>
          <span className="absolute -right-[22px] top-[65%] -translate-y-1/2 text-[10px] font-bold text-red-500" data-testid="architect-ui-workflow-builder-core-node-no-text">No</span>
        </>
      ) : (
        <Handle
          id={isTelegramTrigger ? "*" : undefined}
          type="source"
          position={Position.Right}
          className="core-port"
          style={{ background: palette.handle }}
          title={isTelegramTrigger ? "All Telegram updates" : undefined}
          aria-label={isTelegramTrigger ? "All Telegram updates" : undefined}
        />
      )}
    </div>
  );
}
