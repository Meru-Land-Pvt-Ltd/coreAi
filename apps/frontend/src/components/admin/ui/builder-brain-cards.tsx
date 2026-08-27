"use client";

/**
 * Admin → the AI Builder's brain, and his eyes.
 *
 * Two cards, one shape, sitting beside the door and page batteries. Born on
 * 2026-08-27 from a real failure: the Builder's seeing model was hard-coded,
 * the platform's key did not carry it, every pasted screenshot was refused —
 * and only a developer could fix it. Now the founder fixes it in ten seconds.
 *
 * The eyes card says plainly which services can see, and saving an eyeless
 * one is allowed with an honest warning rather than a refusal: an admin may
 * be preparing for a key that arrives tomorrow.
 */

import { useCallback, useEffect, useState } from "react";
import {
  ADMIN_BUILDER_BRAIN_FALLBACK_PROVIDERS,
  ADMIN_BUILDER_BRAIN_MODEL_MAX_LENGTH,
  getAdminBuilderBrain,
  getAdminBuilderEyes,
  updateAdminBuilderBrain,
  updateAdminBuilderEyes,
  type AdminBuilderBrainOption,
  type AdminBuilderEyes
} from "@/components/admin/features/builder-brains";

type Slot = "brain" | "eyes";

const COPY: Record<Slot, { heading: string; explainer: string; saveLabel: string; testId: string }> = {
  brain: {
    heading: "The AI Builder's Brain",
    explainer:
      "The employee architects talk to. It builds their agents, explains what a run did, and makes the changes they ask for. Change it any time — the next answer uses it.",
    saveLabel: "Save the Builder's brain",
    testId: "admin-builder-brain"
  },
  eyes: {
    heading: "The AI Builder's Eyes",
    explainer:
      "The brain that looks at screenshots an architect pastes into the chat. Not every AI service can see pictures — the ones that can are marked below.",
    saveLabel: "Save the Builder's eyes",
    testId: "admin-builder-eyes"
  }
};

function BuilderSlotCard({ slot }: { slot: Slot }) {
  const copy = COPY[slot];
  const [providers, setProviders] = useState<AdminBuilderBrainOption[]>([]);
  const [models, setModels] = useState<AdminBuilderBrainOption[]>([]);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [isDefault, setIsDefault] = useState(true);
  const [servicesThatSee, setServicesThatSee] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const response =
      slot === "brain"
        ? await getAdminBuilderBrain().then((result) =>
            result.success && result.data
              ? { success: true as const, data: result.data.builderBrain }
              : { success: false as const, data: undefined }
          )
        : await getAdminBuilderEyes().then((result) =>
            result.success && result.data
              ? { success: true as const, data: result.data.builderEyes as AdminBuilderEyes }
              : { success: false as const, data: undefined }
          );
    if (response.success && response.data) {
      const data = response.data;
      setProviders(data.providers.length > 0 ? data.providers : ADMIN_BUILDER_BRAIN_FALLBACK_PROVIDERS);
      setModels(data.models);
      setProvider(data.providerId);
      setModel(data.modelId ?? "");
      setIsDefault(data.isDefault);
      if (slot === "eyes") setServicesThatSee((data as AdminBuilderEyes).servicesThatSee ?? []);
    } else {
      setError("These settings could not be loaded. Refresh the page to try again.");
    }
    setLoading(false);
  }, [slot]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(restore = false) {
    setSaving(true);
    setMessage("");
    setError("");
    const payload = restore ? { provider: "", model: "" } : { provider, model: model.trim() };
    const response =
      slot === "brain" ? await updateAdminBuilderBrain(payload) : await updateAdminBuilderEyes(payload);
    setSaving(false);
    if (!response.success) {
      setError(response.error ?? "That could not be saved. Try again.");
      return;
    }
    setMessage(response.message ?? "Saved.");
    void load();
  }

  const canSee = slot !== "eyes" || servicesThatSee.includes(provider.toLowerCase());

  return (
    <section
      data-testid={`${copy.testId}-card`}
      className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-bold text-slate-900" data-testid={`${copy.testId}-heading`}>
          {copy.heading}
        </h2>
        <span
          data-testid={`${copy.testId}-status`}
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
            isDefault
              ? "border-slate-200 bg-slate-50 text-slate-500"
              : "border-green-200 bg-green-50 text-green-700"
          }`}
        >
          {isDefault ? "Platform default" : "Customized"}
        </span>
      </div>

      <p className="mt-1 text-sm text-slate-600" data-testid={`${copy.testId}-explainer`}>
        {copy.explainer}
      </p>

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                AI service
              </span>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                data-testid={`${copy.testId}-provider`}
                className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-amber-400"
              >
                {providers.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                    {slot === "eyes" && servicesThatSee.includes(option.id.toLowerCase()) ? " — can see" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Model <span className="font-normal normal-case text-slate-400">(optional)</span>
              </span>
              <input
                value={model}
                onChange={(event) => setModel(event.target.value)}
                maxLength={ADMIN_BUILDER_BRAIN_MODEL_MAX_LENGTH}
                list={`${copy.testId}-models`}
                placeholder="Leave blank for the standard model"
                data-testid={`${copy.testId}-model`}
                className="mt-1.5 h-11 w-full rounded-xl border border-gray-200 px-3 text-sm text-slate-800 outline-none focus:border-amber-400"
              />
              <datalist id={`${copy.testId}-models`}>
                {models.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.displayName}
                  </option>
                ))}
              </datalist>
            </label>
          </div>

          {slot === "eyes" && !canSee ? (
            <p className="mt-3 text-[12px] leading-5 text-amber-700" data-testid="admin-builder-eyes-cannot-see">
              This service cannot look at pictures. Screenshots will be answered honestly rather than
              read.
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void save(true)}
              disabled={saving}
              data-testid={`${copy.testId}-restore`}
              className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              Use the standard brain
            </button>
            <button
              type="button"
              onClick={() => void save(false)}
              disabled={saving}
              data-testid={`${copy.testId}-save`}
              className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {saving ? "Saving…" : copy.saveLabel}
            </button>
          </div>

          <p className="mt-2 text-[12px] text-slate-500">
            Leave the model blank and the chosen service uses its own standard model.
          </p>

          {message ? (
            <p className="mt-2 text-[12px] text-emerald-700" data-testid={`${copy.testId}-message`}>
              {message}
            </p>
          ) : null}
          {error ? (
            <p className="mt-2 text-[12px] text-red-600" data-testid={`${copy.testId}-error`}>
              {error}
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

export function BuilderBrainCard() {
  return <BuilderSlotCard slot="brain" />;
}

export function BuilderEyesCard() {
  return <BuilderSlotCard slot="eyes" />;
}
