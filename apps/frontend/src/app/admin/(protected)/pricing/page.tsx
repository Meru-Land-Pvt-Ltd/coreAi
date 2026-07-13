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
  updatedCostUsd: string;
  actualCostUsd: string;
};

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
  const [actingId, setActingId] = useState<string | null>(null);
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
        nextDrafts[service.id] = {
          actualCostUsd: String(service.actualCostUsd),
          updatedCostUsd: String(service.updatedCostUsd)
        };
      }
      setDrafts(nextDrafts);
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
          Number(draft.actualCostUsd) !== service.actualCostUsd ||
          Number(draft.updatedCostUsd) !== service.updatedCostUsd
        );
      })
      .map((service) => service.id);
  }, [drafts, rows]);

  function updateDraft(id: string, field: keyof DraftRow, value: string) {
    setDrafts((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [field]: value
      }
    }));
  }

  async function saveRow(service: AdminUsageService) {
    const draft = drafts[service.id];
    if (!draft) return;

    const actualCostUsd = Number(draft.actualCostUsd);
    const updatedCostUsd = Number(draft.updatedCostUsd);

    if (!Number.isFinite(actualCostUsd) || actualCostUsd < 0) {
      setMessage("Actual cost must be a valid non-negative number.");
      return;
    }
    if (!Number.isFinite(updatedCostUsd) || updatedCostUsd < 0) {
      setMessage("Updated cost must be a valid non-negative number.");
      return;
    }

    setActingId(service.id);
    setMessage("");

    const result = await updateAdminPricingService(service.id, {
      actualCostUsd,
      updatedCostUsd
    });

    if (!result.success) {
      setMessage(result.error ?? "Could not update service pricing.");
      setActingId(null);
      return;
    }

    setMessage(`Updated pricing for ${service.name}.`);
    setActingId(null);
    await load();
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
        <button
          type="button"
          data-testid="admin-pricing-add-service"
          onClick={() => setShowAddModal(true)}
          className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white hover:bg-orange-600"
        >
          Add service
        </button>
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
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid="admin-pricing-table" className="w-full text-left text-sm">
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
                return (
                  <tr
                    key={service.id}
                    className="border-b border-orange-50"
                    data-testid={`admin-pricing-row-${service.code}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{service.code}</td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{service.name}</p>
                      {!service.isActive ? (
                        <span className="mt-1 inline-block rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">
                          Inactive
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{service.role ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{UNIT_LABELS[service.unit]}</td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        data-testid={`admin-pricing-actual-${service.code}`}
                        value={draft?.actualCostUsd ?? ""}
                        onChange={(event) => updateDraft(service.id, "actualCostUsd", event.target.value)}
                        className="w-28 rounded-lg border border-orange-200 px-2 py-1 font-mono text-slate-700 outline-none focus:border-orange-400"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        data-testid={`admin-pricing-updated-${service.code}`}
                        value={draft?.updatedCostUsd ?? ""}
                        onChange={(event) => updateDraft(service.id, "updatedCostUsd", event.target.value)}
                        className="w-28 rounded-lg border border-orange-200 px-2 py-1 font-mono font-semibold text-green-700 outline-none focus:border-orange-400"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <button
                        type="button"
                        disabled={!isDirty || actingId === service.id}
                        data-testid={`admin-pricing-save-${service.code}`}
                        onClick={() => void saveRow(service)}
                        className="rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50"
                      >
                        {actingId === service.id ? "Saving…" : "Save"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
