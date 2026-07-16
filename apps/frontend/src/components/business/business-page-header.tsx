import Link from "next/link";
import type { Route } from "next";

type BusinessPageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  secondaryActionLabel?: string;
  secondaryActionHref?: string;
};

/**
 * Page header component for all Buyer/Business-side pages.
 * Matches the visual design of `ArchitectPageHeader` for consistency.
 */
export function BusinessPageHeader({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
  secondaryActionLabel,
  secondaryActionHref
}: BusinessPageHeaderProps) {
  return (
    <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="relative px-5 py-5 sm:px-6 lg:px-7">
        <div className="pointer-events-none absolute right-0 top-0 h-32 w-56 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_62%)]" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-amber-600" data-testid="business-page-header-eyebrow">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl" data-testid="business-page-header-title">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500" data-testid="business-page-header-description">
                {description}
              </p>
            ) : null}
          </div>

          {(actionHref && actionLabel) || (secondaryActionHref && secondaryActionLabel) ? (
            <div className="flex flex-wrap gap-2.5">
              {secondaryActionHref && secondaryActionLabel ? (
                <Link
                  href={secondaryActionHref as Route}
                  data-testid="business-page-header-secondary-action"
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-amber-300 hover:text-amber-700"
                >
                  {secondaryActionLabel}
                </Link>
              ) : null}
              {actionHref && actionLabel ? (
                <Link
                  href={actionHref as Route}
                  data-testid="business-page-header-action"
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-extrabold text-slate-950 shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5 hover:bg-amber-400"
                >
                  {actionLabel}
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
