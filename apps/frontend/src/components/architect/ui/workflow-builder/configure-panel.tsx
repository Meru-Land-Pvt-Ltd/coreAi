import { BuilderIcon } from "./icons";

export function ConfigurePanel({
  agentName,
  tagline,
  price,
  saving = false,
  statusMessage = "",
  onAgentNameChange,
  onTaglineChange,
  onPriceChange,
  onSave
}: {
  agentName: string;
  tagline: string;
  price: string;
  saving?: boolean;
  statusMessage?: string;
  onAgentNameChange: (value: string) => void;
  onTaglineChange: (value: string) => void;
  onPriceChange: (value: string) => void;
  onSave?: () => void;
}) {
  return (
    <section className="builder-view fade-enter overflow-y-auto bg-gray-50 scroll-thin">
      <div className="mx-auto max-w-3xl px-6 py-8">
        <h2 className="text-xl font-bold text-slate-900" data-testid="architect-ui-workflow-builder-configure-panel-configure-agent-heading">Configure agent</h2>
        <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-these-details-shape-how-your-agent-appears-text">These details shape how your agent appears and behaves in the marketplace.</p>

        <div className="mt-6 divide-y divide-gray-100 rounded-2xl border border-gray-100 bg-white shadow-sm">
          <div className="p-5">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-configure-panel-marketplace-details-heading">Marketplace details</h3>
            <div className="space-y-4">
              <label data-testid="architect-ui-workflow-builder-configure-panel-agent-on-agent-change-event-full-lg-label">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-agent-text">Agent name</span>
                <input data-testid="configure-agent-name-input"
                  type="text"
                  value={agentName}
                  onChange={(event) => onAgentNameChange(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                />
              </label>
              <label data-testid="architect-ui-workflow-builder-configure-panel-tagline-on-tagline-change-event-placeholder-never">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-tagline-text">Tagline</span>
                <input data-testid="configure-tagline-input"
                  type="text"
                  value={tagline}
                  onChange={(event) => onTaglineChange(event.target.value)}
                  placeholder="Never lose a patient to a missed call again."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                />
              </label>
              <div className="grid gap-4 sm:grid-cols-2">
                <label data-testid="architect-ui-workflow-builder-configure-panel-category-healthcare-dental-real-estate-home-servic">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-category-text">Category</span>
                  <div className="relative">
                    <select data-testid="configure-category-select" className="w-full appearance-none rounded-lg border border-gray-200 px-3 py-2 pr-9 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50">
                      <option>Healthcare & Dental</option>
                      <option>Real Estate</option>
                      <option>Home Services</option>
                      <option>Hospitality</option>
                      <option>Professional Services</option>
                    </select>
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><BuilderIcon name="chevron" className="h-4 w-4" /></span>
                  </div>
                </label>
                <label data-testid="architect-ui-workflow-builder-configure-panel-audience-dental-practices-medical-clinics-small-bu">
                  <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-audience-text">Audience</span>
                  <div className="relative">
                    <select data-testid="configure-audience-select" className="w-full appearance-none rounded-lg border border-gray-200 px-3 py-2 pr-9 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50">
                      <option>Dental practices</option>
                      <option>Medical clinics</option>
                      <option>Small businesses</option>
                    </select>
                    <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400"><BuilderIcon name="chevron" className="h-4 w-4" /></span>
                  </div>
                </label>
              </div>
              <label data-testid="architect-ui-workflow-builder-configure-panel-description-label">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-description-text">Description</span>
                <textarea data-testid="configure-description-textarea"
                  defaultValue="Automatically sends a warm, personalized text to anyone who calls your practice after hours or while you are with a patient - turning missed calls into booked appointments."
                  className="h-[90px] w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                />
              </label>
            </div>
          </div>

          <div className="p-5">
            <h3 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-configure-panel-pricing-heading">Pricing</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button type="button" data-testid="configure-pricing-monthly" className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-left transition">
                <span className="text-sm font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-configure-panel-monthly-subscription-text">Monthly subscription</span>
                <p className="mt-0.5 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-recurring-revenue-per-install-text">Recurring revenue per install</p>
              </button>
              <button type="button" data-testid="configure-pricing-onetime" className="rounded-xl border-2 border-gray-200 bg-white px-4 py-3 text-left transition hover:border-amber-200">
                <span className="text-sm font-semibold text-slate-900" data-testid="architect-ui-workflow-builder-configure-panel-one-time-purchase-text">One-time purchase</span>
                <p className="mt-0.5 text-xs text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-single-upfront-payment-text">Single upfront payment</p>
              </button>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label data-testid="architect-ui-workflow-builder-configure-panel-price-usd-month-on-price-change-event-label">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500" data-testid="architect-ui-workflow-builder-configure-panel-price-usd-month-text">Price (USD / month)</span>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">$</span>
                  <input data-testid="configure-price-input"
                    type="text"
                    value={price}
                    onChange={(event) => onPriceChange(event.target.value)}
                    className="w-full rounded-lg border border-gray-200 py-2 pl-7 pr-3 font-mono text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
                  />
                </div>
              </label>
              <div className="flex items-end pb-1">
                <div className="flex w-full items-center justify-between">
                  <span className="text-sm text-slate-600" data-testid="architect-ui-workflow-builder-configure-panel-offer-14-day-free-trial-text">Offer 14-day free trial</span>
                  <div className="toggle on" role="switch" aria-checked="true"><div className="knob" /></div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-5">
            <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-slate-400" data-testid="architect-ui-workflow-builder-configure-panel-integrations-used-heading">Integrations used</h3>
            <div className="flex flex-wrap gap-2">
              {['Twilio SMS', 'OpenAI GPT-4o', 'Google Calendar'].map((item) => (
                <span key={item} data-testid={`configure-panel-integration-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-slate-600">{item}</span>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-end gap-3">
          {statusMessage ? (
            <span
              data-testid="configure-status"
              className="text-xs font-semibold text-slate-500"
            >
              {saving ? "Saving..." : statusMessage}
            </span>
          ) : null}
          <button
            data-testid="configure-save"
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
          >
            {saving ? "Saving..." : "Save configuration"}
          </button>
        </div>
      </div>
    </section>
  );
}
