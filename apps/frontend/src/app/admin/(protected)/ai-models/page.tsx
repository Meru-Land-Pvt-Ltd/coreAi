"use client";

/**
 * AI MODELS — adding one without waiting for a release.
 *
 * The model list shipped with the code, so offering architects a model that
 * came out on Tuesday meant an edit, a review and a deploy. Providers publish
 * constantly; an architect who cannot pick this week's model is building on
 * last month's platform.
 *
 * Two things this screen deliberately does NOT do:
 *
 *  • Add a PROVIDER. That needs an adapter that speaks its API — code somebody
 *    writes and tests. A form that produced a provider nothing can call would
 *    be a form that produces a broken agent.
 *
 *  • Let anyone rewrite a built-in model. Its name and price are ours, shipped
 *    with a release. They can be switched OFF here, because a model that starts
 *    refusing calls has to be removable today, not at the next release.
 */

import { useCallback, useEffect, useState } from "react";
import {
  getAdminLlmModels,
  saveAdminLlmModel,
  removeAdminLlmModel,
  type AdminLlmModel
} from "@/components/admin/features/api";

const CATEGORIES = [
  { value: "flagship", label: "Flagship — the balanced one" },
  { value: "thinking", label: "Thinking — slower, reasons harder" },
  { value: "fast", label: "Fast — cheap and quick" },
  { value: "code", label: "Coding" },
  { value: "legacy", label: "Legacy — kept for old agents" }
];

const BLANK = {
  modelId: "",
  providerId: "",
  displayName: "",
  category: "flagship",
  inputPricePer1M: "",
  outputPricePer1M: "",
  multimodal: false
};

export default function AdminAiModelsPage() {
  const [providers, setProviders] = useState<string[]>([]);
  const [models, setModels] = useState<AdminLlmModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await getAdminLlmModels();
    if (response.success && response.data) {
      setProviders(response.data.providers);
      setModels(response.data.models);
      setForm((current) => ({ ...current, providerId: current.providerId || response.data!.providers[0] || "" }));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    setSaving(true);
    setProblem("");
    setNotice("");

    const response = await saveAdminLlmModel({
      modelId: form.modelId.trim(),
      providerId: form.providerId,
      displayName: form.displayName.trim(),
      category: form.category,
      inputPricePer1M: form.inputPricePer1M === "" ? null : Number(form.inputPricePer1M),
      outputPricePer1M: form.outputPricePer1M === "" ? null : Number(form.outputPricePer1M),
      multimodal: form.multimodal
    });

    setSaving(false);

    if (!response.success) {
      // The server's own sentence, because it is the one that knows why.
      setProblem(response.message ?? response.error ?? "That could not be saved.");
      return;
    }

    setNotice(`${form.displayName || form.modelId} is now in every AI Brain.`);
    setForm({ ...BLANK, providerId: form.providerId });
    void load();
  };

  const remove = async (modelId: string) => {
    await removeAdminLlmModel(modelId);
    setNotice(`${modelId} removed. Agents already saved with it keep their setting.`);
    void load();
  };

  const byProvider = providers.map((providerId) => ({
    providerId,
    models: models.filter((model) => model.providerId === providerId)
  }));

  return (
    <div className="mx-auto max-w-5xl px-6 py-8" data-testid="admin-ai-models-page">
      <h1 className="text-2xl font-black tracking-tight text-slate-900" data-testid="admin-ai-models-title">
        AI models
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Every model an architect can pick in an AI Brain. Add one here and it appears immediately —
        no release, no deploy.
      </p>

      {/* ---------------------------------------------------------------- add */}
      <section className="mt-6 rounded-2xl border border-gray-200 p-5">
        <h2 className="text-sm font-bold text-slate-900">Add a model</h2>
        <p className="mt-1 text-[12px] leading-5 text-slate-500">
          The model id is what gets sent to the provider — copy it exactly from their documentation.
          A provider that isn&apos;t listed needs an adapter first, which is a release.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Provider</span>
            <select
              value={form.providerId}
              onChange={(event) => setForm({ ...form, providerId: event.target.value })}
              data-testid="admin-ai-models-provider"
              className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            >
              {providers.map((providerId) => (
                <option key={providerId} value={providerId}>
                  {providerId}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Model id</span>
            <input
              value={form.modelId}
              onChange={(event) => setForm({ ...form, modelId: event.target.value })}
              placeholder="gpt-5.6"
              data-testid="admin-ai-models-id"
              className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 font-mono text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Name architects see</span>
            <input
              value={form.displayName}
              onChange={(event) => setForm({ ...form, displayName: event.target.value })}
              placeholder="GPT-5.6"
              data-testid="admin-ai-models-name"
              className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Kind</span>
            <select
              value={form.category}
              onChange={(event) => setForm({ ...form, category: event.target.value })}
              data-testid="admin-ai-models-category"
              className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            >
              {CATEGORIES.map((category) => (
                <option key={category.value} value={category.value}>
                  {category.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Input price / 1M
            </span>
            <input
              value={form.inputPricePer1M}
              onChange={(event) => setForm({ ...form, inputPricePer1M: event.target.value })}
              placeholder="leave empty if unknown"
              inputMode="decimal"
              data-testid="admin-ai-models-input-price"
              className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Output price / 1M
            </span>
            <input
              value={form.outputPricePer1M}
              onChange={(event) => setForm({ ...form, outputPricePer1M: event.target.value })}
              placeholder="leave empty if unknown"
              inputMode="decimal"
              data-testid="admin-ai-models-output-price"
              className="mt-1 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
          </label>
        </div>

        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={form.multimodal}
            onChange={(event) => setForm({ ...form, multimodal: event.target.checked })}
            data-testid="admin-ai-models-multimodal"
            className="h-4 w-4 rounded border-gray-300"
          />
          <span className="text-sm text-slate-700">It can read images and PDFs</span>
        </label>

        {problem ? (
          <p
            className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700"
            data-testid="admin-ai-models-problem"
          >
            {problem}
          </p>
        ) : null}

        {notice ? (
          <p
            className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800"
            data-testid="admin-ai-models-notice"
          >
            {notice}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          data-testid="admin-ai-models-save"
          className="mt-4 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Adding…" : "Add model"}
        </button>
      </section>

      {/* --------------------------------------------------------------- list */}
      <section className="mt-8">
        {loading ? <p className="text-sm text-slate-500">Loading…</p> : null}

        {byProvider.map((group) => (
          <div key={group.providerId} className="mb-6">
            <h2 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {group.providerId} · {group.models.length}
            </h2>

            <div className="space-y-1.5">
              {group.models.map((model) => (
                <div
                  key={model.id}
                  data-testid={`admin-ai-model-${model.id}`}
                  className="flex items-center gap-3 rounded-xl border border-gray-200 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="text-sm font-semibold text-slate-900">{model.displayName}</span>
                    <span className="ml-2 font-mono text-[11px] text-slate-400">{model.id}</span>
                  </span>

                  <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-600">
                    {model.badge}
                  </span>

                  {model.source === "admin" ? (
                    <>
                      <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                        Added here
                      </span>
                      <button
                        type="button"
                        onClick={() => void remove(model.id)}
                        data-testid={`admin-ai-model-remove-${model.id}`}
                        className="shrink-0 text-[12px] font-semibold text-red-600 hover:underline"
                      >
                        Remove
                      </button>
                    </>
                  ) : (
                    <span className="shrink-0 text-[10px] font-medium text-slate-400">shipped</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
