import { REQUIRED_INTEGRATION_DEFS, type RequiredIntegrationKey, type RequiredIntegrations } from "@coreai/shared";
import { BuilderIcon } from "../icons";

const INTEGRATION_ICONS: Record<RequiredIntegrationKey, string> = {
  phone: "phone",
  sms: "message",
  calendar: "calendar",
  email: "mail",
  crm: "capture",
  webhook: "git-branch",
  vapi: "mic",
  twilio: "phone-call"
};

export function RequiredIntegrationsSelector({
  value,
  onToggle,
  disabled = false,
  hiddenKeys = [],
  detectedKeys = []
}: {
  value: RequiredIntegrations;
  onToggle: (key: RequiredIntegrationKey) => void;
  disabled?: boolean;
  /** Integrations to omit entirely (e.g. SMS when the workflow never sends SMS). */
  hiddenKeys?: RequiredIntegrationKey[];
  /** Keys auto-derived from the workflow graph — shown with a "workflow" badge. */
  detectedKeys?: RequiredIntegrationKey[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {REQUIRED_INTEGRATION_DEFS.filter((def) => !hiddenKeys.includes(def.key)).map((def) => {
        const active = value[def.key];
        const fromWorkflow = detectedKeys.includes(def.key);

        return (
          <button
            key={def.key}
            type="button"
            data-testid={`configure-integration-toggle-${def.key}`}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onToggle(def.key)}
            className={
              active
                ? "flex items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50/60 px-4 py-3.5 text-left transition-all disabled:opacity-60"
                : "flex items-center gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3.5 text-left transition-all hover:border-amber-200 disabled:opacity-60"
            }
          >
            <span
              className={
                active
                  ? "flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-amber-500 text-white shadow-sm"
                  : "flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-gray-100 bg-gray-50 text-slate-400"
              }
            >
              <BuilderIcon name={INTEGRATION_ICONS[def.key]} className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="block text-sm font-semibold text-slate-800">{def.label}</span>
                {fromWorkflow ? (
                  <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                    <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/>
                    </svg>
                    workflow
                  </span>
                ) : null}
              </span>
              <span className="mt-0.5 block text-xs text-slate-400">{def.description}</span>
            </span>
            <span className={active ? "toggle on" : "toggle"} role="switch" aria-checked={active}>
              <span className="knob" />
            </span>
          </button>
        );
      })}
    </div>
  );
}
