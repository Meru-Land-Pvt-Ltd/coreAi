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
  hiddenKeys = []
}: {
  value: RequiredIntegrations;
  onToggle: (key: RequiredIntegrationKey) => void;
  disabled?: boolean;
  /** Integrations to omit entirely (e.g. SMS when the workflow never sends SMS). */
  hiddenKeys?: RequiredIntegrationKey[];
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {REQUIRED_INTEGRATION_DEFS.filter((def) => !hiddenKeys.includes(def.key)).map((def) => {
        const active = value[def.key];

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
              <span className="block text-sm font-semibold text-slate-800">{def.label}</span>
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
