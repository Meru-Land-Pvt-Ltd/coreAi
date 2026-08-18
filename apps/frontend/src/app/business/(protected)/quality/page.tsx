// [DISABLED] Front-desk feature page. The backend routes behind this page are
// currently disabled, so the page renders an inert placeholder instead of
// calling them. The full original implementation is preserved verbatim below,
// line-commented — strip the leading `// ` from that block to restore it.

export default function BusinessQualityPage() {
  return (
    <div className="p-8">
      <p className="text-sm text-slate-500" data-testid="business-quality-disabled">
        This feature is currently disabled.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// [DISABLED] ORIGINAL IMPLEMENTATION BELOW
// ---------------------------------------------------------------------------
// "use client";
//
// import { useCallback, useEffect, useState } from "react";
// import { apiGet, apiPost } from "@/lib/api";
// import { BusinessPageHeader } from "@/components/business/business-page-header";
// import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
// import {
//   EmptyState,
//   ErrorState,
//   INPUT_CLASS,
//   LoadingRows,
//   ModalShell,
//   Pill,
//   PRIMARY_BUTTON_CLASS,
//   SECONDARY_BUTTON_CLASS,
//   SectionCard,
//   formatDateTime,
//   humanizeToken,
//   type PillTone
// } from "@/components/business/features/frontdesk/ui";
//
// type TrendBucket = {
//   weekStart: string;
//   count: number;
//   averageScore: number | null;
// };
//
// type SummaryEntryCall = {
//   id: string;
//   customerPhone: string | null;
//   outcome: string | null;
//   durationSeconds: number | null;
//   startedAt: string | null;
// };
//
// type SummaryEntry = {
//   id: string;
//   vapiCallId: string | null;
//   score: number;
//   handledBy: string;
//   createdAt: string;
//   call: SummaryEntryCall | null;
// };
//
// type QualitySummary = {
//   totalEvaluations: number;
//   excludedCount: number;
//   averageScore: number | null;
//   averageConfidence: number | null;
//   dimensionAverages: Record<string, number | null>;
//   trend: TrendBucket[];
//   best: SummaryEntry[];
//   worst: SummaryEntry[];
//   missedOpportunityCount: number;
//   windowDays: number;
// };
//
// type Evaluation = {
//   id: string;
//   vapiCallId: string | null;
//   handledBy: string;
//   status: string;
//   overallScore: number;
//   adjustedScore: number | null;
//   effectiveScore: number;
//   confidence: number;
//   reviewNote: string | null;
//   createdAt: string;
// };
//
// function statusTone(status: string): PillTone {
//   if (status === "SCORED") return "green";
//   if (status === "UNDER_REVIEW") return "amber";
//   if (status === "ADJUSTED") return "blue";
//   return "slate";
// }
//
// function handledByTone(handledBy: string): PillTone {
//   if (handledBy === "AI") return "green";
//   if (handledBy === "HUMAN") return "blue";
//   return "amber";
// }
//
// function formatScore(score: number | null | undefined): string {
//   if (score === null || score === undefined || !Number.isFinite(score)) return "—";
//   return score.toFixed(1);
// }
//
// export default function BusinessQualityPage() {
//   const [summary, setSummary] = useState<QualitySummary | null>(null);
//   const [summaryState, setSummaryState] = useState<"loading" | "ready" | "error">("loading");
//   const [summaryError, setSummaryError] = useState("");
//
//   const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
//   const [evalState, setEvalState] = useState<"loading" | "ready" | "error">("loading");
//   const [evalError, setEvalError] = useState("");
//
//   const [minScore, setMinScore] = useState("");
//   const [maxScore, setMaxScore] = useState("");
//   const [handledBy, setHandledBy] = useState("");
//   const [appliedFilters, setAppliedFilters] = useState({ minScore: "", maxScore: "", handledBy: "" });
//
//   const [disputeTarget, setDisputeTarget] = useState<Evaluation | null>(null);
//   const [disputeNote, setDisputeNote] = useState("");
//   const [reviewTarget, setReviewTarget] = useState<Evaluation | null>(null);
//   const [reviewScore, setReviewScore] = useState("");
//   const [reviewNote, setReviewNote] = useState("");
//   const [modalBusy, setModalBusy] = useState(false);
//   const [modalError, setModalError] = useState("");
//
//   const loadSummary = useCallback(async () => {
//     setSummaryState("loading");
//     setSummaryError("");
//     const result = await apiGet<QualitySummary>("/business/quality/summary");
//     if (result.success && result.data) {
//       setSummary(result.data);
//       setSummaryState("ready");
//     } else {
//       setSummaryError(result.error ?? "Could not load the quality summary.");
//       setSummaryState("error");
//     }
//   }, []);
//
//   const loadEvaluations = useCallback(async () => {
//     setEvalState("loading");
//     setEvalError("");
//     const params = new URLSearchParams();
//     if (appliedFilters.minScore) params.set("minScore", appliedFilters.minScore);
//     if (appliedFilters.maxScore) params.set("maxScore", appliedFilters.maxScore);
//     if (appliedFilters.handledBy) params.set("handledBy", appliedFilters.handledBy);
//     const query = params.toString();
//     const result = await apiGet<{ evaluations: Evaluation[]; total: number }>(
//       `/business/quality/evaluations${query ? `?${query}` : ""}`
//     );
//     if (result.success && result.data) {
//       setEvaluations(result.data.evaluations ?? []);
//       setEvalState("ready");
//     } else {
//       setEvalError(result.error ?? "Could not load evaluations.");
//       setEvalState("error");
//     }
//   }, [appliedFilters]);
//
//   useEffect(() => {
//     void loadSummary();
//   }, [loadSummary]);
//
//   useEffect(() => {
//     void loadEvaluations();
//   }, [loadEvaluations]);
//
//   async function submitDispute() {
//     if (!disputeTarget || !disputeNote.trim()) return;
//     setModalBusy(true);
//     setModalError("");
//     const result = await apiPost<unknown>(`/business/quality/evaluations/${disputeTarget.id}/dispute`, {
//       note: disputeNote.trim()
//     });
//     setModalBusy(false);
//     if (!result.success) {
//       setModalError(result.error ?? "Could not submit the dispute.");
//       return;
//     }
//     setDisputeTarget(null);
//     setDisputeNote("");
//     await Promise.all([loadEvaluations(), loadSummary()]);
//   }
//
//   async function submitReview() {
//     if (!reviewTarget) return;
//     setModalBusy(true);
//     setModalError("");
//     const parsedScore = reviewScore.trim() === "" ? undefined : Number(reviewScore);
//     if (parsedScore !== undefined && (!Number.isFinite(parsedScore) || parsedScore < 0 || parsedScore > 10)) {
//       setModalBusy(false);
//       setModalError("Adjusted score must be between 0 and 10.");
//       return;
//     }
//     const result = await apiPost<unknown>(`/business/quality/evaluations/${reviewTarget.id}/review`, {
//       ...(parsedScore !== undefined ? { adjustedScore: parsedScore } : {}),
//       note: reviewNote.trim()
//     });
//     setModalBusy(false);
//     if (!result.success) {
//       setModalError(result.error ?? "Could not save the review.");
//       return;
//     }
//     setReviewTarget(null);
//     setReviewScore("");
//     setReviewNote("");
//     await Promise.all([loadEvaluations(), loadSummary()]);
//   }
//
//   const trend = summary?.trend ?? [];
//   const dimensions = Object.entries(summary?.dimensionAverages ?? {});
//
//   return (
//     <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="quality-page">
//       <BusinessPageHeader
//         className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
//         title="Conversation Quality"
//         description="Every conversation scored on the same rubric, whether AI or human handled it."
//         actions={(
//           <button
//             type="button"
//             onClick={() => {
//               void loadSummary();
//               void loadEvaluations();
//             }}
//             className={SECONDARY_BUTTON_CLASS}
//             data-testid="quality-refresh-button"
//           >
//             Refresh
//           </button>
//         )}
//       />
//
//       <FrontDeskNav />
//
//       {summaryState === "loading" ? (
//         <SectionCard className="mb-4 sm:mb-6">
//           <LoadingRows rows={2} testId="quality-summary-loading" />
//         </SectionCard>
//       ) : summaryState === "error" ? (
//         <SectionCard className="mb-4 sm:mb-6">
//           <ErrorState message={summaryError} onRetry={() => void loadSummary()} testId="quality-summary-error" />
//         </SectionCard>
//       ) : summary ? (
//         <>
//           <section
//             aria-label="Quality summary"
//             className="mb-4 grid grid-cols-2 gap-3 sm:mb-6 sm:gap-4 xl:grid-cols-4"
//             data-testid="quality-summary-tiles"
//           >
//             <StatTile label="Average score" value={formatScore(summary.averageScore)} suffix="/ 10" testId="quality-tile-average" />
//             <StatTile
//               label="Evaluations"
//               value={String(summary.totalEvaluations)}
//               suffix={summary.excludedCount > 0 ? `${summary.excludedCount} excluded` : `last ${summary.windowDays} days`}
//               testId="quality-tile-evaluations"
//             />
//             <StatTile
//               label="Avg confidence"
//               value={summary.averageConfidence === null ? "—" : `${Math.round(summary.averageConfidence * 100)}%`}
//               suffix="scoring confidence"
//               testId="quality-tile-confidence"
//             />
//             <StatTile
//               label="Missed opportunities"
//               value={String(summary.missedOpportunityCount)}
//               suffix="flagged in conversations"
//               testId="quality-tile-missed"
//             />
//           </section>
//
//           <div className="mb-4 grid min-w-0 grid-cols-1 gap-4 sm:mb-6 sm:gap-6 xl:grid-cols-3">
//             <SectionCard title="Weekly trend" subtitle="Average score per week, 0–10." className="xl:col-span-2" testId="quality-trend">
//               <div className="px-4 py-5 sm:px-6">
//                 <div className="flex h-40 items-end gap-2">
//                   {trend.map((bucket) => {
//                     const hasData = bucket.averageScore !== null && bucket.count > 0;
//                     const height = hasData ? Math.max(4, ((bucket.averageScore ?? 0) / 10) * 100) : 0;
//                     return (
//                       <div key={bucket.weekStart} className="group relative flex h-full flex-1 items-end">
//                         {hasData ? (
//                           <div
//                             className="w-full rounded-t bg-amber-300 transition-colors group-hover:bg-amber-500"
//                             style={{ height: `${height}%` }}
//                           />
//                         ) : (
//                           <div className="w-full rounded-t border border-dashed border-slate-200" style={{ height: "4px" }} />
//                         )}
//                         <div className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 rounded-lg bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg group-hover:block">
//                           <div className="whitespace-nowrap text-[11px] text-slate-300">Week of {bucket.weekStart}</div>
//                           <div className="whitespace-nowrap font-semibold">
//                             {hasData ? `${formatScore(bucket.averageScore)} avg · ${bucket.count} eval${bucket.count === 1 ? "" : "s"}` : "No evaluations"}
//                           </div>
//                         </div>
//                       </div>
//                     );
//                   })}
//                 </div>
//                 <div className="mt-2 flex justify-between text-[10px] text-slate-400 sm:text-xs">
//                   <span>{trend[0]?.weekStart ?? ""}</span>
//                   <span>{trend[trend.length - 1]?.weekStart ?? ""}</span>
//                 </div>
//               </div>
//             </SectionCard>
//
//             <SectionCard title="Dimensions" subtitle="Rubric averages across all evaluations." testId="quality-dimensions">
//               <div className="space-y-3 px-4 py-5 sm:px-6">
//                 {dimensions.length === 0 ? (
//                   <p className="text-sm text-slate-400">No dimension data yet.</p>
//                 ) : (
//                   dimensions.map(([key, value]) => (
//                     <div key={key} data-testid={`quality-dimension-${key}`}>
//                       <div className="mb-1 flex items-center justify-between text-xs">
//                         <span className="font-medium text-slate-600">{humanizeToken(key)}</span>
//                         <span className="font-semibold text-slate-900">{formatScore(value)}</span>
//                       </div>
//                       <div className="h-2 overflow-hidden rounded-full bg-gray-100">
//                         <div
//                           className="h-full rounded-full bg-amber-400"
//                           style={{ width: `${Math.min(100, Math.max(0, ((value ?? 0) / 10) * 100))}%` }}
//                         />
//                       </div>
//                     </div>
//                   ))
//                 )}
//               </div>
//             </SectionCard>
//           </div>
//
//           <div className="mb-4 grid min-w-0 grid-cols-1 gap-4 sm:mb-6 sm:gap-6 lg:grid-cols-2">
//             <BestWorstCard title="Best conversations" entries={summary.best} testId="quality-best" />
//             <BestWorstCard title="Needs attention" entries={summary.worst} testId="quality-worst" />
//           </div>
//         </>
//       ) : null}
//
//       <SectionCard
//         title="Evaluations"
//         subtitle="Dispute a score you disagree with, or adjust it as a manager."
//         testId="quality-evaluations-card"
//       >
//         <div className="flex flex-wrap items-end gap-2 border-b border-gray-100 px-4 py-3 sm:px-6">
//           <label className="block">
//             <span className="mb-1 block text-xs font-semibold text-slate-500">Min score</span>
//             <input
//               type="number"
//               min={0}
//               max={10}
//               step="0.5"
//               value={minScore}
//               onChange={(event) => setMinScore(event.target.value)}
//               className={`${INPUT_CLASS} w-24`}
//               data-testid="quality-filter-min-input"
//             />
//           </label>
//           <label className="block">
//             <span className="mb-1 block text-xs font-semibold text-slate-500">Max score</span>
//             <input
//               type="number"
//               min={0}
//               max={10}
//               step="0.5"
//               value={maxScore}
//               onChange={(event) => setMaxScore(event.target.value)}
//               className={`${INPUT_CLASS} w-24`}
//               data-testid="quality-filter-max-input"
//             />
//           </label>
//           <label className="block">
//             <span className="mb-1 block text-xs font-semibold text-slate-500">Handled by</span>
//             <select
//               value={handledBy}
//               onChange={(event) => setHandledBy(event.target.value)}
//               className={`${INPUT_CLASS} w-32`}
//               data-testid="quality-filter-handledby-select"
//             >
//               <option value="">All</option>
//               <option value="AI">AI</option>
//               <option value="HUMAN">Human</option>
//               <option value="MIXED">Mixed</option>
//             </select>
//           </label>
//           <button
//             type="button"
//             onClick={() => setAppliedFilters({ minScore, maxScore, handledBy })}
//             className={SECONDARY_BUTTON_CLASS}
//             data-testid="quality-filter-apply-button"
//           >
//             Apply filters
//           </button>
//         </div>
//
//         {evalState === "loading" ? (
//           <LoadingRows rows={4} testId="quality-evaluations-loading" />
//         ) : evalState === "error" ? (
//           <ErrorState message={evalError} onRetry={() => void loadEvaluations()} testId="quality-evaluations-error" />
//         ) : evaluations.length === 0 ? (
//           <EmptyState
//             title="No evaluations yet"
//             hint="Scores appear automatically after conversations finish."
//             testId="quality-evaluations-empty"
//           />
//         ) : (
//           <div className="overflow-x-auto">
//             <table className="w-full min-w-[720px] text-left text-sm" data-testid="quality-evaluations-table">
//               <thead>
//                 <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
//                   <th className="px-4 py-3 sm:px-6">When</th>
//                   <th className="px-3 py-3">Handled by</th>
//                   <th className="px-3 py-3">Score</th>
//                   <th className="px-3 py-3">Confidence</th>
//                   <th className="px-3 py-3">Status</th>
//                   <th className="px-3 py-3">Actions</th>
//                 </tr>
//               </thead>
//               <tbody className="divide-y divide-gray-50">
//                 {evaluations.map((evaluation) => (
//                   <tr key={evaluation.id} data-testid={`quality-eval-row-${evaluation.id}`}>
//                     <td className="px-4 py-3 text-slate-600 sm:px-6">{formatDateTime(evaluation.createdAt)}</td>
//                     <td className="px-3 py-3">
//                       <Pill tone={handledByTone(evaluation.handledBy)}>{humanizeToken(evaluation.handledBy)}</Pill>
//                     </td>
//                     <td className="px-3 py-3">
//                       <span className="font-bold text-slate-900">{formatScore(evaluation.effectiveScore)}</span>
//                       {evaluation.adjustedScore !== null ? (
//                         <span className="ml-1.5 text-xs text-slate-400" title={`Original: ${formatScore(evaluation.overallScore)}`}>
//                           adjusted
//                         </span>
//                       ) : null}
//                     </td>
//                     <td className="px-3 py-3 text-slate-600">{Math.round(evaluation.confidence * 100)}%</td>
//                     <td className="px-3 py-3">
//                       <Pill tone={statusTone(evaluation.status)} title={evaluation.reviewNote ?? undefined}>
//                         {humanizeToken(evaluation.status)}
//                       </Pill>
//                     </td>
//                     <td className="px-3 py-3">
//                       <div className="flex items-center gap-2">
//                         <button
//                           type="button"
//                           onClick={() => {
//                             setModalError("");
//                             setDisputeNote("");
//                             setDisputeTarget(evaluation);
//                           }}
//                           className={SECONDARY_BUTTON_CLASS}
//                           data-testid={`quality-dispute-button-${evaluation.id}`}
//                         >
//                           Dispute
//                         </button>
//                         <button
//                           type="button"
//                           onClick={() => {
//                             setModalError("");
//                             setReviewScore(evaluation.adjustedScore !== null ? String(evaluation.adjustedScore) : "");
//                             setReviewNote(evaluation.reviewNote ?? "");
//                             setReviewTarget(evaluation);
//                           }}
//                           className={SECONDARY_BUTTON_CLASS}
//                           data-testid={`quality-review-button-${evaluation.id}`}
//                         >
//                           Review
//                         </button>
//                       </div>
//                     </td>
//                   </tr>
//                 ))}
//               </tbody>
//             </table>
//           </div>
//         )}
//       </SectionCard>
//
//       {disputeTarget ? (
//         <ModalShell title="Dispute this score" onClose={() => setDisputeTarget(null)} testId="quality-dispute-modal">
//           <p className="text-sm text-slate-600">
//             Tell your manager why this score looks wrong. The original score stays until a manager reviews it.
//           </p>
//           <textarea
//             value={disputeNote}
//             onChange={(event) => setDisputeNote(event.target.value)}
//             rows={3}
//             placeholder="What did the scorer miss?"
//             className={`${INPUT_CLASS} mt-3 resize-none`}
//             data-testid="quality-dispute-note-input"
//           />
//           {modalError ? <p className="mt-2 text-sm font-semibold text-red-600">{modalError}</p> : null}
//           <div className="mt-4 flex justify-end gap-2">
//             <button type="button" onClick={() => setDisputeTarget(null)} className={SECONDARY_BUTTON_CLASS}>
//               Cancel
//             </button>
//             <button
//               type="button"
//               onClick={() => void submitDispute()}
//               disabled={modalBusy || !disputeNote.trim()}
//               className={PRIMARY_BUTTON_CLASS}
//               data-testid="quality-dispute-submit-button"
//             >
//               {modalBusy ? "Submitting…" : "Submit dispute"}
//             </button>
//           </div>
//         </ModalShell>
//       ) : null}
//
//       {reviewTarget ? (
//         <ModalShell title="Review evaluation" onClose={() => setReviewTarget(null)} testId="quality-review-modal">
//           <p className="text-sm text-slate-600">
//             Set an adjusted score (leave blank to clear an adjustment and return to the original score of{" "}
//             <strong>{formatScore(reviewTarget.overallScore)}</strong>).
//           </p>
//           <div className="mt-3 grid grid-cols-2 gap-3">
//             <label className="block">
//               <span className="mb-1 block text-xs font-semibold text-slate-500">Adjusted score (0–10)</span>
//               <input
//                 type="number"
//                 min={0}
//                 max={10}
//                 step="0.5"
//                 value={reviewScore}
//                 onChange={(event) => setReviewScore(event.target.value)}
//                 className={INPUT_CLASS}
//                 data-testid="quality-review-score-input"
//               />
//             </label>
//           </div>
//           <label className="mt-3 block">
//             <span className="mb-1 block text-xs font-semibold text-slate-500">Note</span>
//             <textarea
//               value={reviewNote}
//               onChange={(event) => setReviewNote(event.target.value)}
//               rows={3}
//               className={`${INPUT_CLASS} resize-none`}
//               data-testid="quality-review-note-input"
//             />
//           </label>
//           {modalError ? <p className="mt-2 text-sm font-semibold text-red-600">{modalError}</p> : null}
//           <div className="mt-4 flex justify-end gap-2">
//             <button type="button" onClick={() => setReviewTarget(null)} className={SECONDARY_BUTTON_CLASS}>
//               Cancel
//             </button>
//             <button
//               type="button"
//               onClick={() => void submitReview()}
//               disabled={modalBusy}
//               className={PRIMARY_BUTTON_CLASS}
//               data-testid="quality-review-submit-button"
//             >
//               {modalBusy ? "Saving…" : "Save review"}
//             </button>
//           </div>
//         </ModalShell>
//       ) : null}
//     </main>
//   );
// }
//
// function StatTile({
//   label,
//   value,
//   suffix,
//   testId
// }: {
//   label: string;
//   value: string;
//   suffix?: string;
//   testId?: string;
// }) {
//   return (
//     <article className="min-w-0 rounded-2xl border border-gray-100 bg-white p-4 shadow-sm sm:p-5" data-testid={testId}>
//       <p className="text-sm font-medium text-slate-500">{label}</p>
//       <p className="mt-1 text-3xl font-black tracking-tight text-slate-900">{value}</p>
//       {suffix ? <p className="mt-1 text-xs text-slate-400">{suffix}</p> : null}
//     </article>
//   );
// }
//
// function BestWorstCard({ title, entries, testId }: { title: string; entries: SummaryEntry[]; testId: string }) {
//   return (
//     <SectionCard title={title} testId={testId}>
//       {entries.length === 0 ? (
//         <EmptyState title="Nothing here yet" />
//       ) : (
//         <div className="divide-y divide-gray-50">
//           {entries.map((entry) => (
//             <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6" data-testid={`${testId}-entry-${entry.id}`}>
//               <div className="min-w-0">
//                 <p className="truncate text-sm font-semibold text-slate-900">
//                   {entry.call?.customerPhone || "Unknown caller"}
//                 </p>
//                 <p className="text-xs text-slate-400">
//                   {humanizeToken(entry.handledBy)}
//                   {entry.call?.outcome ? ` · ${humanizeToken(entry.call.outcome)}` : ""} · {formatDateTime(entry.createdAt)}
//                 </p>
//               </div>
//               <span className="shrink-0 text-lg font-black tracking-tight text-slate-900">{formatScore(entry.score)}</span>
//             </div>
//           ))}
//         </div>
//       )}
//     </SectionCard>
//   );
// }
