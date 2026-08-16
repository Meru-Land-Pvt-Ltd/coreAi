import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/architect/ui/architect-ui";
import { BuilderIcon } from "./icons";
import type { BuilderTab } from "./types";

const BUILDER_STEPS: Array<{ id: BuilderTab; label: string; step: number }> = [
  { id: "build", label: "Build", step: 1 },
  { id: "test", label: "Test", step: 2 },
  { id: "configure", label: "Configure", step: 3 },
  { id: "publish", label: "Publish", step: 4 }
];

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
  onUndo?: () => void;
  onRedo?: () => void;
  onAgentNameChange: (value: string) => void;
  onTabChange: (tab: BuilderTab) => void;
  onRunTest: () => void;
  onSave: () => void;
}) {
  void message;
  void hasGmailFlow;

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
            <span className={cn("h-1.5 w-1.5 rounded-full bg-green-500", saving && "save-pop")} />
            <span data-testid="architect-ui-workflow-builder-builder-header-saving-message-text-3">{saving ? "Saving..." : "saved"}</span>
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
            <span className="sm:hidden">{running ? "…" : "Test"}</span>
            <span className="hidden sm:inline">{running ? "Running..." : "Test Workflow"}</span>
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
