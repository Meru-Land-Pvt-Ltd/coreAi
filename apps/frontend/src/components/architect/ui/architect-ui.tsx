import Link from "next/link";
import type { Route } from "next";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
  secondaryActionLabel?: string;
  secondaryActionHref?: string;
};

type CardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
};

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "amber" | "green" | "blue" | "slate" | "rose";
  icon?: ReactNode;
};

type EmptyStateProps = {
  title: string;
  text: string;
  actionLabel?: string;
  actionHref?: string;
};

type FieldProps = {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  min?: number;
  minLength?: number;
};

type TextareaProps = {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  minLength?: number;
};

type PrimaryButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

const toneMap = {
  amber: "bg-amber-50 text-amber-700 ring-amber-100",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  blue: "bg-blue-50 text-blue-700 ring-blue-100",
  slate: "bg-slate-50 text-slate-700 ring-slate-100",
  rose: "bg-rose-50 text-rose-700 ring-rose-100"
};

export function CoreMark({ className = "" }: { className?: string }) {
  return (
    <span data-testid="components-architect-ui-architect-ui-span-1"
      className={cn(
        "grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20",
        className
      )}
      aria-hidden="true"
    >
      <svg data-testid="components-architect-ui-architect-ui-svg-1" viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <circle data-testid="components-architect-ui-architect-ui-circle-1" cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2.2" />
        <circle data-testid="components-architect-ui-architect-ui-circle-2" cx="12" cy="12" r="2.5" fill="currentColor" />
      </svg>
    </span>
  );
}

