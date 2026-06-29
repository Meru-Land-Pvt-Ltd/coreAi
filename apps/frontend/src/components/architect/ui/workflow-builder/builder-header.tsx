import type { Route } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/components/architect/ui/architect-ui";
import { BuilderIcon } from "./icons";
import type { BuilderTab } from "./types";

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
        "flex items-center border-b-2 px-4 text-sm transition",
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
  deploying,
  hasGmailFlow,
  locked = false,
  onAgentNameChange,
  onMobileLibrary,
  onTabChange,
  onRunTest,
  onSave,
  onDeploy,
  onPreview
}: {
  agentName: string;
  message: string;
  activeTab: BuilderTab;
  running: boolean;
  saving: boolean;
  deploying: boolean;
  hasGmailFlow: boolean;
  locked?: boolean;
  onAgentNameChange: (value: string) => void;
  onMobileLibrary: () => void;
  onTabChange: (tab: BuilderTab) => void;
  onRunTest: () => void;
  onSave: () => void;
  onDeploy: () => void;
  onPreview?: () => void;
}) {
  return (
    <header className="fixed left-0 top-4 z-50 flex h-14 w-full items-stretch border-b border-gray-200 bg-white px-3">
      <div className="flex min-w-0 items-center gap-2.5 pr-1">
        <Link data-testid="builder-header-back-to-workflows"
          href={"/architect/agents" as Route}
          className="rounded-lg p-2 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
          aria-label="Back to My Agents"
        >
          <BuilderIcon name="arrow" className="h-[18px] w-[18px]" />
        </Link>
        <div className="hidden h-6 w-px bg-gray-200 sm:block" />
        <div className="hidden h-6 w-6 items-center justify-center rounded-md bg-gradient-to-br from-amber-400 to-amber-500 text-[11px] font-extrabold text-white shadow-sm sm:flex">
          C
        </div>
        <input data-testid="builder-agent-name-input"
          value={agentName}
          onChange={(event) => onAgentNameChange(event.target.value)}
          disabled={locked}
          className="min-w-0 max-w-[210px] cursor-text rounded-sm border-b border-transparent bg-transparent px-0.5 text-[15px] font-semibold text-slate-900 outline-none transition hover:border-amber-300 focus:border-amber-400 disabled:cursor-not-allowed disabled:opacity-70 disabled:hover:border-transparent md:max-w-[280px]"
          aria-label="Agent name"
        />
        <span
          className={cn(
            "hidden rounded-full border px-2.5 py-0.5 text-[11px] font-medium sm:inline-flex",
            locked ? "border-orange-100 bg-orange-50 text-orange-700" : "border-amber-100 bg-amber-50 text-amber-700"
          )}
          data-testid="architect-ui-workflow-builder-builder-header-draft-text"
        >
          {locked ? "In Review" : "Draft"}
        </span>
        <span className="ml-1 hidden items-center gap-1.5 text-xs text-slate-400 lg:flex" data-testid="architect-ui-workflow-builder-builder-header-saving-message-text">
          <span className={cn("h-1.5 w-1.5 rounded-full bg-green-500", saving && "save-pop")} />
          <span data-testid="architect-ui-workflow-builder-builder-header-saving-message-text-3">{saving ? "Saving..." : message}</span>
        </span>
      </div>

      <div className="ml-5 hidden items-stretch md:flex">
        {(["build", "test", "configure", "publish"] as const).map((tab) => (
          <HeaderButton key={tab} onClick={() => onTabChange(tab)} active={activeTab === tab} testId={`builder-tab-${tab}`}>
            {tab[0].toUpperCase() + tab.slice(1)}
          </HeaderButton>
        ))}
      </div>

      <div className="ml-auto flex min-w-0 items-center gap-2.5">
        <button
          type="button"
          onClick={onMobileLibrary}
          data-testid="builder-mobile-library"
          className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-semibold text-slate-600 xl:hidden"
          aria-label="Open components"
        >
          <BuilderIcon name="menu" className="h-4 w-4" />
        </button>
        <select data-testid="builder-mobile-tab-select"
          value={activeTab}
          onChange={(event) => onTabChange(event.target.value as BuilderTab)}
          className="rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm font-semibold text-slate-700 md:hidden"
          aria-label="Builder tab"
        >
          <option value="build">Build</option>
          <option value="test">Test</option>
          <option value="configure">Configure</option>
          <option value="publish">Publish</option>
        </select>
        <button
          type="button"
          onClick={onPreview}
          data-testid="builder-preview"
          className="hidden items-center gap-2 rounded-xl border border-gray-200 px-3.5 py-2 text-sm text-slate-600 transition hover:border-amber-300 hover:text-slate-800 sm:flex"
        >
          <BuilderIcon name="eye" className="h-4 w-4" />
          Preview
        </button>
        <button
          type="button"
          onClick={onRunTest}
          disabled={running || locked}
          data-testid="builder-run-test"
          className="inline-flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2 text-sm font-medium text-amber-700 transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <BuilderIcon name="play" className="h-3.5 w-3.5" />
          {running ? "Running..." : hasGmailFlow ? "Gmail Test" : "Test Run"}
        </button>
        <button
          type="button"
          onClick={onDeploy}
          disabled={deploying || saving || locked}
          data-testid="builder-deploy"
          className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <BuilderIcon name="phone-call" className="h-3.5 w-3.5" />
          {deploying ? "Deploying..." : "Deploy Live Agent"}
        </button>
        <button
          type="button"
          onClick={() => {
            onSave();
            onTabChange("publish");
          }}
          disabled={saving || locked}
          data-testid="builder-publish-marketplace"
          className="hidden rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60 md:inline-flex"
        >
          Publish to Marketplace
        </button>
        <div className="hidden h-8 w-8 select-none items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700 shadow-sm ring-2 ring-white lg:flex" title="Marcus Thompson">
          MT
        </div>
      </div>
    </header>
  );
}
