import { cn } from "@/components/architect/ui/architect-ui";
import { ChevronRight } from "lucide-react";
import { BuilderIcon } from "../icons";
import type { BuilderNodeData, LibraryItem, NodeKind } from "../types";

/** dataTransfer key shared with the canvas drop handler. */
export const BUILDER_NODE_DRAG_TYPE = "application/x-triven-builder-node";

/** Light pastel bg + muted darker fg (same hue, less bright). */
const CARD_PALETTE_BY_ICON: Record<string, { bg: string; fg: string }> = {
  // 📞 Telephony
  phone: { bg: "#FDF6EC", fg: "#A16207" },
  "phone-call": { bg: "#FDF6EC", fg: "#A16207" },
  "phone-missed": { bg: "#FDF6EC", fg: "#A16207" },
  "phone-outgoing": { bg: "#FDF6EC", fg: "#A16207" },

  // ▶ Input / Start
  play: { bg: "#F8F5FF", fg: "#6D4AFF" },

  // ✨ AI
  sparkles: { bg: "#F8F5FF", fg: "#7C3AED" },
  diamond: { bg: "#F8F5FF", fg: "#7C3AED" },
  brain: { bg: "#F8F5FF", fg: "#7C3AED" },
  image: { bg: "#F8F5FF", fg: "#7C3AED" },

  // 💬 Messaging
  telegram: { bg: "#F3F8FF", fg: "#2563EB" },
  whatsapp: { bg: "#F1FCF5", fg: "#16A34A" },
  message: { bg: "#FFF8EC", fg: "#C97A00" },
  mail: { bg: "#F3F8FF", fg: "#2563EB" },

  // 📅 Scheduling
  calendly: { bg: "#F3F6FF", fg: "#3B82F6" },
  calendar: { bg: "#F3F6FF", fg: "#3B82F6" },

  // 💾 Storage / Memory
  database: { bg: "#F2FBFB", fg: "#0F766E" },
  capture: { bg: "#F2FBFB", fg: "#0F766E" },

  // 📊 Presentation / Slides (NotebookLM-style muted pastel)
  presentation: { bg: "#F4EFE4", fg: "#96793A" },
  "slide-deck": { bg: "#F4EFE4", fg: "#96793A" },

  // 🛍 Your Product blocks (rose family)
  edit: { bg: "#FFF1F2", fg: "#BE123C" },
  gallery: { bg: "#FFF1F2", fg: "#BE123C" },
  sliders: { bg: "#FFF1F2", fg: "#BE123C" },
  eye: { bg: "#FFF1F2", fg: "#BE123C" },
  "arrow-right": { bg: "#FFF1F2", fg: "#BE123C" },
  clock: { bg: "#FFF1F2", fg: "#BE123C" }
};

const CARD_PALETTE_FALLBACK = { bg: "#F8FAFC", fg: "#475569" };

/** NotebookLM's UI uses Google's internal "Google Sans" family; Roboto is the closest public fallback. */
const NOTEBOOKLM_FONT_STACK =
  '"Google Sans", "Google Sans Text", Roboto, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

const BADGE_STYLES: Record<NonNullable<LibraryItem["badge"]>, string> = {
  NEW: "bg-neutral-900 text-white",
  POPULAR: "bg-neutral-900 text-white",
  BETA: "bg-neutral-900 text-white"
};

function cardPalette(icon: string): { bg: string; fg: string } {
  return CARD_PALETTE_BY_ICON[icon] ?? CARD_PALETTE_FALLBACK;
}

export type SidebarNodeCardProps = {
  item: LibraryItem;
  onAddNode: (nodeKind: NodeKind, overrides?: Partial<BuilderNodeData>) => void;
};

export function SidebarNodeCard({ item, onAddNode }: SidebarNodeCardProps) {
  const palette = cardPalette(item.icon);
  const description = item.helper.trim();

  return (
    <div className="group/card relative">
      <button
        data-testid={item.testId}
        type="button"
        draggable
        aria-label={item.label}
        aria-describedby={description ? `${item.testId ?? item.label}-desc` : undefined}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "copy";
          event.dataTransfer.setData(
            BUILDER_NODE_DRAG_TYPE,
            JSON.stringify({
              nodeKind: item.nodeKind,
              overrides: { ...item.overrides, accent: item.accent, icon: item.icon }
            })
          );
        }}
        onClick={() => onAddNode(item.nodeKind, { ...item.overrides, accent: item.accent, icon: item.icon })}
        style={{ backgroundColor: palette.bg, color: palette.fg }}
        className={cn(
          "comp h-[78px] w-full cursor-grab overflow-hidden rounded-2xl px-3 py-2.5 text-left transition-all duration-200 ease-out active:cursor-grabbing",
          "hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
        )}
      >
        {/* default-container */}
        <span className="flex h-full w-full items-center justify-between gap-2">
          {/* .icon-container */}
          <span className="flex min-w-0 flex-1 flex-col justify-center gap-3">
            {/* .icon-container-row */}
            <span className="flex items-center gap-1.5">
              <BuilderIcon name={item.icon} className="h-5 w-5 shrink-0 text-current" />
              {item.badge ? (
                <span
                  className={cn(
                    "inline-flex h-[18px] items-center rounded-full px-2 py-2 text-[9px] font-bold uppercase tracking-wide rounded-md",
                    BADGE_STYLES[item.badge]
                  )}
                  style={{ fontFamily: NOTEBOOKLM_FONT_STACK }}
                  data-testid="architect-ui-workflow-builder-component-library-item-badge"
                >
                  {item.badge}
                </span>
              ) : null}
            </span>

            {/* .create-label-container.mat-label-medium */}
            <span
              className="min-w-0 overflow-visible"
              data-testid="architect-ui-workflow-builder-component-library-label-text"
            >
              <span
                className="block truncate text-[12px] font-bold leading-5 tracking-[0.01em] text-current"
                style={{ fontFamily: NOTEBOOKLM_FONT_STACK }}
                data-testid="architect-ui-workflow-builder-component-library-label-text-2"
              >
                {item.label}
              </span>
              <span className="sr-only" data-testid="architect-ui-workflow-builder-component-library-helper-text">
                {item.helper}
              </span>
            </span>
          </span>

          {/* .option-icon */}
          <span className="flex shrink-0 items-center self-center">
            <ChevronRight
              className="h-4 w-4 text-slate-500 transition-transform group-hover/card:translate-x-0.5"
              strokeWidth={3}
              aria-hidden="true"
            />
          </span>
        </span>
      </button>

      {description ? (
        <span
          id={`${item.testId ?? item.label}-desc`}
          role="tooltip"
          data-testid="architect-ui-workflow-builder-component-library-card-tooltip"
          className={cn(
            "pointer-events-none absolute left-0 top-full z-50 mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-left text-[11px] font-medium leading-snug text-slate-600 shadow-[0_8px_20px_-8px_rgba(15,23,42,0.28)]",
            "opacity-0 transition-opacity duration-150 group-hover/card:opacity-100 group-focus-within/card:opacity-100"
          )}
          style={{ fontFamily: NOTEBOOKLM_FONT_STACK }}
        >
          {description}
        </span>
      ) : null}
    </div>
  );
}
