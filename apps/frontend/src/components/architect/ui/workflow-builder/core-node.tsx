import { Handle, Position, type NodeProps } from "@xyflow/react";
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
  slate: { border: "border-slate-200", headerBg: "bg-slate-50", headerBorder: "border-slate-100", dot: "bg-slate-500", text: "text-slate-700", icon: "text-slate-600", rgb: "100,116,139", handle: "#64748b" }
};

export function CoreNode({ data, selected }: NodeProps<BuilderNode>) {
  const palette = nodePalette[data.accent] ?? nodePalette.slate;
  const isCondition = data.nodeKind === "condition";
  const hasInput = data.nodeKind !== "trigger";
  const cssVars = { "--glow-rgb": palette.rgb } as CSSProperties;

  return (
    <div
      className={cn("core-node group relative w-56 outline-none", selected && "selected")}
      style={cssVars}
      role="group"
      aria-label={`${data.kind}: ${data.title}`}
    >
      {hasInput ? (
        <Handle
          type="target"
          position={Position.Top}
          className="core-port"
          style={{ background: palette.handle }}
        />
      ) : null}

      <div className={cn("node-card relative rounded-2xl border-2 bg-white shadow-lg", palette.border)}>
        <div className={cn("flex items-center gap-2 rounded-t-[14px] border-b px-4 py-2.5", palette.headerBg, palette.headerBorder)}>
          <span className={cn("h-2 w-2 rounded-full", palette.dot)} />
          <span className={cn("text-[11px] font-bold uppercase tracking-wider", palette.text)}>{data.kind}</span>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <BuilderIcon name={data.icon} className={cn("h-4 w-4 shrink-0", palette.icon)} />
            <span className="node-title truncate text-sm font-semibold leading-tight text-slate-900">{data.title}</span>
          </div>
          {data.subtitle ? <p className="mt-1 line-clamp-2 text-xs text-slate-500">{data.subtitle}</p> : null}
        </div>

        {data.footer ? (
          <div className="rounded-b-[14px] border-t border-gray-100 bg-gray-50 px-4 py-2">
            <span className="font-mono text-[11px] text-slate-400">{data.footer}</span>
          </div>
        ) : null}
      </div>

      {isCondition ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            className="core-port"
            style={{ left: "30%", background: "#22c55e" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            className="core-port"
            style={{ left: "70%", background: "#ef4444" }}
          />
          <span className="absolute -bottom-[23px] left-[30%] -translate-x-1/2 text-[10px] font-bold text-green-600">Yes</span>
          <span className="absolute -bottom-[23px] left-[70%] -translate-x-1/2 text-[10px] font-bold text-red-500">No</span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="core-port"
          style={{ background: palette.handle }}
        />
      )}
    </div>
  );
}
