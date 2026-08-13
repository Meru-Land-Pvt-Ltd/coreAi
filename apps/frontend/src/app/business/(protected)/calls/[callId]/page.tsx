"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useParams } from "next/navigation";
import { apiGet } from "@/lib/api";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  Pill,
  SectionCard,
  formatDateTime,
  formatDuration,
  humanizeToken
} from "@/components/business/features/frontdesk/ui";
import { handoffTone, outcomeTone, sentimentTone } from "@/components/business/features/frontdesk/call-tones";

type CallDetail = {
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
  transcript: string | null;
  summary: string | null;
  installedAgentId: string | null;
};

type HandoffAttempt = {
  attemptOrder: number;
  teamMemberId: string | null;
  destination: string | null;
  startedAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  outcome: string | null;
};

type Handoff = {
  id: string;
  status: string;
  reason: string | null;
  destination: string | null;
  assignedTeamMemberId: string | null;
  attemptsCount: number;
  waitSeconds: number | null;
  connectedAt: string | null;
  createdAt: string;
  resolvedAt: string | null;
  attempts: HandoffAttempt[];
};

type CallDetailResponse = {
  call: CallDetail;
  handoffs: Handoff[];
};

export default function BusinessCallDetailPage() {
  const params = useParams<{ callId: string }>();
  const callId = params?.callId ?? "";

  const [call, setCall] = useState<CallDetail | null>(null);
  const [handoffs, setHandoffs] = useState<Handoff[]>([]);
  const [pageState, setPageState] = useState<"loading" | "ready" | "error">("loading");
  const [pageError, setPageError] = useState("");

  const loadCall = useCallback(async () => {
    if (!callId) return;
    setPageState("loading");
    setPageError("");
    const result = await apiGet<CallDetailResponse>(`/business/calls/${callId}`);
    if (result.success && result.data?.call) {
      setCall(result.data.call);
      setHandoffs(result.data.handoffs ?? []);
      setPageState("ready");
    } else {
      setPageError(result.error ?? "Could not load the call.");
      setPageState("error");
    }
  }, [callId]);

  useEffect(() => {
    void loadCall();
  }, [loadCall]);

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="call-detail-page">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
        title={call?.customerPhone || "Call details"}
        description={call?.startedAt ? `Started ${formatDateTime(call.startedAt)}` : "Recording, transcript, and handoff trail."}
        actions={(
          <Link href={"/business/calls" as Route} className="inline-flex items-center gap-1 text-sm font-medium text-amber-600 transition-colors hover:text-amber-700" data-testid="call-back-link">
            ← All calls
          </Link>
        )}
      />

      <FrontDeskNav />

      {pageState === "loading" ? (
        <SectionCard>
          <LoadingRows rows={4} testId="call-detail-loading" />
        </SectionCard>
      ) : pageState === "error" ? (
        <SectionCard>
          <ErrorState message={pageError} onRetry={() => void loadCall()} testId="call-detail-error" />
        </SectionCard>
      ) : call ? (
        <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
          <div className="min-w-0 space-y-4 sm:space-y-6 xl:col-span-1">
            <SectionCard title="Call info" testId="call-info-card">
              <div className="space-y-3 px-4 py-4 sm:px-6">
                <InfoRow label="Customer" value={call.customerPhone || "Unknown"} />
                <InfoRow label="Started" value={formatDateTime(call.startedAt)} />
                <InfoRow label="Ended" value={formatDateTime(call.endedAt)} />
                <InfoRow label="Duration" value={formatDuration(call.durationSeconds)} />
                <InfoRow label="Status" value={humanizeToken(call.status)} />
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-slate-500">Outcome</span>
                  {call.outcome ? <Pill tone={outcomeTone(call.outcome)}>{humanizeToken(call.outcome)}</Pill> : <span className="text-slate-300">—</span>}
                </div>
                <div className="flex justify-between gap-4 text-sm">
                  <span className="text-slate-500">Sentiment</span>
                  {call.sentiment ? <Pill tone={sentimentTone(call.sentiment)}>{humanizeToken(call.sentiment)}</Pill> : <span className="text-slate-300">—</span>}
                </div>
              </div>
            </SectionCard>

            {call.recordingUrl ? (
              <SectionCard title="Recording" testId="call-recording-card">
                <div className="px-4 py-4 sm:px-6">
                  <audio controls src={call.recordingUrl} className="w-full" data-testid="call-audio" />
                </div>
              </SectionCard>
            ) : null}

            <SectionCard title="Handoffs" testId="call-handoffs-card">
              {handoffs.length === 0 ? (
                <EmptyState title="No human handoff on this call" testId="call-handoffs-empty" />
              ) : (
                <div className="divide-y divide-gray-50" data-testid="call-handoffs">
                  {handoffs.map((handoff) => (
                    <div key={handoff.id} className="px-4 py-4 sm:px-6" data-testid={`call-handoff-${handoff.id}`}>
                      <div className="flex flex-wrap items-center gap-2">
                        <Pill tone={handoffTone(handoff.status)}>{humanizeToken(handoff.status)}</Pill>
                        <span className="text-xs text-slate-400">{formatDateTime(handoff.createdAt)}</span>
                      </div>
                      {handoff.reason ? <p className="mt-1 text-sm text-slate-600">{handoff.reason}</p> : null}
                      <p className="mt-1 text-xs text-slate-400">
                        {handoff.destination ? `To ${handoff.destination} · ` : ""}
                        {handoff.attemptsCount} attempt{handoff.attemptsCount === 1 ? "" : "s"}
                        {handoff.waitSeconds !== null ? ` · waited ${formatDuration(handoff.waitSeconds)}` : ""}
                        {handoff.connectedAt ? ` · connected ${formatDateTime(handoff.connectedAt)}` : ""}
                      </p>
                      {handoff.attempts.length > 0 ? (
                        <ul className="mt-2 space-y-1">
                          {handoff.attempts.map((attempt) => (
                            <li key={attempt.attemptOrder} className="text-xs text-slate-500">
                              #{attempt.attemptOrder} → {attempt.destination || "unknown"} ·{" "}
                              {humanizeToken(attempt.outcome) || "pending"}
                              {attempt.connectedAt ? ` · connected ${formatDateTime(attempt.connectedAt)}` : ""}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          <div className="min-w-0 space-y-4 sm:space-y-6 xl:col-span-2">
            <SectionCard title="Summary" testId="call-summary-card">
              <div className="px-4 py-4 sm:px-6">
                {call.summary ? (
                  <p className="whitespace-pre-wrap text-sm text-slate-700" data-testid="call-summary">
                    {call.summary}
                  </p>
                ) : (
                  <p className="text-sm text-slate-400" data-testid="call-summary-empty">
                    No summary was generated for this call.
                  </p>
                )}
              </div>
            </SectionCard>

            <SectionCard title="Transcript" testId="call-transcript-card">
              <div className="px-4 py-4 sm:px-6">
                {call.transcript ? (
                  <pre
                    className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-4 font-mono text-xs leading-relaxed text-slate-700"
                    data-testid="call-transcript"
                  >
                    {call.transcript}
                  </pre>
                ) : (
                  <p className="text-sm text-slate-400" data-testid="call-transcript-empty">
                    No transcript is available for this call.
                  </p>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="shrink-0 text-slate-500">{label}</span>
      <span className="min-w-0 break-words text-right font-semibold text-slate-900">{value}</span>
    </div>
  );
}