export function ArchitectPageHeader({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref,
  secondaryActionLabel,
  secondaryActionHref
}: PageHeaderProps) {
  return (
    <div data-testid="components-architect-ui-architect-ui-div-1" className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div data-testid="components-architect-ui-architect-ui-div-2" className="relative px-5 py-5 sm:px-6 lg:px-7">
        <div data-testid="components-architect-ui-architect-ui-div-3" className="pointer-events-none absolute right-0 top-0 h-32 w-56 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_62%)]" />
        <div data-testid="components-architect-ui-architect-ui-div-4" className="relative flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div data-testid="components-architect-ui-architect-ui-div-5">
            <p data-testid="components-architect-ui-architect-ui-p-1" className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-amber-600">
              {eyebrow}
            </p>
            <h1 data-testid="components-architect-ui-architect-ui-h1-1" className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
              {title}
            </h1>
            {description ? (
              <p data-testid="components-architect-ui-architect-ui-p-2" className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {description}
              </p>
            ) : null}
          </div>

          {(actionHref && actionLabel) || (secondaryActionHref && secondaryActionLabel) ? (
            <div data-testid="components-architect-ui-architect-ui-div-6" className="flex flex-wrap gap-2.5">
              {secondaryActionHref && secondaryActionLabel ? (
                <Link data-testid="components-architect-ui-architect-ui-link-1"
                  href={secondaryActionHref as Route}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-amber-300 hover:text-amber-700"
                >
                  {secondaryActionLabel}
                </Link>
              ) : null}
              {actionHref && actionLabel ? (
                <Link data-testid="components-architect-ui-architect-ui-link-2"
                  href={actionHref as Route}
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

export function ArchitectCard({
  title,
  description,
  children,
  className = "",
  action
}: CardProps) {
  return (
    <section data-testid="components-architect-ui-architect-ui-section-1" className={cn("rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      {title || description || action ? (
        <div data-testid="components-architect-ui-architect-ui-div-7" className="mb-5 flex items-start justify-between gap-4">
          <div data-testid="components-architect-ui-architect-ui-div-8">
            {title ? <h2 data-testid="components-architect-ui-architect-ui-h2-1" className="text-lg font-extrabold text-slate-950">{title}</h2> : null}
            {description ? (
              <p data-testid="components-architect-ui-architect-ui-p-3" className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
            ) : null}
          </div>
          {action ? <div data-testid="components-architect-ui-architect-ui-div-9" className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ArchitectStatCard({ label, value, hint, tone = "amber", icon }: StatCardProps) {
  return (
    <div data-testid="components-architect-ui-architect-ui-div-10" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div data-testid="components-architect-ui-architect-ui-div-11" className="flex items-start justify-between gap-3">
        <div data-testid="components-architect-ui-architect-ui-div-12">
          <p data-testid="components-architect-ui-architect-ui-p-4" className="text-sm font-semibold text-slate-500">{label}</p>
          <h3 data-testid="components-architect-ui-architect-ui-h3-1" className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</h3>
        </div>
        {icon ? (
          <span data-testid="components-architect-ui-architect-ui-span-2" className={cn("grid h-11 w-11 place-items-center rounded-2xl ring-1", toneMap[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      {hint ? <p data-testid="components-architect-ui-architect-ui-p-5" className="mt-3 text-xs font-semibold leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ArchitectEmptyState({ title, text, actionLabel, actionHref }: EmptyStateProps) {
  return (
    <div data-testid="components-architect-ui-architect-ui-div-13" className="rounded-3xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
      <div data-testid="components-architect-ui-architect-ui-div-14" className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-amber-600 shadow-sm">
        <svg data-testid="components-architect-ui-architect-ui-svg-2" viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
          <path data-testid="components-architect-ui-architect-ui-path-1" d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </div>
      <h3 data-testid="components-architect-ui-architect-ui-h3-2" className="mt-4 text-lg font-black text-slate-950">{title}</h3>
      <p data-testid="components-architect-ui-architect-ui-p-6" className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{text}</p>
      {actionHref && actionLabel ? (
        <Link data-testid="components-architect-ui-architect-ui-link-3"
          href={actionHref as Route}
          className="mt-5 inline-flex rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-extrabold text-slate-950 transition hover:bg-amber-400"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ArchitectBadge({ children, tone = "amber" }: { children: ReactNode; tone?: keyof typeof toneMap }) {
  return (
    <span data-testid="components-architect-ui-architect-ui-span-3" className={cn("inline-flex rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide ring-1", toneMap[tone])}>
      {children}
    </span>
  );
}

export function ArchitectStatusPill({ status }: { status: string }) {
  const normalized = status.replaceAll("_", " ");
  const tone = status === "APPROVED" || status === "ACCEPTED" ? "green" : status === "REJECTED" || status === "SUSPENDED" ? "rose" : status === "DRAFT" ? "slate" : "amber";
  return <ArchitectBadge tone={tone}>{normalized}</ArchitectBadge>;
}

export function ArchitectField({
  label,
  name,
  placeholder,
  defaultValue,
  type = "text",
  required,
  min,
  minLength
}: FieldProps) {
  return (
    <label data-testid="components-architect-ui-architect-ui-label-1" className="grid gap-2 text-sm font-bold text-slate-800">
      {label}
      <input data-testid="components-architect-ui-architect-ui-input-1"
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        min={min}
        minLength={minLength}
        className="rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
      />
    </label>
  );
}

export function ArchitectTextarea({
  label,
  name,
  placeholder,
  defaultValue,
  required,
  minLength
}: TextareaProps) {
  return (
    <label data-testid="components-architect-ui-architect-ui-label-2" className="grid gap-2 text-sm font-bold text-slate-800">
      {label}
      <textarea data-testid="components-architect-ui-architect-ui-textarea-1"
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        minLength={minLength}
        className="min-h-28 resize-y rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100"
      />
    </label>
  );
}

export function ArchitectPrimaryButton({ children, disabled, type = "submit", className, ...props }: PrimaryButtonProps) {
  return (
    <button data-testid="components-architect-ui-architect-ui-button-1"
      disabled={disabled}
      type={type}
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-3 text-sm font-extrabold text-slate-950 shadow-sm shadow-amber-500/20 transition hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
    >
      {children}
    </button>
  );
}

export function ArchitectSecondaryButton({ children, disabled, type = "button", className, ...props }: PrimaryButtonProps) {
  return (
    <button data-testid="components-architect-ui-architect-ui-button-2"
      disabled={disabled}
      type={type}
      {...props}
      className={cn(
        "inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-extrabold text-slate-700 transition hover:border-amber-300 hover:text-amber-700 disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
    >
      {children}
    </button>
  );
}

export function ArchitectLinkButton({ href, children }: { href: Route; children: ReactNode }) {
  return (
    <Link data-testid="components-architect-ui-architect-ui-link-4"
      href={href}
      className="inline-flex items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-extrabold text-slate-700 transition hover:border-amber-300 hover:bg-amber-50 hover:text-amber-700"
    >
      {children}
    </Link>
  );
}

export function MiniProgress({ value, label }: { value: number; label?: string }) {
  const safeValue = Math.max(0, Math.min(100, value));
  return (
    <div data-testid="components-architect-ui-architect-ui-div-15">
      <div data-testid="components-architect-ui-architect-ui-div-16" className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
        <span data-testid="components-architect-ui-architect-ui-span-4">{label ?? "Progress"}</span>
        <span data-testid="components-architect-ui-architect-ui-span-5">{safeValue}%</span>
      </div>
      <div data-testid="components-architect-ui-architect-ui-div-17" className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div data-testid="components-architect-ui-architect-ui-div-18" className="h-full rounded-full bg-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.45)]" style={{ width: `${safeValue}%` }} />
      </div>
    </div>
  );
}

export function formatMoney(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "Not set";
  if (cents === 0) return "Free";
  return `₹${Math.round(cents / 100).toLocaleString("en-IN")}`;
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

export function csvToArray(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
