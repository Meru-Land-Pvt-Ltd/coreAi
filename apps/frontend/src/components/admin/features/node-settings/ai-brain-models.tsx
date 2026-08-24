"use client";

/**
 * THE AI BRAIN'S CONTROL PANEL.
 *
 * One screen for every decision about an LLM: is the key working, is the
 * provider on, which of its models may architects use, what do they cost.
 *
 * It replaced a form that made an admin type a model id copied out of a
 * provider's documentation. The founder called that useless and was right — the
 * provider already publishes the list, so typing it was work we invented, and
 * one typo produced a model that looked real in a dropdown and failed on the
 * first customer. Models are fetched now. An admin never types an id.
 *
 * A table, not cards: sixty models across seven providers, each with two
 * switches, a name, two prices and a state. Cards cannot hold that and stay
 * readable. One row per model, columns aligned, nothing decorative.
 */

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";
import {
  getLlmControl,
  patchLlmModel,
  saveLlmKey,
  setLlmProviderEnabled,
  type LlmModelRow,
  type LlmProviderHealth,
  type LlmProviderView
} from "@/components/admin/features/api";

function Health({ health }: { health: LlmProviderHealth }) {
  const tone =
    health.state === "working"
      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
      : health.state === "no-key"
        ? "border-slate-200 bg-slate-50 text-slate-500"
        : "border-red-200 bg-red-50 text-red-700";

  const label = health.state === "working" ? "Working" : health.state === "no-key" ? "No key" : health.detail;

  return (
    <span
      className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${tone}`}
      data-testid="llm-provider-health"
    >
      {label}
    </span>
  );
}

function Switch({
  on,
  onClick,
  busy,
  testId,
  label
}: {
  on: boolean;
  onClick: () => void;
  busy?: boolean;
  testId: string;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      disabled={busy}
      data-testid={testId}
      className={`relative h-5 w-9 shrink-0 rounded-full transition disabled:opacity-40 ${
        on ? "bg-emerald-500" : "bg-gray-300"
      }`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? "left-[1.15rem]" : "left-0.5"
        }`}
      />
    </button>
  );
}

/** A price cell that only saves when the admin leaves it. */
function PriceCell({
  value,
  onSave,
  testId
}: {
  value: number | null;
  onSave: (next: number | null) => void;
  testId: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  return (
    <input
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        const next = trimmed === "" ? null : Number(trimmed);
        if (trimmed !== "" && !Number.isFinite(next)) {
          setDraft(value === null ? "" : String(value));
          return;
        }
        if (next !== value) onSave(next);
      }}
      inputMode="decimal"
      placeholder="—"
      data-testid={testId}
      className="w-20 rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-right font-mono text-[12px] text-slate-700 transition hover:border-gray-200 focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-100"
    />
  );
}

function ModelRow({
  providerId,
  model,
  onPatch
}: {
  providerId: string;
  model: LlmModelRow;
  onPatch: (modelId: string, patch: Partial<LlmModelRow>) => void;
}) {
  const [name, setName] = useState(model.displayName);

  useEffect(() => {
    setName(model.displayName);
  }, [model.displayName]);

  return (
    <tr className="border-t border-gray-100" data-testid={`llm-model-${model.modelId}`}>
      <td className="py-2 pl-4 pr-3">
        <span className="font-mono text-[12px] text-slate-500">{model.modelId}</span>
        {model.providerName && model.providerName !== model.modelId ? (
          <span className="ml-2 text-[11px] text-slate-400">{model.providerName}</span>
        ) : null}
      </td>

      <td className="px-3 py-2">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() !== model.displayName) onPatch(model.modelId, { displayName: name.trim() });
          }}
          placeholder={model.modelId}
          data-testid={`llm-model-name-${model.modelId}`}
          className="w-full rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[13px] font-medium text-slate-900 transition hover:border-gray-200 focus:border-amber-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-amber-100"
        />
      </td>

      <td className="px-3 py-2 text-center">
        <Switch
          on={model.enabled}
          onClick={() => onPatch(model.modelId, { enabled: !model.enabled })}
          testId={`llm-model-available-${model.modelId}`}
          label={`Available in new agents: ${model.modelId}`}
        />
      </td>

      <td className="px-3 py-2 text-center">
        <Switch
          on={model.runningEnabled}
          onClick={() => onPatch(model.modelId, { runningEnabled: !model.runningEnabled })}
          testId={`llm-model-running-${model.modelId}`}
          label={`Running in existing agents: ${model.modelId}`}
        />
      </td>

      <td className="px-3 py-2 text-right">
        <PriceCell
          value={model.inputPricePer1M}
          onSave={(next) => onPatch(model.modelId, { inputPricePer1M: next })}
          testId={`llm-model-in-price-${model.modelId}`}
        />
      </td>

      <td className="py-2 pl-3 pr-4 text-right">
        <PriceCell
          value={model.outputPricePer1M}
          onSave={(next) => onPatch(model.modelId, { outputPricePer1M: next })}
          testId={`llm-model-out-price-${model.modelId}`}
        />
      </td>
    </tr>
  );
}

