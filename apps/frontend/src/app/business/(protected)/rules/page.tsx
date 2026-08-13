"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { apiClient, apiDelete, apiGet, apiPost } from "@/lib/api";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
import {
  ConfirmDialog,
  EmptyState,
  ErrorState,
  INPUT_CLASS,
  LoadingRows,
  ModalShell,
  Pill,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  DANGER_BUTTON_CLASS,
  SectionCard,
  formatDateTime,
  humanizeToken,
  type PillTone
} from "@/components/business/features/frontdesk/ui";

type BusinessRule = {
  id: string;
  installedAgentId: string | null;
  title: string;
  instruction: string;
  category: string;
  priority: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

type RuleVersion = {
  id: string;
  version: number;
  title: string;
  instruction: string;
  category: string;
  priority: number;
  active: boolean;
  startsAt: string | null;
  endsAt: string | null;
  changeNote: string | null;
  createdAt: string;
};

type ConflictWarning = {
  type: string;
  withRuleId: string;
  detail: string;
};

type RuleTestResult = {
  compiledSection: string;
  injection: { suspicious: boolean; pattern?: string };
  rulesInPlay: Array<{ ruleId: string; matchedKeywords: string[] }>;
  effectiveRuleIds: string[];
  note?: string;
};

const RULE_CATEGORIES = [
  "COMPLIANCE",
  "SAFETY",
  "BOOKING",
  "ESCALATION",
  "BUSINESS_POLICY",
  "SALES",
  "TONE",
  "CUSTOM"
] as const;

function categoryTone(category: string): PillTone {
  if (category === "COMPLIANCE") return "red";
  if (category === "SAFETY") return "amber";
  return "slate";
}

type RuleFormState = {
  title: string;
  instruction: string;
  category: string;
  priority: string;
  startsAt: string;
  endsAt: string;
  active: boolean;
};

const EMPTY_FORM: RuleFormState = {
  title: "",
  instruction: "",
  category: "CUSTOM",
  priority: "100",
  startsAt: "",
  endsAt: "",
  active: true
};

function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

export default function BusinessRulesPage() {
  const [rules, setRules] = useState<BusinessRule[]>([]);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");

  const [modal, setModal] = useState<{ mode: "create" } | { mode: "edit"; rule: BusinessRule } | null>(null);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [formError, setFormError] = useState("");
  const [conflictWarnings, setConflictWarnings] = useState<ConflictWarning[] | null>(null);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<BusinessRule | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const [versionsRule, setVersionsRule] = useState<BusinessRule | null>(null);
  const [versions, setVersions] = useState<RuleVersion[]>([]);
  const [versionsState, setVersionsState] = useState<"loading" | "ready" | "error">("loading");
  const [versionsError, setVersionsError] = useState("");
  const [rollbackBusy, setRollbackBusy] = useState<number | null>(null);

  const [testMessage, setTestMessage] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testError, setTestError] = useState("");
  const [testResult, setTestResult] = useState<RuleTestResult | null>(null);

  const loadRules = useCallback(async () => {
    setListState("loading");
    setListError("");
    const result = await apiGet<{ rules: BusinessRule[] }>("/business/rules");
    if (result.success && result.data) {
      setRules(result.data.rules ?? []);
      setListState("ready");
    } else {
      setListError(result.error ?? "Could not load your rules.");
      setListState("error");
    }
  }, []);

  useEffect(() => {
    void loadRules();
  }, [loadRules]);

  const rulesByCategory = useMemo(() => {
    const known = new Set<string>(RULE_CATEGORIES);
    const groups: Array<{ category: string; rules: BusinessRule[] }> = [];
    for (const category of RULE_CATEGORIES) {
      const inCategory = rules.filter((rule) => rule.category === category);
      if (inCategory.length > 0) groups.push({ category, rules: inCategory });
    }
    const other = rules.filter((rule) => !known.has(rule.category));
    if (other.length > 0) groups.push({ category: "OTHER", rules: other });
    return groups;
  }, [rules]);

  const ruleTitleById = useMemo(() => new Map(rules.map((rule) => [rule.id, rule.title])), [rules]);

  function openCreate() {
    setForm(EMPTY_FORM);
    setFormError("");
    setConflictWarnings(null);
    setModal({ mode: "create" });
  }

  function openEdit(rule: BusinessRule) {
    setForm({
      title: rule.title,
      instruction: rule.instruction,
      category: rule.category,
      priority: String(rule.priority),
      startsAt: toLocalInputValue(rule.startsAt),
      endsAt: toLocalInputValue(rule.endsAt),
      active: rule.active
    });
    setFormError("");
    setConflictWarnings(null);
    setModal({ mode: "edit", rule });
  }

  async function saveRule(acknowledgeConflicts: boolean) {
    if (!modal) return;
    setSaving(true);
    setFormError("");

    const priority = Number(form.priority);
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      instruction: form.instruction.trim(),
      category: form.category,
      ...(Number.isFinite(priority) ? { priority } : {}),
      startsAt: form.startsAt ? new Date(form.startsAt).toISOString() : null,
      endsAt: form.endsAt ? new Date(form.endsAt).toISOString() : null,
      active: form.active,
      ...(acknowledgeConflicts ? { acknowledgeConflicts: true } : {})
    };

    try {
      if (modal.mode === "edit") {
        await apiClient.patch(`/business/rules/${modal.rule.id}`, payload);
      } else {
        await apiClient.post("/business/rules", payload);
      }
      setSaving(false);
      setModal(null);
      setConflictWarnings(null);
      await loadRules();
    } catch (error) {
      setSaving(false);
      if (axios.isAxiosError(error)) {
        const data = error.response?.data as
          | { code?: string; error?: string; message?: string; warnings?: ConflictWarning[] }
          | undefined;
        if (error.response?.status === 409 && data?.code === "RULE_CONFLICT") {
          setConflictWarnings(data.warnings ?? []);
          return;
        }
        setFormError(data?.error ?? data?.message ?? error.message);
        return;
      }
      setFormError("Something went wrong while saving the rule.");
    }
  }

  async function deleteRule() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setDeleteError("");
    const result = await apiDelete<unknown>(`/business/rules/${deleteTarget.id}`);
    setDeleteBusy(false);
    if (!result.success) {
      setDeleteError(result.error ?? "Could not delete the rule.");
      return;
    }
    setDeleteTarget(null);
    await loadRules();
  }

  async function openVersions(rule: BusinessRule) {
    setVersionsRule(rule);
    setVersionsState("loading");
    setVersionsError("");
    const result = await apiGet<{ versions: RuleVersion[] }>(`/business/rules/${rule.id}/versions`);
    if (result.success && result.data) {
      setVersions(result.data.versions ?? []);
      setVersionsState("ready");
    } else {
      setVersionsError(result.error ?? "Could not load version history.");
      setVersionsState("error");
    }
  }

  async function rollback(toVersion: number) {
    if (!versionsRule) return;
    setRollbackBusy(toVersion);
    const result = await apiPost<unknown>(`/business/rules/${versionsRule.id}/rollback`, { toVersion });
    setRollbackBusy(null);
    if (!result.success) {
      setVersionsError(result.error ?? "Could not roll back the rule.");
      return;
    }
    setVersionsRule(null);
    await loadRules();
  }

  async function runTest() {
    if (!testMessage.trim()) return;
    setTestBusy(true);
    setTestError("");
    const result = await apiPost<RuleTestResult>("/business/rules/test", { message: testMessage.trim() });
    setTestBusy(false);
    if (result.success && result.data) {
      setTestResult(result.data);
    } else {
      setTestError(result.error ?? "Could not run the test.");
      setTestResult(null);
    }
  }

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="rules-page">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
        title="AI Rules"
        description="Plain-language instructions your agents must follow, with history and rollback."
        actions={(
          <button type="button" onClick={openCreate} className={PRIMARY_BUTTON_CLASS} data-testid="rules-add-button">
            Add rule
          </button>
        )}
      />

      <FrontDeskNav />

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-4 sm:space-y-6 xl:col-span-2">
          <SectionCard title="Rules" subtitle="Compliance and safety rules always outrank the rest." testId="rules-list-card">
            {listState === "loading" ? (
              <LoadingRows rows={4} testId="rules-list-loading" />
            ) : listState === "error" ? (
              <ErrorState message={listError} onRetry={() => void loadRules()} testId="rules-list-error" />
            ) : rules.length === 0 ? (
              <EmptyState
                title="No rules yet"
                hint='Add rules like "Never quote prices over the phone" or "Always offer the next available slot".'
                testId="rules-list-empty"
              />
            ) : (
              <div data-testid="rules-list">
                {rulesByCategory.map((group) => (
                  <div key={group.category}>
                    <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50/60 px-4 py-2 sm:px-6">
                      <Pill tone={categoryTone(group.category)} testId={`rules-category-${group.category}`}>
                        {humanizeToken(group.category)}
                      </Pill>
                      <span className="text-xs text-slate-400">
                        {group.rules.length} rule{group.rules.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <div className="divide-y divide-gray-50">
                      {group.rules.map((rule) => (
                        <div key={rule.id} className="px-4 py-4 sm:px-6" data-testid={`rules-row-${rule.id}`}>
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-sm font-semibold text-slate-900">{rule.title}</p>
                                {!rule.active ? <Pill tone="slate">Inactive</Pill> : null}
                                {rule.startsAt || rule.endsAt ? (
                                  <Pill tone="blue" title={`${rule.startsAt ?? "…"} → ${rule.endsAt ?? "…"}`}>
                                    Scheduled
                                  </Pill>
                                ) : null}
                              </div>
                              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{rule.instruction}</p>
                              <p className="mt-1 text-xs text-slate-400">
                                Priority {rule.priority} · v{rule.version} · updated {formatDateTime(rule.updatedAt)}
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              <button
                                type="button"
                                onClick={() => openEdit(rule)}
                                className={SECONDARY_BUTTON_CLASS}
                                data-testid={`rules-edit-button-${rule.id}`}
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void openVersions(rule)}
                                className={SECONDARY_BUTTON_CLASS}
                                data-testid={`rules-versions-button-${rule.id}`}
                              >
                                History
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setDeleteError("");
                                  setDeleteTarget(rule);
                                }}
                                className={DANGER_BUTTON_CLASS}
                                data-testid={`rules-delete-button-${rule.id}`}
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        <div className="min-w-0 xl:col-span-1">
          <SectionCard
            title="Test a message"
            subtitle="See which rules would apply — no AI call is made."
            testId="rules-test-card"
          >
            <div className="space-y-3 px-4 py-4 sm:px-6">
              <textarea
                value={testMessage}
                onChange={(event) => setTestMessage(event.target.value)}
                rows={3}
                placeholder='e.g. "Can I get a discount if I pay cash?"'
                className={`${INPUT_CLASS} resize-none`}
                data-testid="rules-test-input"
              />
              <button
                type="button"
                onClick={() => void runTest()}
                disabled={testBusy || !testMessage.trim()}
                className={PRIMARY_BUTTON_CLASS}
                data-testid="rules-test-button"
              >
                {testBusy ? "Testing…" : "Run test"}
              </button>
              {testError ? <p className="text-sm font-semibold text-red-600">{testError}</p> : null}

              {testResult ? (
                <div className="space-y-3" data-testid="rules-test-result">
                  {testResult.injection.suspicious ? (
                    <Pill tone="red" testId="rules-test-injection">
                      Possible prompt injection detected
                    </Pill>
                  ) : null}

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Rules in play</p>
                    {testResult.rulesInPlay.length === 0 ? (
                      <p className="text-sm text-slate-400">No rules matched this message&apos;s keywords.</p>
                    ) : (
                      <ul className="space-y-1">
                        {testResult.rulesInPlay.map((trace) => (
                          <li key={trace.ruleId} className="text-sm text-slate-700">
                            <span className="font-semibold">{ruleTitleById.get(trace.ruleId) ?? trace.ruleId}</span>
                            <span className="text-xs text-slate-400"> — {trace.matchedKeywords.join(", ")}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Compiled prompt section</p>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-gray-50 p-3 font-mono text-xs text-slate-700" data-testid="rules-test-compiled">
                      {testResult.compiledSection || "(no active rules)"}
                    </pre>
                  </div>

                  {testResult.note ? <p className="text-xs text-slate-400">{testResult.note}</p> : null}
                </div>
              ) : null}
            </div>
          </SectionCard>
        </div>
      </div>

      {modal ? (
        <ModalShell
          title={modal.mode === "edit" ? "Edit rule" : "Add rule"}
          onClose={() => setModal(null)}
          testId="rules-modal"
        >
          <div className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">Title</span>
              <input
                type="text"
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                className={INPUT_CLASS}
                maxLength={120}
                data-testid="rules-title-input"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-slate-500">Instruction</span>
              <textarea
                value={form.instruction}
                onChange={(event) => setForm((prev) => ({ ...prev, instruction: event.target.value }))}
                rows={4}
                maxLength={2000}
                className={`${INPUT_CLASS} resize-none`}
                data-testid="rules-instruction-input"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Category</span>
                <select
                  value={form.category}
                  onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}
                  className={INPUT_CLASS}
                  data-testid="rules-category-select"
                >
                  {RULE_CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {humanizeToken(category)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Priority (lower wins)</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.priority}
                  onChange={(event) => setForm((prev) => ({ ...prev, priority: event.target.value }))}
                  className={INPUT_CLASS}
                  data-testid="rules-priority-input"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Starts (optional)</span>
                <input
                  type="datetime-local"
                  value={form.startsAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, startsAt: event.target.value }))}
                  className={INPUT_CLASS}
                  data-testid="rules-startsat-input"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Ends (optional)</span>
                <input
                  type="datetime-local"
                  value={form.endsAt}
                  onChange={(event) => setForm((prev) => ({ ...prev, endsAt: event.target.value }))}
                  className={INPUT_CLASS}
                  data-testid="rules-endsat-input"
                />
              </label>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
                className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                data-testid="rules-active-checkbox"
              />
              Active
            </label>

            {conflictWarnings ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="rules-conflict-warnings">
                <p className="text-sm font-semibold text-amber-800">This rule conflicts with existing rules:</p>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-amber-700">
                  {conflictWarnings.map((warning, index) => (
                    <li key={index}>{warning.detail}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {formError ? (
              <p className="text-sm font-semibold text-red-600" data-testid="rules-form-error">
                {formError}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => setModal(null)} className={SECONDARY_BUTTON_CLASS}>
                Cancel
              </button>
              {conflictWarnings ? (
                <button
                  type="button"
                  onClick={() => void saveRule(true)}
                  disabled={saving}
                  className={PRIMARY_BUTTON_CLASS}
                  data-testid="rules-save-anyway-button"
                >
                  {saving ? "Saving…" : "Save anyway"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => void saveRule(false)}
                  disabled={saving || !form.title.trim() || !form.instruction.trim()}
                  className={PRIMARY_BUTTON_CLASS}
                  data-testid="rules-save-button"
                >
                  {saving ? "Saving…" : "Save rule"}
                </button>
              )}
            </div>
          </div>
        </ModalShell>
      ) : null}

      {deleteTarget ? (
        <ConfirmDialog
          title="Delete rule"
          message={
            <span>
              Delete <strong>{deleteTarget.title}</strong>? The agent will stop following it immediately.
            </span>
          }
          confirmLabel="Delete"
          danger
          busy={deleteBusy}
          error={deleteError}
          onConfirm={() => void deleteRule()}
          onCancel={() => setDeleteTarget(null)}
          testId="rules-delete-confirm"
        />
      ) : null}

      {versionsRule ? (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setVersionsRule(null)} aria-hidden="true" />
          <aside
            className="absolute inset-y-0 right-0 w-full max-w-md overflow-y-auto border-l border-gray-100 bg-white shadow-xl"
            role="dialog"
            aria-modal="true"
            data-testid="rules-versions-drawer"
          >
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="truncate text-base font-bold text-slate-900">Version history</h3>
                <p className="truncate text-xs text-slate-400">{versionsRule.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setVersionsRule(null)}
                aria-label="Close"
                className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600"
                data-testid="rules-versions-close"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {versionsState === "loading" ? (
              <LoadingRows rows={3} testId="rules-versions-loading" />
            ) : versionsState === "error" ? (
              <ErrorState message={versionsError} testId="rules-versions-error" />
            ) : versions.length === 0 ? (
              <EmptyState title="No versions recorded" testId="rules-versions-empty" />
            ) : (
              <div className="divide-y divide-gray-50">
                {versionsError ? <p className="px-5 pt-3 text-sm font-semibold text-red-600">{versionsError}</p> : null}
                {versions.map((version) => (
                  <div key={version.id} className="px-5 py-4" data-testid={`rules-version-${version.version}`}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">
                        v{version.version}
                        {version.version === versionsRule.version ? (
                          <span className="ml-2 text-xs font-medium text-green-600">current</span>
                        ) : null}
                      </p>
                      {version.version !== versionsRule.version ? (
                        <button
                          type="button"
                          onClick={() => void rollback(version.version)}
                          disabled={rollbackBusy !== null}
                          className={SECONDARY_BUTTON_CLASS}
                          data-testid={`rules-rollback-button-${version.version}`}
                        >
                          {rollbackBusy === version.version ? "Rolling back…" : `Rollback to v${version.version}`}
                        </button>
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm font-medium text-slate-700">{version.title}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs text-slate-500">{version.instruction}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {humanizeToken(version.category)} · priority {version.priority} ·{" "}
                      {version.active ? "active" : "inactive"} · {formatDateTime(version.createdAt)}
                    </p>
                    {version.changeNote ? (
                      <p className="mt-1 text-xs italic text-slate-400">{version.changeNote}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </aside>
        </div>
      ) : null}
    </main>
  );
}
