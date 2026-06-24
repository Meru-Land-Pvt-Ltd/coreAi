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
  actionHref?: Route;
  secondaryActionLabel?: string;
  secondaryActionHref?: Route;
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
  actionHref?: Route;
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
    <span
      className={cn(
        "grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-amber-500/20",
        className
      )}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none">
        <circle cx="12" cy="12" r="7.5" stroke="currentColor" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" />
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
    <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="relative px-5 py-5 sm:px-6 lg:px-7">
        <div className="pointer-events-none absolute right-0 top-0 h-32 w-56 bg-[radial-gradient(circle_at_top_right,rgba(245,158,11,0.16),transparent_62%)]" />
        <div className="relative flex flex-col justify-between gap-5 md:flex-row md:items-center">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.22em] text-amber-600">
              {eyebrow}
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-950 md:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
                {description}
              </p>
            ) : null}
          </div>

          {(actionHref && actionLabel) || (secondaryActionHref && secondaryActionLabel) ? (
            <div className="flex flex-wrap gap-2.5">
              {secondaryActionHref && secondaryActionLabel ? (
                <Link
                  href={secondaryActionHref}
                  className="inline-flex shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-bold text-slate-700 transition hover:border-amber-300 hover:text-amber-700"
                >
                  {secondaryActionLabel}
                </Link>
              ) : null}
              {actionHref && actionLabel ? (
                <Link
                  href={actionHref}
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
    <section className={cn("rounded-3xl border border-slate-200 bg-white p-5 shadow-sm", className)}>
      {title || description || action ? (
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            {title ? <h2 className="text-lg font-extrabold text-slate-950">{title}</h2> : null}
            {description ? (
              <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
            ) : null}
          </div>
          {action ? <div className="shrink-0">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function ArchitectStatCard({ label, value, hint, tone = "amber", icon }: StatCardProps) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-slate-500">{label}</p>
          <h3 className="mt-2 text-3xl font-black tracking-tight text-slate-950">{value}</h3>
        </div>
        {icon ? (
          <span className={cn("grid h-11 w-11 place-items-center rounded-2xl ring-1", toneMap[tone])}>
            {icon}
          </span>
        ) : null}
      </div>
      {hint ? <p className="mt-3 text-xs font-semibold leading-5 text-slate-500">{hint}</p> : null}
    </div>
  );
}

export function ArchitectEmptyState({ title, text, actionLabel, actionHref }: EmptyStateProps) {
  return (
    <div className="rounded-3xl border border-dashed border-amber-200 bg-amber-50/60 p-8 text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-white text-amber-600 shadow-sm">
        <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" strokeLinecap="round" />
        </svg>
      </div>
      <h3 className="mt-4 text-lg font-black text-slate-950">{title}</h3>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-500">{text}</p>
      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
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
    <span className={cn("inline-flex rounded-full px-3 py-1 text-xs font-extrabold uppercase tracking-wide ring-1", toneMap[tone])}>
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
    <label className="grid gap-2 text-sm font-bold text-slate-800">
      {label}
      <input
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
    <label className="grid gap-2 text-sm font-bold text-slate-800">
      {label}
      <textarea
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
    <button
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
    <button
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
    <Link
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
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
        <span>{label ?? "Progress"}</span>
        <span>{safeValue}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
        <div className="h-full rounded-full bg-amber-500 shadow-[0_0_18px_rgba(245,158,11,0.45)]" style={{ width: `${safeValue}%` }} />
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
