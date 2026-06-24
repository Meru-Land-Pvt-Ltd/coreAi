export function ConfigurePanel({
  agentName,
  tagline,
  price,
  onAgentNameChange,
  onTaglineChange,
  onPriceChange
}: {
  agentName: string;
  tagline: string;
  price: string;
  onAgentNameChange: (value: string) => void;
  onTaglineChange: (value: string) => void;
  onPriceChange: (value: string) => void;
}) {
  return (
    <section className="absolute inset-0 overflow-y-auto bg-gray-50">
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
        <h2 className="text-xl font-black text-slate-900">Configure agent</h2>
        <p className="mt-1 text-sm text-slate-500">
          Set marketplace details and connector behavior for Twilio/SMS or Gmail agents.
        </p>
        <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Agent name</span>
              <input
                value={agentName}
                onChange={(event) => onAgentNameChange(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Short description</span>
              <textarea
                value={tagline}
                onChange={(event) => onTaglineChange(event.target.value)}
                className="min-h-24 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Category</span>
              <input value="Communication" readOnly className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-slate-800" />
            </label>
            <label>
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Price / month</span>
              <input
                value={price}
                onChange={(event) => onPriceChange(event.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
