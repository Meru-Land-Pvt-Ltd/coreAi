import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "@/components/architect/ui/architect-ui";
import { accentStyles } from "./accent-styles";
import { BuilderIcon } from "./icons";
import type { BuilderNode } from "./types";

export function CoreNode({ data, selected }: NodeProps<BuilderNode>) {
  const styles = accentStyles[data.accent] ?? accentStyles.slate;
  const isCondition = data.nodeKind === "condition";
  const hasInput = data.nodeKind !== "trigger";

  return (
    <div className={cn("group relative w-[254px] outline-none", selected && "scale-[1.012]")}> 
      {hasInput ? (
        <Handle
          type="target"
          position={Position.Top}
          className="!h-3.5 !w-3.5 !border-[3px] !border-white"
          style={{ background: styles.handle }}
        />
      ) : null}

      <div
        className={cn(
          "overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-xl",
          selected
            ? `${styles.selectedBorder} shadow-[0_0_0_3px_rgba(251,191,36,.25),0_18px_36px_-18px_rgba(15,23,42,.35)]`
            : styles.border
        )}
      >
        <div className={cn("h-1.5 w-full", styles.solid)} />
        <div className="flex items-start gap-3 p-4">
          <div className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-xl ring-4", styles.icon, styles.ring)}>
            <BuilderIcon name={data.icon} className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide", styles.chip)}>
              {data.kind}
            </span>
            <p className="mt-2 truncate text-sm font-black text-slate-900">{data.title}</p>
            {data.subtitle ? (
              <p className="mt-1 line-clamp-2 text-xs font-medium leading-5 text-slate-500">
                {data.subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {data.footer ? (
          <div className={cn("border-t px-4 py-2", styles.border, styles.subtle)}>
            <span className="font-mono text-[11px] text-slate-500">{data.footer}</span>
          </div>
        ) : null}
      </div>

      {isCondition ? (
        <>
          <Handle
            id="yes"
            type="source"
            position={Position.Bottom}
            className="!h-3.5 !w-3.5 !border-[3px] !border-white"
            style={{ left: "30%", background: "#22c55e" }}
          />
          <Handle
            id="no"
            type="source"
            position={Position.Bottom}
            className="!h-3.5 !w-3.5 !border-[3px] !border-white"
            style={{ left: "70%", background: "#ef4444" }}
          />
          <span className="absolute -bottom-7 left-[30%] -translate-x-1/2 text-[10px] font-black text-green-600">Yes</span>
          <span className="absolute -bottom-7 left-[70%] -translate-x-1/2 text-[10px] font-black text-red-500">No</span>
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Bottom}
          className="!h-3.5 !w-3.5 !border-[3px] !border-white"
          style={{ background: styles.handle }}
        />
      )}
    </div>
  );
}
