"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { apiGet } from "@/lib/api";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  Pill,
  SECONDARY_BUTTON_CLASS,
  SectionCard,
  formatDateTime,
  formatDuration,
  humanizeToken
} from "@/components/business/features/frontdesk/ui";
import { handoffTone, outcomeTone, sentimentTone } from "@/components/business/features/frontdesk/call-tones";

type CallRow = {
  id: string;
  callId: string;
  customerPhone: string | null;
  customerId?: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number | null;
  status: string | null;
  outcome: string | null;
  sentiment: string | null;
  recordingUrl: string | null;
  handoffStatus: string | null;
};

export default function BusinessCallsPage() {
  const [calls, setCalls] = useState<CallRow[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("");
  const [outcomeOptions, setOutcomeOptions] = useState<string[]>([]);

  const loadCalls = useCallback(async () => {
    setListState("loading");
    setListError("");
    const params = new URLSearchParams({ limit: "100" });
    if (outcomeFilter) params.set("outcome", outcomeFilter);
    const result = await apiGet<{ calls: CallRow[] }>(`/business/calls?${params.toString()}`);
    if (result.success && result.data) {
      const rows = result.data.calls ?? [];
      setCalls(rows);
      if (!outcomeFilter) {
        setOutcomeOptions([...new Set(rows.map((row) => row.outcome).filter((v): v is string => Boolean(v)))].sort());
      }
      setListState("ready");
    } else {
      setListError(result.error ?? "Could not load your calls.");
      setListState("error");
    }
  }, [outcomeFilter]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="calls-page">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
        title="Calls"
        description="Live call history with recordings, transcripts, and handoff outcomes."
        actions={(
          <button type="button" onClick={() => void loadCalls()} className={SECONDARY_BUTTON_CLASS} data-testid="calls-refresh-button">
            Refresh
          </button>
        )}
      />

      <FrontDeskNav />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <select
          value={outcomeFilter}
          onChange={(event) => setOutcomeFilter(event.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-slate-600 focus:border-amber-400 focus:outline-none"
          data-testid="calls-outcome-filter"
          aria-label="Filter by outcome"
        >
          <option value="">All outcomes</option>
          {outcomeOptions.map((option) => (
            <option key={option} value={option}>
              {humanizeToken(option)}
            </option>
          ))}
        </select>
      </div>

      <SectionCard testId="calls-list-card">
        {listState === "loading" ? (
          <LoadingRows rows={5} testId="calls-list-loading" />
        ) : listState === "error" ? (
          <ErrorState message={listError} onRetry={() => void loadCalls()} testId="calls-list-error" />
        ) : calls.length === 0 ? (
          <EmptyState
            title="No calls yet"
            hint="Live calls handled by your agents will appear here."
            testId="calls-list-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm" data-testid="calls-list">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 sm:px-6">Started</th>
                  <th className="px-3 py-3">Customer</th>
                  <th className="px-3 py-3">Duration</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Outcome</th>
                  <th className="px-3 py-3">Sentiment</th>
                  <th className="px-3 py-3">Handoff</th>
                  <th className="px-3 py-3" aria-label="Open" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {calls.map((call) => (
                  <tr key={call.id} className="transition-colors hover:bg-gray-50" data-testid={`calls-row-${call.id}`}>
                    <td className="px-4 py-3 text-slate-600 sm:px-6">{formatDateTime(call.startedAt)}</td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{call.customerPhone || "Unknown"}</td>
                    <td className="px-3 py-3 text-slate-600">{formatDuration(call.durationSeconds)}</td>
                    <td className="px-3 py-3 text-slate-600">{humanizeToken(call.status)}</td>
                    <td className="px-3 py-3">
                      {call.outcome ? <Pill tone={outcomeTone(call.outcome)}>{humanizeToken(call.outcome)}</Pill> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {call.sentiment ? <Pill tone={sentimentTone(call.sentiment)}>{humanizeToken(call.sentiment)}</Pill> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      {call.handoffStatus ? <Pill tone={handoffTone(call.handoffStatus)}>{humanizeToken(call.handoffStatus)}</Pill> : <span className="text-slate-300">—</span>}
                    </td>
                    <td className="px-3 py-3">
                      <Link
                        href={`/business/calls/${call.id}` as Route}
                        className="text-sm font-medium text-amber-600 transition-colors hover:text-amber-700"
                        data-testid={`calls-open-link-${call.id}`}
                      >
                        View →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </main>
  );
}
