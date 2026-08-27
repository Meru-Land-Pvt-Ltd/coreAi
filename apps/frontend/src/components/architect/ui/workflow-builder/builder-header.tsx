import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, Monitor, Move, Smartphone, Tablet } from "lucide-react";
import { cn } from "@/components/architect/ui/architect-ui";
import type { ContentWidth } from "@/components/agent-page/types";
import { BuilderIcon } from "./icons";
import type { PreviewDevice } from "./preview-panel";
import type { BuilderTab } from "./types";

const BUILDER_STEPS: Array<{ id: BuilderTab; label: string; step: number }> = [
  /* The founder's ruling (2026-08-27): the Preview tab and the Run button
     were two doors to one destination. The tab died; the one button beside
     Publish is the only door, and what stands behind it is judged by the
     agent's trigger. */
  { id: "build", label: "Build", step: 1 },
  { id: "configure", label: "Configure", step: 2 },
  { id: "publish", label: "Publish", step: 3 }
];

/** The three ways to look at the customer page — shown on the Preview step. */
const PREVIEW_DEVICES: Array<{ id: PreviewDevice; label: string; icon: typeof Monitor }> = [
  { id: "desktop", label: "Desktop", icon: Monitor },
  { id: "tablet", label: "Tablet", icon: Tablet },
  { id: "phone", label: "Phone", icon: Smartphone }
];

/**
 * How wide the architect's product runs on big screens. Plain words, widest
 * last. The rule this control cannot break — phones and tablets always use
 * the whole screen — is spelled out in its tooltip, so nobody has to guess
 * why the phone frame ignores it.
 */
const PREVIEW_WIDTHS: Array<{ id: ContentWidth; label: string }> = [
  { id: "compact", label: "Compact" },
  { id: "standard", label: "Standard" },
  { id: "wide", label: "Wide" },
  { id: "full", label: "Full screen" }
];

const PREVIEW_WIDTH_HINT =
  "How wide your product runs on big screens. Phones and tablets always use the whole screen.";

function HeaderButton({
  children,
  onClick,
  active = false,
  testId
}: {
  children: ReactNode;
  onClick: () => void;
  active?: boolean;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex items-center border-b-2 px-3 text-sm transition lg:px-4",
        active
          ? "border-amber-500 font-semibold text-amber-600"
          : "border-transparent font-medium text-slate-500 hover:text-slate-700"
      )}
    >
      {children}
    </button>
  );
}