function Provider({
  provider,
  onChanged
}: {
  provider: LlmProviderView;
  onChanged: () => void;
}) {
  /* Open when there is something to do: a provider with a problem or no key is
     the one an admin came here for. */
  const [open, setOpen] = useState(provider.health.state !== "working");
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);

  const patch = async (modelId: string, next: Partial<LlmModelRow>) => {
    await patchLlmModel(provider.providerId, modelId, next);
    onChanged();
  };

  const saveKey = async () => {
    if (!key.trim()) return;
    setSaving(true);
    await saveLlmKey(provider.providerId, provider.envKey, key.trim());
    setSaving(false);
    setKey("");
    onChanged();
  };

  const models = provider.models ?? [];
  const onCount = models.filter((model) => model.enabled).length;

  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-gray-200" data-testid={`llm-provider-${provider.providerId}`}>
      <header className="flex flex-wrap items-center gap-3 bg-slate-50/70 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          data-testid={`llm-provider-toggle-open-${provider.providerId}`}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
          )}
          <span className="truncate text-sm font-bold text-slate-900">{provider.displayName}</span>
          {provider.models ? (
            <span className="shrink-0 text-[11px] text-slate-400">
              {onCount} of {models.length} on
            </span>
          ) : null}
        </button>

        <Health health={provider.health} />

        <span className="flex shrink-0 items-center gap-2">
          <span className="text-[11px] font-medium text-slate-500">Enabled</span>
          <Switch
            on={provider.enabled}
            onClick={async () => {
              await setLlmProviderEnabled(provider.providerId, !provider.enabled);
              onChanged();
            }}
            testId={`llm-provider-enabled-${provider.providerId}`}
            label={`${provider.displayName} enabled`}
          />
        </span>
      </header>

      {open ? (
        <div className="px-4 py-3">
          {/* ------------------------------------------------------------ key */}
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={provider.hasKey ? "A key is saved — paste a new one to replace it" : "Paste the API key"}
              data-testid={`llm-provider-key-${provider.providerId}`}
              className="h-10 min-w-0 flex-1 rounded-xl border border-gray-200 px-3 font-mono text-[12px] outline-none focus:border-amber-300 focus:ring-4 focus:ring-amber-100"
            />
            <button
              type="button"
              onClick={() => void saveKey()}
              disabled={!key.trim() || saving}
              data-testid={`llm-provider-key-save-${provider.providerId}`}
              className="h-10 shrink-0 rounded-xl bg-slate-900 px-4 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save key"}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] text-slate-400">
            Stored encrypted. It is used the moment you save it — no restart.
          </p>

          {/* --------------------------------------------------------- models */}
          {provider.models === null ? (
            <p
              className="mt-4 rounded-lg border border-gray-200 bg-slate-50 px-4 py-3 text-[13px] text-slate-600"
              data-testid={`llm-provider-models-problem-${provider.providerId}`}
            >
              {provider.modelsProblem}
            </p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[720px] border-collapse">
                <thead>
                  <tr className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    <th className="py-2 pl-4 pr-3 text-left font-bold">Model</th>
                    <th className="px-3 py-2 text-left font-bold">Name architects see</th>
                    <th className="px-3 py-2 text-center font-bold">Available</th>
                    <th className="px-3 py-2 text-center font-bold">Running</th>
                    <th className="px-3 py-2 text-right font-bold">In / 1M</th>
                    <th className="py-2 pl-3 pr-4 text-right font-bold">Out / 1M</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((model) => (
                    <ModelRow
                      key={model.modelId}
                      providerId={provider.providerId}
                      model={model}
                      onPatch={patch}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

export function AiBrainModels() {
  const [providers, setProviders] = useState<LlmProviderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    const response = await getLlmControl(refresh);
    if (response.success && response.data) setProviders(response.data.providers);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div data-testid="admin-ai-models-panel">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-slate-900" data-testid="admin-ai-models-title">
            Models
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            The models each provider actually has, asked for directly. Switch on the ones architects
            may use, name them, and set what they cost us.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setRefreshing(true);
            void load(true);
          }}
          disabled={refreshing}
          data-testid="admin-ai-models-refresh"
          className="flex shrink-0 items-center gap-1.5 rounded-xl border border-gray-200 px-3 py-2 text-[13px] font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Asking providers…" : "Refresh"}
        </button>
      </div>

      <div className="mt-5">
        {loading ? <p className="text-sm text-slate-500">Asking every provider what it has…</p> : null}

        {providers.map((provider) => (
          <Provider key={provider.providerId} provider={provider} onChanged={() => void load()} />
        ))}
      </div>

      <p className="mt-2 text-[11px] leading-5 text-slate-400">
        A provider that is not listed needs an adapter that speaks its API — that is a release, not a
        setting. Everything above is data.
      </p>
    </div>
  );
}
