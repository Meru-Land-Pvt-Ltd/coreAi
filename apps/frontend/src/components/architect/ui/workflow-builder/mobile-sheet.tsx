import type { ReactNode } from "react";
import type { MobilePanel } from "./types";

export function MobileSheet({
  panel,
  children,
  onClose
}: {
  panel: MobilePanel;
  children: ReactNode;
  onClose: () => void;
}) {
  if (!panel) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-sm xl:hidden" role="dialog" aria-modal="true">
      <button type="button" aria-label="Close panel" data-testid="mobile-sheet-backdrop" onClick={onClose} className="absolute inset-0" />
      <aside className="absolute bottom-0 left-0 right-0 max-h-[82vh] overflow-hidden rounded-t-3xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <p className="text-sm font-black text-slate-900">{panel === "library" ? "Components" : "Properties"}</p>
          <button type="button" onClick={onClose} data-testid="mobile-sheet-close" className="rounded-lg p-1.5 text-slate-400 hover:bg-gray-100 hover:text-slate-600">×</button>
        </div>
        <div className="max-h-[72vh] overflow-y-auto">{children}</div>
      </aside>
    </div>
  );
}
