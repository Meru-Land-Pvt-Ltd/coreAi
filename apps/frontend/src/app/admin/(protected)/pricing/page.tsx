"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createAdminPricingService,
  getAdminPricingServices,
  updateAdminPricingService,
  type AdminPricingServicesResponse,
  type AdminUsageService,
  type UsageServiceUnit
} from "@/components/admin/features/api";

const UNIT_LABELS: Record<UsageServiceUnit, string> = {
  PER_MINUTE: "/ min",
  PER_SMS: "/ SMS",
  PER_CALL: "/ call",
  PER_UNIT: "/ unit"
};

function formatUsd(value: number, digits = 4) {
  return `$${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })}`;
}

type DraftRow = {
  name: string;
  role: string;
  unit: UsageServiceUnit;
  updatedCostUsd: string;
  actualCostUsd: string;
  isActive: boolean;
};

const PLATFORM_SERVICE_CODES = new Set(["database_storage", "google_calendar"]);

function draftFromService(service: AdminUsageService): DraftRow {
  return {
    name: service.name,
    role: service.role ?? "",
    unit: service.unit,
    actualCostUsd: String(service.actualCostUsd),
    updatedCostUsd: String(service.updatedCostUsd),
    isActive: service.isActive
  };
}

type AddForm = {
  code: string;
  name: string;
  role: string;
  unit: UsageServiceUnit;
  actualCostUsd: string;
  updatedCostUsd: string;
};

const EMPTY_ADD_FORM: AddForm = {
  code: "",
  name: "",
  role: "",
  unit: "PER_MINUTE",
  actualCostUsd: "",
  updatedCostUsd: ""
};

