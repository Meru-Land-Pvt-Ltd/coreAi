import { BuilderIcon } from "./icons";

export function PreviewModal({
  open,
  onClose,
  businessName = "Mitchell Dental"
}: {
  open: boolean;
  onClose: () => void;
  businessName?: string;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/45 backdrop-blur-[5px]"
      role="dialog"
      aria-modal="true"
      aria-label="End-user preview"
      style={{ animation: "fadeIn .2s ease" }}
    >
      <button type="button" data-testid="preview-modal-backdrop" className="absolute inset-0" aria-label="Close preview" onClick={onClose} />
      <div className="workflow-modal-card relative z-10 flex flex-col items-center">
        <button
          type="button"
          onClick={onClose}
          data-testid="preview-modal-close"
          className="absolute -right-2 -top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white text-slate-500 shadow-lg transition hover:text-slate-800 md:-right-12 md:top-0"
          aria-label="Close preview"
        >
          <BuilderIcon name="x" className="h-4 w-4" />
        </button>
        <p className="mb-4 text-sm font-medium text-white/80">What the patient sees on their phone</p>
        <div className="phone-shell h-[600px] w-[300px] rounded-[44px] bg-black p-2.5">
          <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[36px] bg-white">
            <div className="absolute left-1/2 top-0 z-20 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-black" />
            <div className="z-10 flex items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-slate-900">
              <span>9:41</span>
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor"><path d="M2 17h2v4H2zM6 13h2v8H6zM10 9h2v12h-2zM14 5h2v16h-2zM18 3h2v18h-2z" opacity=".9" /></svg>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="M12 4C7 4 2.7 6.1 0 9.4L12 24 24 9.4C21.3 6.1 17 4 12 4z" opacity=".9" /></svg>
              </span>
            </div>
            <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-3 text-center">
              <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700">MD</div>
              <p className="mt-1.5 text-sm font-semibold text-slate-900">{businessName}</p>
              <p className="text-[11px] text-slate-400">SMS - Text Message</p>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto bg-white px-4 py-5">
              <p className="text-center text-[10px] uppercase tracking-wider text-slate-400">Today 2:14 PM</p>
              <div className="flex">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-sm">
                  Hi! We noticed we missed your call at {businessName}. Sorry about that! Would you like to schedule an appointment? Reply YES and we&apos;ll get you booked. {"\u{1F60A}"}
                </div>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[70%] rounded-2xl rounded-br-md bg-green-500 px-3.5 py-2.5 text-[13px] leading-relaxed text-white shadow-sm">YES please!</div>
              </div>
              <div className="flex">
                <div className="max-w-[80%] rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800 shadow-sm">
                  Great! {"\u{1F389}"} Here are our next openings - tap one to confirm:
                  <span className="mt-2 block rounded-lg border border-amber-100 bg-white px-3 py-1.5 font-medium text-amber-600">Tomorrow - 10:30 AM</span>
                  <span className="mt-1.5 block rounded-lg border border-amber-100 bg-white px-3 py-1.5 font-medium text-amber-600">Tomorrow - 3:00 PM</span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-2.5">
              <div className="flex-1 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[13px] text-slate-400">Text Message</div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                <BuilderIcon name="send" className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
