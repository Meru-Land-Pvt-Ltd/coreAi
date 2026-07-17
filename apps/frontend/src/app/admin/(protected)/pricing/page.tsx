"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeDollarSign,
  Boxes,
  Check,
  CircleDollarSign,
  CloudCog,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  Save,
  X,
  type LucideIcon
} from "lucide-react";
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
  const activeServiceCount = rows.filter((service) => service.isActive).length;
  const usageServices = rows.filter((service) => !PLATFORM_SERVICE_CODES.has(service.code));
  const platformServices = rows.filter((service) => PLATFORM_SERVICE_CODES.has(service.code));

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
    <div className="w-full max-w-full">
      <header className="mb-6 flex flex-col gap-5 border-b border-gray-200 pb-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase text-amber-700">
            <BadgeDollarSign aria-hidden="true" className="h-4 w-4" />
            Billing operations
          </div>
          <h1 className="text-2xl font-bold tracking-normal text-slate-900" data-testid="admin-pricing-title">
            Service pricing
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
            Manage infrastructure cost rates for AI receptionists, agent execution, and shared platform services.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={dirtyIds.length === 0 || saving}
            data-testid="admin-pricing-save-all"
            onClick={() => void saveChanges()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-bold text-white transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saving ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Save aria-hidden="true" className="h-4 w-4" />}
            {saving ? "Saving…" : `Save changes${dirtyIds.length ? ` (${dirtyIds.length})` : ""}`}
          </button>
          <button
            type="button"
            data-testid="admin-pricing-add-service"
            onClick={() => setShowAddModal(true)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-bold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-300"
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add service
          </button>
        </div>
      </header>

      {data ? (
        <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="admin-pricing-summary">
          <SummaryCard
            label="Actual cost"
            value={formatUsd(data.totals.perMinuteActualUsd)}
            hint="Combined vendor cost per minute"
            testId="admin-pricing-actual-total"
            icon={CircleDollarSign}
            tone="slate"
          />
          <SummaryCard
            label="Billing rate"
            value={formatUsd(data.totals.perMinuteUpdatedUsd)}
            hint="Combined customer rate per minute"
            testId="admin-pricing-updated-total"
            icon={BadgeDollarSign}
            tone="emerald"
          />
          <SummaryCard
            label="Active services"
            value={`${activeServiceCount}/${rows.length}`}
            hint={`${rows.length - activeServiceCount} inactive service${rows.length - activeServiceCount === 1 ? "" : "s"}`}
            testId="admin-pricing-active-services"
            icon={Activity}
            tone="sky"
          />
          <SummaryCard
            label="Pending changes"
            value={String(dirtyIds.length)}
            hint={dirtyIds.length ? "Ready to review and save" : "All pricing is synchronized"}
            testId="admin-pricing-pending-changes"
            icon={Layers3}
            tone="amber"
          />
        </section>
      ) : null}

      {message ? (
        <div
          role="status"
          data-testid="admin-pricing-message"
          className="mb-5 flex items-center gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800"
        >
          <Activity aria-hidden="true" className="h-4 w-4 shrink-0" />
          <p>{message}</p>
        </div>
      ) : null}

      {loading ? (
        <div
          data-testid="admin-pricing-loading"
          className="flex min-h-48 items-center justify-center rounded-lg border border-gray-200 bg-white text-sm font-semibold text-slate-500"
        >
          <LoaderCircle aria-hidden="true" className="mr-2 h-5 w-5 animate-spin text-amber-500" />
          Loading service pricing…
        </div>
      ) : rows.length === 0 ? (
        <div
          data-testid="admin-pricing-empty"
          className="flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed border-gray-300 bg-white px-6 text-center"
        >
          <Boxes aria-hidden="true" className="h-8 w-8 text-slate-300" />
          <p className="mt-3 text-sm font-semibold text-slate-700">No services configured yet</p>
          <p className="mt-1 text-sm text-slate-500">Add the first service to begin managing usage pricing.</p>
        </div>
      ) : (
        <div className="space-y-6" data-testid="admin-pricing-table">
          <PricingServiceTable
            title="Usage services"
            description="AI, telephony, messaging, and other metered services used during agent execution."
            rows={usageServices}
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
            description="Shared infrastructure and integrations billed under the customer-facing Platform service."
            rows={platformServices}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-[2px]"
          data-testid="admin-pricing-add-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="admin-pricing-add-title"
        >
          <form
            onSubmit={(event) => void submitAddService(event)}
            className="max-h-[calc(100vh-2rem)] w-full max-w-xl overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-6 py-5">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-amber-50 text-amber-700">
                  <Plus aria-hidden="true" className="h-5 w-5" />
                </span>
                <div>
                  <h2 id="admin-pricing-add-title" className="text-lg font-bold text-slate-900">Add service</h2>
                  <p className="mt-1 text-sm text-slate-500">Create a new billable infrastructure line item.</p>
                </div>
              </div>
              <button
                type="button"
                aria-label="Close add service dialog"
                title="Close"
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm(EMPTY_ADD_FORM);
                }}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-gray-100 hover:text-slate-700"
              >
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </div>

            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-slate-700">Service ID</span>
                <input
                  required
                  data-testid="admin-pricing-add-code"
                  value={addForm.code}
                  onChange={(event) => setAddForm((current) => ({ ...current, code: event.target.value }))}
                  placeholder="e.g. vapi_orchestration"
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-slate-700">Billing unit</span>
                <select
                  data-testid="admin-pricing-add-unit"
                  value={addForm.unit}
                  onChange={(event) =>
                    setAddForm((current) => ({ ...current, unit: event.target.value as UsageServiceUnit }))
                  }
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                >
                  <option value="PER_MINUTE">Per minute</option>
                  <option value="PER_SMS">Per SMS</option>
                  <option value="PER_CALL">Per call</option>
                  <option value="PER_UNIT">Per unit</option>
                </select>
              </label>

              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="font-semibold text-slate-700">Service name</span>
                <input
                  required
                  data-testid="admin-pricing-add-name"
                  value={addForm.name}
                  onChange={(event) => setAddForm((current) => ({ ...current, name: event.target.value }))}
                  placeholder="e.g. Vapi Orchestration"
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <label className="grid gap-1.5 text-sm sm:col-span-2">
                <span className="font-semibold text-slate-700">Customer-facing label</span>
                <input
                  data-testid="admin-pricing-add-role"
                  value={addForm.role}
                  onChange={(event) => setAddForm((current) => ({ ...current, role: event.target.value }))}
                  placeholder="How this service appears on invoices"
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <label className="grid gap-1.5 text-sm">
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
                  placeholder="0.0000"
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </label>

              <label className="grid gap-1.5 text-sm">
                <span className="font-semibold text-slate-700">Billing cost (USD)</span>
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
                  placeholder="0.0000"
                  className="h-10 rounded-lg border border-gray-200 bg-white px-3 font-mono text-sm outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-6 py-4">
              <button
                type="button"
                data-testid="admin-pricing-add-cancel"
                onClick={() => {
                  setShowAddModal(false);
                  setAddForm(EMPTY_ADD_FORM);
                }}
                className="h-10 rounded-lg border border-gray-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-gray-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={adding}
                data-testid="admin-pricing-add-submit"
                className="inline-flex h-10 items-center gap-2 rounded-lg bg-amber-500 px-4 text-sm font-bold text-white transition hover:bg-amber-600 disabled:cursor-wait disabled:opacity-50"
              >
                {adding ? <LoaderCircle aria-hidden="true" className="h-4 w-4 animate-spin" /> : <Plus aria-hidden="true" className="h-4 w-4" />}
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
  const GroupIcon = title === "Platform services" ? CloudCog : Boxes;
  const activeCount = rows.filter((service) => service.isActive).length;

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-gray-200 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600">
            <GroupIcon aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900">{title}</h2>
            <p className="mt-1 max-w-4xl text-sm leading-5 text-slate-500">{description}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-slate-600">
            {rows.length} total
          </span>
          <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
            {activeCount} active
          </span>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="px-5 py-10 text-center text-sm text-slate-500">
          No services in this group.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table data-testid={testId} className="w-full min-w-[1040px] text-left text-sm">
            <thead className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="w-44 px-5 py-3">Service ID</th>
                <th className="px-4 py-3">Service</th>
                <th className="px-4 py-3">Invoice label</th>
                <th className="w-28 px-4 py-3">Unit</th>
                <th className="w-36 px-4 py-3">Actual cost</th>
                <th className="w-36 px-4 py-3">Billing cost</th>
                <th className="w-60 px-5 py-3 text-right">Actions</th>
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
                    className={`border-b border-gray-100 transition last:border-b-0 ${
                      isEditing ? "bg-amber-50/40" : "hover:bg-slate-50/70"
                    }`}
                    data-testid={`admin-pricing-row-${service.code}`}
                  >
                    <td className="px-5 py-4">
                      <span className="inline-flex rounded-md bg-slate-100 px-2.5 py-1 font-mono text-xs font-semibold text-slate-600">
                        {service.code}
                      </span>
                    </td>
                    <td className="px-4 py-4">
                      <input
                        disabled={!isEditing || saving}
                        value={draft?.name ?? ""}
                        onChange={(event) => onDraftChange(service.id, "name", event.target.value)}
                        aria-label={`Service name for ${service.code}`}
                        className="h-9 w-44 rounded-lg border border-gray-200 bg-white px-3 font-semibold text-slate-900 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <input
                        disabled={!isEditing || saving}
                        value={draft?.role ?? ""}
                        placeholder="Customer-facing label"
                        onChange={(event) => onDraftChange(service.id, "role", event.target.value)}
                        aria-label={`Invoice label for ${service.code}`}
                        className="h-9 w-52 rounded-lg border border-gray-200 bg-white px-3 text-slate-600 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <select
                        disabled={!isEditing || saving}
                        value={draft?.unit ?? service.unit}
                        onChange={(event) => onDraftChange(service.id, "unit", event.target.value as UsageServiceUnit)}
                        aria-label={`Billing unit for ${service.code}`}
                        className="h-9 w-24 rounded-lg border border-gray-200 bg-white px-2 text-slate-600 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:border-transparent disabled:bg-transparent"
                      >
                        {Object.entries(UNIT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        data-testid={`admin-pricing-actual-${service.code}`}
                        value={draft?.actualCostUsd ?? ""}
                        disabled={!isEditing || saving}
                        onChange={(event) => onDraftChange(service.id, "actualCostUsd", event.target.value)}
                        aria-label={`Actual cost for ${service.code}`}
                        className="h-9 w-28 rounded-lg border border-gray-200 bg-white px-3 font-mono text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-4 py-4">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        data-testid={`admin-pricing-updated-${service.code}`}
                        value={draft?.updatedCostUsd ?? ""}
                        disabled={!isEditing || saving}
                        onChange={(event) => onDraftChange(service.id, "updatedCostUsd", event.target.value)}
                        aria-label={`Billing cost for ${service.code}`}
                        className="h-9 w-28 rounded-lg border border-gray-200 bg-white px-3 font-mono font-semibold text-emerald-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 disabled:border-transparent disabled:bg-transparent"
                      />
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex min-h-9 items-center justify-end gap-2">
                        {isEditing ? (
                          <>
                            <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-600">
                              <input
                                type="checkbox"
                                checked={draft?.isActive ?? false}
                                disabled={saving}
                                onChange={(event) => onDraftChange(service.id, "isActive", event.target.checked)}
                                className="peer sr-only"
                              />
                              <span className="relative h-5 w-9 rounded-full bg-gray-300 transition after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-emerald-500 peer-checked:after:translate-x-4 peer-disabled:opacity-50" />
                              Active
                            </label>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => onCancel(service)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-slate-600 transition hover:bg-gray-100 disabled:opacity-50"
                            >
                              <X aria-hidden="true" className="h-3.5 w-3.5" />
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <span
                              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                                service.isActive
                                  ? "bg-emerald-50 text-emerald-700"
                                  : "bg-gray-100 text-slate-500"
                              }`}
                            >
                              {service.isActive ? <Check aria-hidden="true" className="h-3 w-3" /> : null}
                              {service.isActive ? "Active" : "Inactive"}
                            </span>
                            <button
                              type="button"
                              disabled={saving}
                              data-testid={`admin-pricing-edit-${service.code}`}
                              onClick={() => onEdit(service)}
                              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-xs font-bold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-800 disabled:opacity-50"
                            >
                              <Pencil aria-hidden="true" className="h-3.5 w-3.5" />
                              Edit
                            </button>
                          </>
                        )}
                        {isDirty ? (
                          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800">
                            Unsaved
                          </span>
                        ) : null}
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
  testId,
  icon: Icon,
  tone
}: {
  label: string;
  value: string;
  hint: string;
  testId: string;
  icon: LucideIcon;
  tone: "slate" | "emerald" | "sky" | "amber";
}) {
  const toneStyles = {
    slate: "bg-slate-100 text-slate-700",
    emerald: "bg-emerald-50 text-emerald-700",
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700"
  };

  return (
    <div
      data-testid={testId}
      className="flex min-h-36 flex-col rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase text-slate-500">{label}</p>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneStyles[tone]}`}>
          <Icon aria-hidden="true" className="h-4 w-4" />
        </span>
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
      <p className="mt-auto pt-2 text-xs leading-5 text-slate-500">{hint}</p>
    </div>
  );
}
