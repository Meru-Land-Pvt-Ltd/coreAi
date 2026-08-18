"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getLlmModelsForProvider } from "@coreai/shared";
import {
  ADMIN_DOOR_BRAIN_FALLBACK_PROVIDERS,
  ADMIN_DOOR_BRAIN_MODEL_MAX_LENGTH,
  getAdminDoorBrain,
  updateAdminDoorBrain,
  type AdminDoorBrainOption
} from "@/components/admin/features/door-brain";

/**
 * Admin → Door Brain card.
 *
 * One AI, one place. Every step on the platform reads what arrives and tidies
 * what it returns using this brain; swapping it here swaps it everywhere at
 * once. The model box is optional — left blank, the chosen service uses its own
 * default — and saving both blank puts the standard brain back.
 */

export function DoorBrainCard() {
  const [providers, setProviders] = useState<AdminDoorBrainOption[]>([]);
  const [apiModels, setApiModels] = useState<AdminDoorBrainOption[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [savedProvider, setSavedProvider] = useState("");
  const [savedModel, setSavedModel] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response = await getAdminDoorBrain();
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not load the door brain.");
      setLoading(false);
      return;
    }
    const { doorBrain } = response.data;
    setProviders(
      doorBrain.providers.length > 0 ? doorBrain.providers : ADMIN_DOOR_BRAIN_FALLBACK_PROVIDERS
    );
    setApiModels(doorBrain.models ?? []);
    setProvider(doorBrain.providerId);
    setSavedProvider(doorBrain.providerId);
    setModel(doorBrain.modelId ?? "");
    setSavedModel(doorBrain.modelId ?? "");
    setIsDefault(doorBrain.isDefault);
    setError("");
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Models follow whatever service is selected right now, not the saved one —
  // the list is only a suggestion, a brand-new model id can still be typed in.
  const modelSuggestions = useMemo<AdminDoorBrainOption[]>(() => {
    const catalog = getLlmModelsForProvider(provider).map((entry) => ({
      id: entry.id,
      displayName: entry.displayName
    }));
    if (catalog.length > 0) return catalog;
    return provider === savedProvider ? apiModels : [];
  }, [provider, savedProvider, apiModels]);

  const dirty = provider !== savedProvider || model.trim() !== savedModel;

  async function submit(nextProvider: string, nextModel: string, restoring: boolean) {
    setSaving(true);
    setMessage("");
    setError("");

    const response = await updateAdminDoorBrain({ provider: nextProvider, model: nextModel });
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not save the door brain.");
      setSaving(false);
      return;
    }

    const { doorBrain, restoredDefault } = response.data;
    if (doorBrain.providers.length > 0) setProviders(doorBrain.providers);
    setApiModels(doorBrain.models ?? []);
    setProvider(doorBrain.providerId);
    setSavedProvider(doorBrain.providerId);
    setModel(doorBrain.modelId ?? "");
    setSavedModel(doorBrain.modelId ?? "");
    setIsDefault(doorBrain.isDefault);
    setMessage(
      restoring || restoredDefault
        ? "Back to the standard brain. Every step switched over right away."
        : "Saved. Every step switched over right away."
    );
    setSaving(false);
  }

  return (
    <section
      data-testid="admin-door-brain-card"
      className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900" data-testid="admin-door-brain-heading">
          Door Brain
        </h2>
        <span
          data-testid="admin-door-brain-status"
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            isDefault
              ? "border-slate-200 bg-slate-50 text-slate-500"
              : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {isDefault ? "Platform default" : "Customized"}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-600" data-testid="admin-door-brain-explainer">
        This brain runs the smart input and output inside every step. Change it any time —
        everything switches instantly.
      </p>

      {error ? (
        <div
          data-testid="admin-door-brain-error"
          className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {message ? (
        <div
          data-testid="admin-door-brain-message"
          className="mt-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700"
        >
          {message}
        </div>
      ) : null}

      {loading ? (
        <div
          data-testid="admin-door-brain-loading"
          className="mt-4 h-32 animate-pulse rounded-xl border border-gray-100 bg-gray-50"
        />
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="door-brain-provider" className="text-xs font-semibold text-slate-700">
                AI service
              </label>
              <select
                id="door-brain-provider"
                data-testid="admin-door-brain-provider"
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 focus:border-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-100"
              >
                {providers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="door-brain-model" className="text-xs font-semibold text-slate-700">
                Model <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="door-brain-model"
                type="text"
                data-testid="admin-door-brain-model"
                value={model}
                list="door-brain-model-options"
                maxLength={ADMIN_DOOR_BRAIN_MODEL_MAX_LENGTH}
                spellCheck={false}
                autoComplete="off"
                onChange={(event) => setModel(event.target.value)}
                placeholder="Leave blank for the standard one"
                className="mt-1.5 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-100"
              />
              <datalist id="door-brain-model-options" data-testid="admin-door-brain-model-options">
                {modelSuggestions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                  </option>
                ))}
              </datalist>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              data-testid="admin-door-brain-restore"
              onClick={() => void submit("", "", true)}
              disabled={saving || (isDefault && !dirty)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
            >
              Use the standard brain
            </button>
            <button
              type="button"
              data-testid="admin-door-brain-save"
              onClick={() => void submit(provider, model.trim(), false)}
              disabled={saving || !dirty}
              className="rounded-xl bg-amber-500 px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save door brain"}
            </button>
          </div>

          <p className="mt-3 text-[11px] text-slate-400" data-testid="admin-door-brain-hint">
            Leave the model blank and the chosen service uses its own standard model.
          </p>
        </>
      )}
    </section>
  );
}
