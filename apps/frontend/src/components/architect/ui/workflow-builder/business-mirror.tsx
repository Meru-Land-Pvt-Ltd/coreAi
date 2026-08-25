"use client";

/**
 * THE BUSINESS MIRROR — the Preview Law, applied to agents with no page.
 *
 * The law (the founder's, 2026-08-25): the Preview is a mirror, and it may
 * show only what a real person will see. For an agent with Face nodes that
 * person is the customer, pixel-exact. But a Timer→Brain→Email agent has no
 * customer at all — nobody ever types at it — and the Preview used to show a
 * generic chat saying "Hello, this is AI Assistant", a face for a person who
 * does not exist. A mirror showing anything but the person in front of it is
 * broken.
 *
 * The person in front of THIS mirror is the business. So it shows exactly two
 * things, both true:
 *
 *   1. The one box they will fill at setup — where replies go.
 *   2. What will actually land in their inbox — the mail from the last real
 *      run, drawn as an inbox draws it. Before any run, an honest sentence
 *      and the Run button, never an invented sample.
 */

import type { WorkflowRunLog } from "@/components/architect/features/types";

export type MirrorMail = {
  to: string;
  subject: string;
  body: string;
};

/** The mail the last run actually produced, from its own log — never invented. */
export function mailFromRunLogs(logs: WorkflowRunLog[]): MirrorMail | null {
  for (let index = logs.length - 1; index >= 0; index--) {
    const output = logs[index]?.output as
      | { to?: unknown; subject?: unknown; bodyPreview?: unknown; body?: unknown }
      | undefined;
    if (!output || typeof output.subject !== "string") continue;
    const body =
      typeof output.bodyPreview === "string"
        ? output.bodyPreview
        : typeof output.body === "string"
          ? output.body
          : "";
    if (!body && !output.subject) continue;
    return {
      to: typeof output.to === "string" ? output.to : "",
      subject: output.subject,
      body
    };
  }
  return null;
}

export function BusinessMirror({
  agentName,
  logs,
  running,
  onRun
}: {
  agentName: string;
  logs: WorkflowRunLog[];
  running: boolean;
  onRun: () => void;
}) {
  const mail = mailFromRunLogs(logs);

  return (
    <div className="absolute inset-0 overflow-y-auto bg-slate-50" data-testid="business-mirror">
      <div className="mx-auto w-full max-w-xl px-6 py-10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          What the business will see
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600" data-testid="business-mirror-intro">
          This agent has no page — it wakes by itself. The business fills one box at setup, and
          then this arrives in their inbox:
        </p>

        {/* The one setup box, exactly as the business meets it. */}
        <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4" data-testid="business-mirror-setup">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">At setup</p>
          <p className="mt-1 text-sm font-medium text-slate-800">Where should replies go?</p>
          <div className="mt-2 rounded-lg border border-gray-200 bg-slate-50 px-3 py-2 text-sm text-slate-400">
            their@business.com
          </div>
        </div>

        {/* The inbox, as an inbox draws it — or the honest empty state. */}
        {mail ? (
          <div className="mt-4 rounded-2xl border border-gray-200 bg-white shadow-sm" data-testid="business-mirror-mail">
            <div className="border-b border-gray-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-900">{mail.subject || "(no subject)"}</p>
              <p className="mt-0.5 text-[12px] text-slate-500">
                From: <span className="font-medium text-slate-700">{agentName}</span> · via triven.ai
                {mail.to ? ` · To: ${mail.to}` : ""}
              </p>
            </div>
            <p className="whitespace-pre-line px-4 py-4 text-sm leading-6 text-slate-800">{mail.body}</p>
          </div>
        ) : (
          <div
            className="mt-4 rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center"
            data-testid="business-mirror-empty"
          >
            <p className="text-sm text-slate-600">Run it once to see the exact mail they will receive.</p>
            <button
              type="button"
              onClick={onRun}
              disabled={running}
              data-testid="business-mirror-run"
              className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {running ? "Running…" : "Run"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
