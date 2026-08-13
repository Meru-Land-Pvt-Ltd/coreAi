"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { apiGet, apiPost } from "@/lib/api";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
import {
  EmptyState,
  ErrorState,
  INPUT_CLASS,
  LoadingRows,
  Pill,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  SectionCard,
  formatRelativeTime,
  humanizeToken
} from "@/components/business/features/frontdesk/ui";

type CustomerIdentity = {
  id: string;
  kind: string;
  value: string;
  confidence: string;
  source?: string | null;
};

type CustomerRow = {
  id: string;
  displayName: string | null;
  primaryPhone: string | null;
  primaryEmail: string | null;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string | null;
  identities?: CustomerIdentity[];
};

type SuggestionCustomer = {
  id: string;
  displayName?: string | null;
  primaryPhone?: string | null;
  primaryEmail?: string | null;
  status?: string;
};

type MergeSuggestion = {
  id: string;
  reason: string;
  score: number;
  status: string;
  createdAt: string;
  customerA: SuggestionCustomer;
  customerB: SuggestionCustomer;
};

function customerLabel(customer: SuggestionCustomer | CustomerRow): string {
  return (
    ("displayName" in customer ? customer.displayName : null) ||
    customer.primaryPhone ||
    customer.primaryEmail ||
    customer.id
  );
}

export default function BusinessCustomersPage() {
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");

  const [suggestions, setSuggestions] = useState<MergeSuggestion[]>([]);
  const [suggestionBusy, setSuggestionBusy] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState("");

  const loadCustomers = useCallback(async (q: string) => {
    setListState("loading");
    setListError("");
    const path = q ? `/business/customers?q=${encodeURIComponent(q)}` : "/business/customers";
    const result = await apiGet<{ customers: CustomerRow[] }>(path);
    if (result.success && result.data) {
      setCustomers(result.data.customers ?? []);
      setListState("ready");
    } else {
      setListError(result.error ?? "Could not load customers.");
      setListState("error");
    }
  }, []);

  const loadSuggestions = useCallback(async () => {
    const result = await apiGet<{ suggestions: MergeSuggestion[] }>("/business/customers/suggestions");
    if (result.success && result.data) {
      setSuggestions(result.data.suggestions ?? []);
    }
  }, []);

  useEffect(() => {
    void loadCustomers(activeQuery);
  }, [activeQuery, loadCustomers]);

  useEffect(() => {
    void loadSuggestions();
  }, [loadSuggestions]);

  async function mergeSuggestion(suggestion: MergeSuggestion) {
    setSuggestionBusy(suggestion.id);
    setSuggestionError("");
    const result = await apiPost<unknown>(`/business/customers/${suggestion.customerA.id}/merge`, {
      mergedCustomerId: suggestion.customerB.id
    });
    setSuggestionBusy(null);
    if (!result.success) {
      setSuggestionError(result.error ?? "Could not merge the customers.");
      return;
    }
    await Promise.all([loadSuggestions(), loadCustomers(activeQuery)]);
  }

  async function dismissSuggestion(suggestion: MergeSuggestion) {
    setSuggestionBusy(suggestion.id);
    setSuggestionError("");
    const result = await apiPost<unknown>(`/business/customers/suggestions/${suggestion.id}/dismiss`, {});
    setSuggestionBusy(null);
    if (!result.success) {
      setSuggestionError(result.error ?? "Could not dismiss the suggestion.");
      return;
    }
    await loadSuggestions();
  }

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="customers-page">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
        title="Customers"
        description="Everyone your agents have talked to, unified across channels."
        actions={(
          <button
            type="button"
            onClick={() => void loadCustomers(activeQuery)}
            className={SECONDARY_BUTTON_CLASS}
            data-testid="customers-refresh-button"
          >
            Refresh
          </button>
        )}
      />

      <FrontDeskNav />

      {suggestions.length > 0 ? (
        <SectionCard
          title="Possible duplicates"
          subtitle="These profiles look like the same person. Merging keeps the first profile and moves everything from the second onto it."
          testId="customers-suggestions"
          className="mb-4 sm:mb-6"
        >
          {suggestionError ? (
            <p className="px-6 pt-3 text-sm font-semibold text-red-600" data-testid="customers-suggestion-error">
              {suggestionError}
            </p>
          ) : null}
          <div className="divide-y divide-gray-50">
            {suggestions.map((suggestion) => (
              <div
                key={suggestion.id}
                className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                data-testid={`customers-suggestion-${suggestion.id}`}
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-slate-900">
                    {customerLabel(suggestion.customerA)}{" "}
                    <span className="font-normal text-slate-400">and</span>{" "}
                    {customerLabel(suggestion.customerB)}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {suggestion.reason} · confidence {(suggestion.score * 100).toFixed(0)}%
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void mergeSuggestion(suggestion)}
                    disabled={suggestionBusy !== null}
                    className={PRIMARY_BUTTON_CLASS}
                    data-testid={`customers-suggestion-merge-button-${suggestion.id}`}
                  >
                    {suggestionBusy === suggestion.id ? "Working…" : "Merge"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void dismissSuggestion(suggestion)}
                    disabled={suggestionBusy !== null}
                    className={SECONDARY_BUTTON_CLASS}
                    data-testid={`customers-suggestion-dismiss-button-${suggestion.id}`}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}

      <form
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          setActiveQuery(query.trim());
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by name, phone, or email…"
          className={`${INPUT_CLASS} max-w-md`}
          data-testid="customers-search-input"
        />
        <button type="submit" className={PRIMARY_BUTTON_CLASS} data-testid="customers-search-button">
          Search
        </button>
      </form>

      <SectionCard testId="customers-list-card">
        {listState === "loading" ? (
          <LoadingRows rows={5} testId="customers-list-loading" />
        ) : listState === "error" ? (
          <ErrorState message={listError} onRetry={() => void loadCustomers(activeQuery)} testId="customers-list-error" />
        ) : customers.length === 0 ? (
          <EmptyState
            title={activeQuery ? "No customers match your search" : "No customers yet"}
            hint={activeQuery ? "Try a different name, phone, or email." : "Customers appear automatically as your agents handle calls and messages."}
            testId="customers-list-empty"
          />
        ) : (
          <div className="divide-y divide-gray-50" data-testid="customers-list">
            {customers.map((customer) => (
              <Link
                key={customer.id}
                href={`/business/customers/${customer.id}` as Route}
                className="flex flex-col gap-2 px-4 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between sm:px-6"
                data-testid={`customers-row-${customer.id}`}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{customerLabel(customer)}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {[customer.primaryPhone, customer.primaryEmail].filter(Boolean).join(" · ") || "No contact details"}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {(customer.identities ?? []).slice(0, 4).map((identity) => (
                    <Pill key={identity.id} tone="slate" title={identity.value}>
                      {humanizeToken(identity.kind)}
                    </Pill>
                  ))}
                  <span className="text-xs text-slate-400">
                    Last seen {formatRelativeTime(customer.lastSeenAt ?? customer.firstSeenAt)}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
    </main>
  );
}