export default function AdminPricingPage() {
  const [data, setData] = useState<AdminPricingServicesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());
  const [drafts, setDrafts] = useState<Record<string, DraftRow>>({});
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD_FORM);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await getAdminPricingServices(true);
    if (result.success && result.data) {
      setData(result.data);
      const nextDrafts: Record<string, DraftRow> = {};
      for (const service of result.data.services) {
        nextDrafts[service.id] = draftFromService(service);
      }
      setDrafts(nextDrafts);
      setEditingIds(new Set());
    } else {
      setMessage(result.error ?? "Could not load pricing services.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.services ?? [];

  const dirtyIds = useMemo(() => {
    return rows
      .filter((service) => {
        const draft = drafts[service.id];
        if (!draft) return false;
        return (
          draft.name.trim() !== service.name ||
          (draft.role.trim() || null) !== service.role ||
          draft.unit !== service.unit ||
          Number(draft.actualCostUsd) !== service.actualCostUsd ||
          Number(draft.updatedCostUsd) !== service.updatedCostUsd ||
          draft.isActive !== service.isActive
        );
      })
      .map((service) => service.id);
  }, [drafts, rows]);

  function updateDraft<K extends keyof DraftRow>(id: string, field: K, value: DraftRow[K]) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value
      }
    }));
  }

  function beginEditing(service: AdminUsageService) {
    setDrafts((current) => ({ ...current, [service.id]: draftFromService(service) }));
    setEditingIds((current) => new Set(current).add(service.id));
    setMessage("");
  }

  function cancelEditing(service: AdminUsageService) {
    setDrafts((current) => ({ ...current, [service.id]: draftFromService(service) }));
    setEditingIds((current) => {
      const next = new Set(current);
      next.delete(service.id);
      return next;
    });
  }

  async function saveChanges() {
    const changedServices = rows.filter((service) => dirtyIds.includes(service.id));
    if (changedServices.length === 0) return;

    for (const service of changedServices) {
      const draft = drafts[service.id];
      const actualCostUsd = Number(draft?.actualCostUsd);
      const updatedCostUsd = Number(draft?.updatedCostUsd);
      if (!draft?.name.trim()) {
        setMessage(`Service name is required for ${service.code}.`);
        return;
      }
      if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
        setMessage(`Actual cost for ${service.code} must be a valid non-negative number.`);
        return;
      }
      if (!Number.isFinite(updatedCostUsd) || updatedCostUsd < 0) {
        setMessage(`Updated cost for ${service.code} must be a valid non-negative number.`);
        return;
      }
    }

    setSaving(true);
    setMessage("");
    const results = await Promise.all(
      changedServices.map((service) => {
        const draft = drafts[service.id]!;
        return updateAdminPricingService(service.id, {
          name: draft.name.trim(),
          role: draft.role.trim() || null,
          unit: draft.unit,
          actualCostUsd: Number(draft.actualCostUsd),
          updatedCostUsd: Number(draft.updatedCostUsd),
          isActive: draft.isActive
        });
      })
    );
    const failed = results.find((result) => !result.success);
    setSaving(false);
    if (failed) {
      setMessage(failed.error ?? "Could not save all service changes.");
      return;
    }

    await load();
    setMessage(`${changedServices.length} service${changedServices.length === 1 ? "" : "s"} updated.`);
  }

  async function submitAddService(event: React.FormEvent) {
    event.preventDefault();
    setAdding(true);
    setMessage("");

    const actualCostUsd = Number(addForm.actualCostUsd);
    const updatedCostUsd = Number(addForm.updatedCostUsd);

    if (!addForm.code.trim() || !addForm.name.trim()) {
      setMessage("Service code and name are required.");
      setAdding(false);
      return;
    }
    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
      setMessage("Actual cost must be a valid non-negative number.");
      setAdding(false);
      return;
    }
    if (!Number.isFinite(updatedCostUsd) || updatedCostUsd < 0) {
      setMessage("Updated cost must be a valid non-negative number.");
      setAdding(false);
      return;
    }

    const result = await createAdminPricingService({
      code: addForm.code.trim().toLowerCase(),
      name: addForm.name.trim(),
      role: addForm.role.trim() || undefined,
      unit: addForm.unit,
      actualCostUsd,
      updatedCostUsd
    });

    if (!result.success) {
      setMessage(result.error ?? "Could not add service.");
      setAdding(false);
      return;
    }

    setShowAddModal(false);
    setAddForm(EMPTY_ADD_FORM);
    setMessage("Service added.");
    setAdding(false);
    await load();
  }

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900" data-testid="admin-pricing-title">
            Service Pricing
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Infrastructure costs for AI Receptionist and agent execution. Updated cost is used everywhere in billing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={dirtyIds.length === 0 || saving}
            data-testid="admin-pricing-save-all"
            onClick={() => void saveChanges()}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? "Saving…" : `Save changes${dirtyIds.length ? ` (${dirtyIds.length})` : ""}`}
          </button>
          <button
            type="button"
            data-testid="admin-pricing-add-service"
            onClick={() => setShowAddModal(true)}
            className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600"
          >
            Add service
          </button>
        </div>
      </header>

      {data ? (
        <section className="mb-6 grid gap-4 md:grid-cols-2" data-testid="admin-pricing-summary">
          <SummaryCard
            label="Blended actual cost (per minute)"
            value={formatUsd(data.totals.perMinuteActualUsd)}
            hint="Sum of per-minute vendor rates from pricing board"
            testId="admin-pricing-actual-total"
          />
          <SummaryCard
            label="Blended updated cost (per minute)"
            value={formatUsd(data.totals.perMinuteUpdatedUsd)}
            hint="Used for margin planning and customer billing"
            testId="admin-pricing-updated-total"
          />
        </section>
      ) : null}

      {message ? (
        <p data-testid="admin-pricing-message" className="mb-3 text-sm font-semibold text-orange-700">
          {message}
        </p>
      ) : null}

      {loading ? (
        <p data-testid="admin-pricing-loading" className="text-sm font-semibold text-orange-700">
          Loading service pricing…
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-pricing-empty" className="text-sm font-semibold text-slate-500">
          No services configured yet.
        </p>
      ) : (
        <div className="space-y-6" data-testid="admin-pricing-table">
          <PricingServiceTable
            title="Usage services"
            description="AI, telephony, messaging, and other metered services. The role is the customer-facing invoice label."
            rows={rows.filter((service) => !PLATFORM_SERVICE_CODES.has(service.code))}
            drafts={drafts}
            dirtyIds={dirtyIds}
            editingIds={editingIds}
            saving={saving}
            onEdit={beginEditing}
            onCancel={cancelEditing}
            onDraftChange={updateDraft}
            testId="admin-pricing-usage-table"
          />
          <PricingServiceTable
            title="Platform services"
            description="Shared platform infrastructure. Firebase / MongoDB and Google Calendar API are billed under one customer-facing Platform service label."
            rows={rows.filter((service) => PLATFORM_SERVICE_CODES.has(service.code))}
            drafts={drafts}
            dirtyIds={dirtyIds}
            editingIds={editingIds}
            saving={saving}
            onEdit={beginEditing}
            onCancel={cancelEditing}
            onDraftChange={updateDraft}
            testId="admin-pricing-platform-table"
          />
        </div>
      )}

      {showAddModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          data-testid="admin-pricing-add-modal"
        >
          <form
            onSubmit={(event) => void submitAddService(event)}
            className="w-full max-w-lg rounded-2xl border border-orange-100 bg-white p-6 shadow-xl"
          >
            <h2 className="text-lg font-bold text-slate-900">Add service</h2>
            <p className="mt-1 text-sm text-slate-500">
              Create a new infrastructure line item with actual and updated pricing.
            </p>

            <div className="mt-4 grid gap-3">
              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-slate-700">Service ID (code)</span>
                <input
                  required
                  data-testid="admin-pricing-add-code"
                  value={addForm.code}
                  onChange={(event) => setAddForm((current) => ({ ...current, code: event.target.value }))}
                  placeholder="e.g. vapi_orchestration"
                  className="rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-400"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-slate-700">Service name</span>
                <input
                  required
                  data-testid="admin-pricing-add-name"
                  value={addForm.name}
                  onChange={(event) => setAddForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Vapi Orchestration"
                  className="rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-400"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-slate-700">Role / description</span>
                <input
                  data-testid="admin-pricing-add-role"
                  value={addForm.role}
                  onChange={(event) => setAddForm((current) => ({ ...current, role: event.target.value }))}
                  placeholder="What this service does"
                  className="rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-400"
                />
              </label>

              <label className="grid gap-1 text-sm">
                <span className="font-semibold text-slate-700">Billing unit</span>
                <select
                  data-testid="admin-pricing-add-unit"
                  value={addForm.unit}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, unit: event.target.value as UsageServiceUnit }))
                  }
                  className="rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-400"
                >
                  <option value="PER_MINUTE">Per minute</option>
                  <option value="PER_SMS">Per SMS</option>
                  <option value="PER_CALL">Per call</option>
                  <option value="PER_UNIT">Per unit</option>
                </select>
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-sm">
                  <span className="font-semibold text-slate-700">Actual cost (USD)</span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.0001"
                    data-testid="admin-pricing-add-actual"
                    value={addForm.actualCostUsd}
                    onChange={(event) =>
                      setAddForm((current) => ({ ...current, actualCostUsd: event.target.value }))
                    }
                    className="rounded-xl border border-orange-200 px-3 py-2 font-mono outline-none focus:border-orange-400"
                  />
                </label>

                <label className="grid gap-1 text-sm">
                  <span className="font-semibold text-slate-700">Updated cost (USD)</span>
                  <input
                    required
                    type="number"
                    min="0"
                    step="0.0001"
                    data-testid="admin-pricing-add-updated"
                    value={addForm.updatedCostUsd}
                    onChange={(event) =>
                      setAddForm((current) => ({ ...current, updatedCostUsd: event.target.value }))
                    }
                    className="rounded-xl border border-orange-200 px-3 py-2 font-mono outline-none focus:border-orange-400"
                  />
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                data-testid="admin-pricing-add-cancel"
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm(EMPTY_ADD_FORM);
                }}
                className="rounded-xl border border-orange-200 px-4 py-2 text-sm font-semibold text-orange-800 hover:bg-orange-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding}
                data-testid="admin-pricing-add-submit"
                className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {adding ? "Adding…" : "Add service"}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

