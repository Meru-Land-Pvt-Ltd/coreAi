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

  /* What this node takes and what it hands on, straight from its declaration.
     docs/NODE-SOP.md questions 3 and 4 — written on the card, so nobody opens a
     panel to find out what a wire has to carry or what it will carry. */
  const takes = definition?.requiredVariables ?? [];

  /* The roads out of a condition, in the architect's own words. Two by default,
     and "Anything else" always last — see conditionRoads in the runner, which
     must agree with this. */
  const roads = (() => {
    if (!isCondition) return [];
    const raw = (data as unknown as Record<string, unknown>).conditionChoices;
    const chosen = Array.isArray(raw)
      ? raw.map((value) => String(value).trim()).filter((value) => value.length > 0)
      : [];
    const list = chosen.length > 0 ? chosen : ["Yes", "No"];
    return list.some((road) => road.toLowerCase() === "anything else") ? list : [...list, "Anything else"];
  })();
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
        ) : null}
        <div className={cn("flex items-center gap-2 rounded-t-[14px] border-b px-4 py-2.5", palette.headerBg, palette.headerBorder)}>
          {/* ONE DOT, AND IT MEANS SOMETHING.
              There were two: this spot beside the name, which only repeated the
              colour of the card it was sitting on, and a green tick in the
              top-right corner. The corner one is gone and this one carries the
              health — so a canvas reads at a glance, with one mark to learn
              instead of two, and the space it used to occupy stays clean. */}
          <span
            className={cn("h-2 w-2 shrink-0 rounded-full", verified ? "bg-emerald-500" : palette.dot)}
            aria-label={verified ? "This step gets everything it needs" : undefined}
            data-testid={verified ? "core-node-verified-dot" : undefined}
          />
          <span className={cn("text-[11px] font-bold uppercase tracking-wider", palette.text)} data-testid="architect-ui-workflow-builder-core-node-kind-text-2">{kindLabel}</span>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center gap-2">
            <BuilderIcon name={data.icon} className={cn("h-4 w-4 shrink-0", palette.icon)} />
            <span className="node-title truncate text-sm font-semibold leading-tight text-slate-900" data-testid="architect-ui-workflow-builder-core-node-title-text">{data.title}</span>
          </div>
          {data.subtitle ? <p className="mt-1 line-clamp-2 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-core-node-subtitle-text">{data.subtitle}</p> : null}

          {takes.length > 0 || definition?.needsWhateverItsPromptAsksFor ? (
            <p className="mt-2 flex flex-wrap items-center gap-1" data-testid="core-node-takes">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Takes</span>
              {definition?.needsWhateverItsPromptAsksFor ? (
                /* This node's door in is written in its own prompt, so there is
                   no fixed list to print — saying that is more honest than
                   printing nothing and letting it read as "needs nothing". */
                <span className="text-[10px] italic text-slate-500">whatever your prompt asks for</span>
              ) : (
                takes.map((key) => (
                  <span
                    key={key}
                    className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600"
                  >
                    {key}
                  </span>
                ))
              )}
            </p>
          ) : null}

          {gives.length > 0 ? (
            <p className="mt-1.5 flex flex-wrap items-center gap-1" data-testid="core-node-gives">
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
        /* ONE ROAD OUT PER WORD.
           Yes and No used to be the only two, hard-coded, so routing three ways
           meant three conditions chained in a ladder. They are ordinary words
           an architect may rename now, and "Anything else" is always last —
           a customer will eventually say something nobody listed. */
        <>
          {roads.map((road, index) => {
            const top = `${((index + 1) / (roads.length + 1)) * 100}%`;
            const last = index === roads.length - 1;
            return (
              <span key={road}>
                <Handle
                  id={road.toLowerCase()}
                  type="source"
                  position={Position.Right}
                  className="core-port"
                  style={{ top, background: last ? "#94a3b8" : index === 0 ? "#22c55e" : "#f59e0b" }}
                />
                <span
                  className={cn(
                    "absolute -right-1 max-w-[7rem] translate-x-full -translate-y-1/2 truncate pl-1.5 text-[10px] font-bold",
                    last ? "text-slate-400" : index === 0 ? "text-green-600" : "text-amber-600"
                  )}
                  style={{ top }}
                  data-testid={`core-node-road-${road.toLowerCase()}`}
                >
                  {road}
                </span>
              </span>
            );
          })}
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
