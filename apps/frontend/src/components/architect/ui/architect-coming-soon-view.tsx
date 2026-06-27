import { ArchitectCard, ArchitectPageHeader } from "@/components/architect/ui/architect-ui";

export function ArchitectComingSoonView({
  eyebrow,
  title,
  description
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <ArchitectPageHeader eyebrow={eyebrow} title={title} description={description} />
      <ArchitectCard>
        <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-amber-600 shadow-sm">
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 6v6l4 2" />
              <circle cx="12" cy="12" r="9" />
            </svg>
          </div>
          <h2 className="mt-4 text-xl font-black text-slate-950" data-testid="architect-ui-architect-coming-soon-view-optimized-shell-ready-heading">Optimized shell ready</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500" data-testid="architect-ui-architect-coming-soon-view-this-route-is-wired-into-the-redesigned-text">
            This route is wired into the redesigned architect navigation and can be connected to live data when the backend endpoint is ready.
          </p>
        </div>
      </ArchitectCard>
    </div>
  );
}