export function BuilderHeader({
  agentName,
  message,
  activeTab,
  running,
  saving,
  hasGmailFlow,
  locked = false,
  isLive = false,
  publishLocked = false,
  canUndo = false,
  canRedo = false,
  previewDevice = "desktop",
  onPreviewDeviceChange,
  previewWidth = "standard",
  onPreviewWidthChange,
  showPreviewControls = false,
  arrangeMode = false,
  onArrangeModeChange,
  onOpenAdvanced,
  onUndo,
  onRedo,
  onAgentNameChange,
  onTabChange,
  onRunTest,
  onSave
}: {
  agentName: string;
  message: string;
  activeTab: BuilderTab;
  running: boolean;
  saving: boolean;
  hasGmailFlow: boolean;
  locked?: boolean;
  isLive?: boolean;
  publishLocked?: boolean;
  canUndo?: boolean;
  canRedo?: boolean;
  /** Device the Test preview shows; only read while showPreviewControls. */
  previewDevice?: PreviewDevice;
  onPreviewDeviceChange?: (device: PreviewDevice) => void;
  /**
   * The saved `contentWidth` design dial; only read while showPreviewControls.
   * Changing it saves the design — that is why the control is disabled while
   * the agent is review-locked, like every other builder write.
   */
  previewWidth?: ContentWidth;
  onPreviewWidthChange?: (width: ContentWidth) => void;
  /** True only on the Preview step — renders the compact device switcher. */
  showPreviewControls?: boolean;
  /** Arrange mode (drag blocks on the preview page); desktop view only. */
  arrangeMode?: boolean;
  onArrangeModeChange?: (on: boolean) => void;
  /** Opens the full testing console (the quiet "Advanced testing" link). */
  onOpenAdvanced?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onAgentNameChange: (value: string) => void;
  onTabChange: (tab: BuilderTab) => void;
  onRunTest: () => void;
  onSave: () => void;
}) {
  void hasGmailFlow;

  /* IT SAID "saved" WHATEVER HAPPENED. The status message was thrown away with
     `void message`, and the dot beside it was hardcoded green, so a failed
     save and an unsaved change both read exactly like a successful one. An
     architect closed the tab believing their work was safe. */
  const saveFailed = message.startsWith("Save failed");
  const unsaved = message === "Unsaved changes";
  const dotColour = saveFailed ? "bg-red-500" : unsaved ? "bg-amber-500" : "bg-green-500";
  const saveLabel = saving ? "Saving..." : saveFailed ? message : unsaved ? "unsaved changes" : "saved";

  const activeStepIndex = BUILDER_STEPS.findIndex((step) => step.id === activeTab);

  return (
    <header className="fixed left-0 top-0 z-50 w-full border-b border-gray-200 bg-white">
      {/* Mobile: fixed toolbar + steps only — agent title lives in tab content and scrolls. */}
      <div className="flex h-11 w-full min-w-0 items-stretch px-2 md:h-14 md:px-3">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 pr-1 md:flex-none md:gap-2.5">
          <Link
            data-testid="builder-header-back-to-workflows"
            href={"/architect/agents" as Route}
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600 sm:p-2"
            aria-label="Back to My Agents"
          >
            <BuilderIcon name="arrow" className="h-[18px] w-[18px]" />
          </Link>
          <div className="hidden h-6 w-px bg-gray-200 sm:block" />
          <div className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-amber-500 text-[11px] font-extrabold text-white shadow-sm sm:flex">
            C
          </div>
          <input
            data-testid="builder-agent-name-input"
            value={agentName}
            onChange={(event) => onAgentNameChange(event.target.value)}
            disabled={locked}
            className="hidden min-w-0 flex-1 cursor-text rounded-sm border-b border-transparent bg-transparent px-0.5 text-sm font-semibold text-slate-900 outline-none transition hover:border-amber-300 focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:border-transparent md:block md:max-w-[280px] md:flex-none md:text-[15px]"
            aria-label="Agent name"
          />
          <span
            className={cn(
              "hidden shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-medium sm:inline-flex",
              locked
                ? "border-orange-100 bg-orange-50 text-orange-700"
                : isLive
                  ? "border-green-100 bg-green-50 text-green-700"
                  : "border-amber-100 bg-amber-50 text-amber-700"
            )}
            data-testid="architect-ui-workflow-builder-builder-header-draft-text"
          >
            {locked ? "In Review" : isLive ? "Live" : "Draft"}
          </span>
          <span
            className={cn(
              "h-2 w-2 shrink-0 rounded-full sm:hidden",
              locked ? "bg-orange-500" : isLive ? "bg-green-500" : "bg-amber-500",
              saving && "save-pop"
            )}
            aria-label={locked ? "In Review" : isLive ? "Live" : saving ? "Saving" : "Draft"}
          />
          <span className="ml-1 hidden items-center gap-1.5 text-xs text-slate-400 lg:flex" data-testid="architect-ui-workflow-builder-builder-header-saving-message-text">
            <span className={cn("h-1.5 w-1.5 rounded-full", dotColour, saving && "save-pop")} />
            <span
              className={cn(saveFailed && "font-semibold text-red-600", unsaved && "text-amber-600")}
              data-testid="architect-ui-workflow-builder-builder-header-saving-message-text-3"
            >
              {saveLabel}
            </span>
          </span>
        </div>

        <div className="ml-3 hidden items-stretch md:flex lg:ml-5">
          {BUILDER_STEPS.map((tab) => (
            <HeaderButton key={tab.id} onClick={() => onTabChange(tab.id)} active={activeTab === tab.id} testId={`builder-tab-${tab.id}`}>
              {tab.label}
            </HeaderButton>
          ))}
        </div>

        <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] sm:gap-2 [&::-webkit-scrollbar]:hidden">
          {showPreviewControls ? (
            <>
              {/* Compact device switcher — same height family as the header
                  buttons, zero extra chrome. The tooltip carries the promise
                  the old caption used to spell out. */}
              <div
                data-testid="preview-device-switcher"
                title="This is exactly what your customer will see."
                className="flex h-8 flex-none items-center rounded-full border border-slate-200 bg-white p-0.5"
              >
                {PREVIEW_DEVICES.map(({ id, label, icon: Icon }) => {
                  const active = previewDevice === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => onPreviewDeviceChange?.(id)}
                      aria-label={label}
                      title={label}
                      aria-pressed={active}
                      data-testid={`preview-device-${id}`}
                      className={cn(
                        "grid h-7 w-8 place-items-center rounded-full transition",
                        active ? "bg-amber-500 text-white" : "text-slate-500 hover:bg-amber-50 hover:text-amber-700"
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              {/* Width: how wide the product runs on big screens. Same pill
                  family and same 32px height as the device switcher, so the
                  toolbar never grows a second row. */}
              <label
                data-testid="preview-width-control"
                title={PREVIEW_WIDTH_HINT}
                className="flex h-8 flex-none items-center gap-1.5 rounded-full border border-slate-200 bg-white pl-3 pr-2"
              >
                <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Width
                </span>
                <span className="relative flex items-center">
                  <select
                    data-testid="preview-width-select"
                    value={previewWidth}
                    disabled={locked}
                    onChange={(event) =>
                      onPreviewWidthChange?.(event.target.value as ContentWidth)
                    }
                    aria-label="Content width"
                    className="cursor-pointer appearance-none rounded-full bg-transparent py-0.5 pl-1 pr-5 text-xs font-semibold text-slate-600 transition hover:text-amber-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {PREVIEW_WIDTHS.map(({ id, label }) => (
                      <option key={id} value={id} data-testid={`preview-width-${id}`}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-0 h-3.5 w-3.5 text-slate-400"
                    aria-hidden="true"
                  />
                </span>
              </label>
              {previewDevice === "desktop" ? (
                // Arrange: drag the page's sections anywhere (desktop view
                // only — small screens always keep the clean stacked flow).
                <button
                  type="button"
                  onClick={() => onArrangeModeChange?.(!arrangeMode)}
                  aria-pressed={arrangeMode}
                  title="Drag to arrange"
                  data-testid="preview-arrange-toggle"
                  className={cn(
                    "flex h-8 flex-none items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
                    arrangeMode
                      ? "border-amber-500 bg-amber-500 text-white"
                      : "border-slate-200 bg-white text-slate-500 hover:bg-amber-50 hover:text-amber-700"
                  )}
                >
                  <Move className="h-3.5 w-3.5" aria-hidden="true" />
                  Arrange
                </button>
              ) : null}
              {/* "Advanced testing" is dead — Rule 3 of the Preview Law. Its
                  two real organs moved where they belong: the run log into
                  Build's Run drawer, the Test Email box beside it. */}
            </>
          ) : null}
          <div className="hidden items-center gap-1 md:flex">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo || locked}
              data-testid="builder-undo"
              aria-label="Undo"
              title="Undo (Ctrl/Cmd+Z)"
              className="rounded-lg border border-gray-200 p-2 text-slate-500 transition hover:bg-gray-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 14L4 9l5-5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 9h11a5 5 0 0 1 0 10h-1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo || locked}
              data-testid="builder-redo"
              aria-label="Redo"
              title="Redo (Ctrl/Cmd+Shift+Z)"
              className="rounded-lg border border-gray-200 p-2 text-slate-500 transition hover:bg-gray-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M15 14l5-5-5-5" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 9H9a5 5 0 0 0 0 10h1" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
          <button
            type="button"
            onClick={onRunTest}
            disabled={running || saving || locked}
            data-testid="builder-run-test"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60 sm:gap-2 sm:rounded-xl sm:px-3.5 sm:py-2 sm:text-sm"
          >
            <BuilderIcon name="play" className="h-3.5 w-3.5 shrink-0" />
            <span className="sm:hidden">{running ? "…" : "Preview"}</span>
            <span className="hidden sm:inline">{running ? "Running..." : "Preview"}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              onSave();
              onTabChange("publish");
            }}
            disabled={running || saving || publishLocked}
            data-testid="builder-publish-marketplace"
            className="hidden rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 md:inline-flex"
          >
            Publish Agent
          </button>
        </div>
      </div>

      {/* Mobile step presses — replaces the dropdown */}
      <nav
        className="grid grid-cols-4 border-t border-gray-100 md:hidden"
        aria-label="Builder steps"
        data-testid="builder-mobile-steps"
      >
        {BUILDER_STEPS.map((step, index) => {
          const active = activeTab === step.id;
          const completed = index < activeStepIndex;
          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onTabChange(step.id)}
              data-testid={`builder-mobile-tab-select-${step.id}`}
              aria-current={active ? "step" : undefined}
              className={cn(
                "relative flex flex-col items-center gap-1 px-1 py-2.5 text-[11px] font-semibold transition",
                active ? "bg-amber-50 text-amber-700" : completed ? "text-slate-700" : "text-slate-400"
              )}
            >
              <span
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold",
                  active
                    ? "bg-amber-500 text-white shadow-sm"
                    : completed
                      ? "bg-amber-100 text-amber-700"
                      : "bg-gray-100 text-slate-500"
                )}
              >
                {completed && !active ? (
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  step.step
                )}
              </span>
              <span className="truncate">{step.label}</span>
              {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-amber-500" /> : null}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
