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
    <div data-testid="components-architect-ui-architect-coming-soon-view-div-1">
      <ArchitectPageHeader eyebrow={eyebrow} title={title} description={description} />
      <ArchitectCard>
        <div data-testid="components-architect-ui-architect-coming-soon-view-div-2" className="rounded-3xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
          <div data-testid="components-architect-ui-architect-coming-soon-view-div-3" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-amber-600 shadow-sm">
            <svg data-testid="components-architect-ui-architect-coming-soon-view-svg-1" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path data-testid="components-architect-ui-architect-coming-soon-view-path-1" d="M12 6v6l4 2" />
              <circle data-testid="components-architect-ui-architect-coming-soon-view-circle-1" cx="12" cy="12" r="9" />
            </svg>
          </div>
          <h2 data-testid="components-architect-ui-architect-coming-soon-view-h2-1" className="mt-4 text-xl font-black text-slate-950">Optimized shell ready</h2>
          <p data-testid="components-architect-ui-architect-coming-soon-view-p-1" className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500">
            This route is wired into the redesigned architect navigation and can be connected to live data when the backend endpoint is ready.
          </p>
        </div>
      </ArchitectCard>
    </div>
  );
}
