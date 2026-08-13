"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
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
  humanizeToken
} from "@/components/business/features/frontdesk/ui";

type GapQuestion = {
  id: string;
  installedAgentId: string | null;
  channel: string;
  question: string;
  count: number;
  lastAskedAt: string;
  status: string;
  resolvedAt: string | null;
  createdAt: string;
};

type StatusFilter = "" | "OPEN" | "RESOLVED";

const FILTERS: Array<{ key: string; label: string; value: StatusFilter }> = [
  { key: "open", label: "Open", value: "OPEN" },
  { key: "resolved", label: "Resolved", value: "RESOLVED" },
  { key: "all", label: "All", value: "" }
];

export default function BusinessKnowledgeGapsPage() {
  const [filter, setFilter] = useState<StatusFilter>("OPEN");
  const [questions, setQuestions] = useState<GapQuestion[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");
  const [resolveBusy, setResolveBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const loadQuestions = useCallback(async () => {
    setListState("loading");
    setListError("");
    const path = filter ? `/business/knowledge-v2/gaps?status=${filter}` : "/business/knowledge-v2/gaps";
    const result = await apiGet<{ questions: GapQuestion[] }>(path);
    if (result.success && result.data) {
      setQuestions(result.data.questions ?? []);
      setListState("ready");
    } else {
      setListError(result.error ?? "Could not load knowledge gaps.");
      setListState("error");
    }
  }, [filter]);

  useEffect(() => {
    void loadQuestions();
  }, [loadQuestions]);

  async function resolveQuestion(id: string) {
    setResolveBusy(id);
    setActionError("");
    const result = await apiPost<{ question: GapQuestion }>(`/business/knowledge-v2/gaps/${id}/resolve`, {});
    setResolveBusy(null);
    if (!result.success) {
      setActionError(result.error ?? "Could not resolve the question.");
      return;
    }
    await loadQuestions();
  }

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="knowledge-gaps-page">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
        title="Knowledge Gaps"
        description="Questions your AI could not answer — add the answer to your knowledge, then resolve."
        actions={(
          <button
            type="button"
            onClick={() => void loadQuestions()}
            className={SECONDARY_BUTTON_CLASS}
            data-testid="knowledge-gaps-refresh-button"
          >
            Refresh
          </button>
        )}
      />

      <FrontDeskNav />

      <div className="mb-4 flex gap-1 rounded-xl bg-gray-50 p-1 w-max" role="tablist" aria-label="Gap status">
        {FILTERS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={filter === item.value}
            onClick={() => setFilter(item.value)}
            data-testid={`knowledge-gaps-filter-${item.key}`}
            className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
              filter === item.value
                ? "bg-amber-50 font-semibold text-amber-700"
                : "font-medium text-slate-500 hover:text-slate-700"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {actionError ? (
        <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600" data-testid="knowledge-gaps-action-error">
          {actionError}
        </p>
      ) : null}

      <SectionCard testId="knowledge-gaps-card">
        {listState === "loading" ? (
          <LoadingRows rows={4} testId="knowledge-gaps-loading" />
        ) : listState === "error" ? (
          <ErrorState message={listError} onRetry={() => void loadQuestions()} testId="knowledge-gaps-error" />
        ) : questions.length === 0 ? (
          <EmptyState
            title={filter === "OPEN" ? "No open knowledge gaps" : "Nothing here"}
            hint="When callers ask something your AI cannot answer, the question lands here."
            testId="knowledge-gaps-empty"
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm" data-testid="knowledge-gaps-list">
              <thead>
                <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-3 sm:px-6">Question</th>
                  <th className="px-3 py-3">Channel</th>
                  <th className="px-3 py-3">Times asked</th>
                  <th className="px-3 py-3">Last asked</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3" aria-label="Actions" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {questions.map((question) => (
                  <tr key={question.id} data-testid={`knowledge-gaps-row-${question.id}`}>
                    <td className="max-w-md px-4 py-3 sm:px-6">
                      <p className="font-medium text-slate-900">{question.question}</p>
                    </td>
                    <td className="px-3 py-3 text-slate-600">{humanizeToken(question.channel)}</td>
                    <td className="px-3 py-3 font-semibold text-slate-900">{question.count}</td>
                    <td className="px-3 py-3 text-slate-600">{formatDateTime(question.lastAskedAt)}</td>
                    <td className="px-3 py-3">
                      <Pill tone={question.status === "OPEN" ? "amber" : "green"}>
                        {humanizeToken(question.status)}
                      </Pill>
                    </td>
                    <td className="px-3 py-3">
                      {question.status === "OPEN" ? (
                        <button
                          type="button"
                          onClick={() => void resolveQuestion(question.id)}
                          disabled={resolveBusy !== null}
                          className={SECONDARY_BUTTON_CLASS}
                          data-testid={`knowledge-gaps-resolve-button-${question.id}`}
                        >
                          {resolveBusy === question.id ? "Resolving…" : "Mark resolved"}
                        </button>
                      ) : null}
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