function PricingServiceTable({
  title,
  description,
  rows,
  drafts,
  dirtyIds,
  editingIds,
  saving,
  onEdit,
  onCancel,
  onDraftChange,
  testId
}: {
  title: string;
  description: string;
  rows: AdminUsageService[];
  drafts: Record<string, DraftRow>;
  dirtyIds: string[];
  editingIds: Set<string>;
  saving: boolean;
  onEdit: (service: AdminUsageService) => void;
  onCancel: (service: AdminUsageService) => void;
  onDraftChange: <K extends keyof DraftRow>(id: string, field: K, value: DraftRow[K]) => void;
  testId: string;
}) {
  return (
    <section>
      <div className="mb-3">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      {rows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-orange-200 bg-white px-4 py-6 text-sm text-slate-500">
          No services in this group.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid={testId} className="w-full min-w-[1040px] text-left text-sm">
            <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Service ID</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Unit</th>
                <th className="px-4 py-3">Actual cost</th>
                <th className="px-4 py-3">Updated cost</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((service) => {
                const draft = drafts[service.id];
                const isDirty = dirtyIds.includes(service.id);
                const isEditing = editingIds.has(service.id);
                return (
                  <tr
                    key={service.id}
                    className="border-b border-orange-50"
                    data-testid={`admin-pricing-row-${service.code}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{service.code}</td>
                    <td className="px-4 py-3">
                      <input
                        disabled={!isEditing || saving}
                        value={draft?.name ?? ""}
                        onChange={(event) => onDraftChange(service.id, "name", event.target.value)}
                        className="w-44 rounded-lg border border-orange-200 px-2 py-1 font-semibold text-slate-900 outline-none focus:border-orange-400 disabled:border-transparent disabled:bg-transparent disabled:px-0"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        disabled={!isEditing || saving}
                        value={draft?.role ?? ""}
                        placeholder="Customer-facing label"
                        onChange={(event) => onDraftChange(service.id, "role", event.target.value)}
                        className="w-52 rounded-lg border border-orange-200 px-2 py-1 text-slate-600 outline-none focus:border-orange-400 disabled:border-transparent disabled:bg-transparent disabled:px-0"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <select
                        disabled={!isEditing || saving}
                        value={draft?.unit ?? service.unit}
                        onChange={(event) => onDraftChange(service.id, "unit", event.target.value as UsageServiceUnit)}
                        className="rounded-lg border border-orange-200 px-2 py-1 text-slate-600 outline-none focus:border-orange-400 disabled:border-transparent disabled:bg-transparent disabled:px-0"
                      >
                        {Object.entries(UNIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        data-testid={`admin-pricing-actual-${service.code}`}
                        value={draft?.actualCostUsd ?? ""}
                        disabled={!isEditing || saving}
                        onChange={(event) => onDraftChange(service.id, "actualCostUsd", event.target.value)}
                        className="w-28 rounded-lg border border-orange-200 px-2 py-1 font-mono text-slate-700 outline-none focus:border-orange-400 disabled:border-transparent disabled:bg-transparent disabled:px-0"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        data-testid={`admin-pricing-updated-${service.code}`}
                        value={draft?.updatedCostUsd ?? ""}
                        disabled={!isEditing || saving}
                        onChange={(event) => onDraftChange(service.id, "updatedCostUsd", event.target.value)}
                        className="w-28 rounded-lg border border-orange-200 px-2 py-1 font-mono font-semibold text-green-700 outline-none focus:border-orange-400 disabled:border-transparent disabled:bg-transparent disabled:px-0"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {isEditing ? (
                          <>
                            <label className="flex items-center gap-1 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={draft?.isActive ?? false}
                                disabled={saving}
                                onChange={(event) => onDraftChange(service.id, "isActive", event.target.checked)}
                              />
                              Active
                            </label>
                            <button type="button" disabled={saving} onClick={() => onCancel(service)} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            disabled={saving}
                            data-testid={`admin-pricing-edit-${service.code}`}
                            onClick={() => onEdit(service)}
                            className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50"
                          >
                            Edit
                          </button>
                        )}
                        {isDirty ? <span className="text-xs font-semibold text-orange-600">Unsaved</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  testId
}: {
  label: string;
  value: string;
  hint: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-2xl border border-orange-100 bg-white px-5 py-4 shadow-sm"
    >
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-1 text-sm text-slate-500">{hint}</p>
    </div>
  );
}
