import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type BusinessPageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
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
  title,
  description,
  actions,
  className = "",
  actionLabel,
  actionHref,
  secondaryActionLabel,
  secondaryActionHref
}: BusinessPageHeaderProps) {
  const hasLinkActions = (actionHref && actionLabel) || (secondaryActionHref && secondaryActionLabel);

  return (
    <header className={`border-b border-gray-100 bg-white ${className}`}>
      <div className="flex min-h-20 items-center justify-between gap-4 px-5 py-4 lg:px-8">
        <div className="min-w-0">
          <h1 className="text-xl font-extrabold tracking-tight text-slate-900" data-testid="business-page-header-title">
            {title}
          </h1>
          {description ? (
            <p className="mt-0.5 hidden text-sm text-slate-500 sm:block" data-testid="business-page-header-description">
              {description}
            </p>
          ) : null}
        </div>

        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">{actions}</div>
        ) : hasLinkActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2.5">
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
    </header>
  );
}
