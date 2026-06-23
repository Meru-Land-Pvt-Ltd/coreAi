import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

type PageHeaderProps = {
  eyebrow: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: Route;
};

type CardProps = {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
};

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
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

type PrimaryButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  type?: "button" | "submit" | "reset";
};

export function ArchitectPageHeader({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref
}: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col justify-between gap-4 rounded-2xl border border-orange-100 bg-white px-5 py-4 shadow-sm md:flex-row md:items-center">
      <div>
        <p className="text-[11px] font-black uppercase tracking-[0.22em] text-orange-500">
          {eyebrow}
        </p>

        <h1 className="mt-1 text-2xl font-black tracking-tight text-orange-950 md:text-3xl">
          {title}
        </h1>

        {description ? (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-orange-900/65">
            {description}
          </p>
        ) : null}
      </div>

      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="inline-flex shrink-0 items-center justify-center rounded-xl bg-orange-500 px-4 py-2.5 text-sm font-black text-white transition hover:bg-orange-600"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ArchitectCard({
  title,
  description,
  children,
  className = ""
}: CardProps) {
  return (
    <section
      className={`rounded-2xl border border-orange-100 bg-white p-5 shadow-sm ${className}`}
    >
      {title || description ? (
        <div className="mb-4">
          {title ? (
            <h2 className="text-lg font-black text-orange-950">{title}</h2>
          ) : null}

          {description ? (
            <p className="mt-1 text-sm leading-6 text-orange-900/60">
              {description}
            </p>
          ) : null}
        </div>
      ) : null}

      {children}
    </section>
  );
}

export function ArchitectStatCard({ label, value, hint }: StatCardProps) {
  return (
    <div className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm">
      <p className="text-sm font-bold text-orange-700">{label}</p>

      <h3 className="mt-2 text-3xl font-black text-orange-950">{value}</h3>

      {hint ? (
        <p className="mt-2 text-xs font-semibold leading-5 text-orange-800/55">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function ArchitectEmptyState({
  title,
  text,
  actionLabel,
  actionHref
}: EmptyStateProps) {
  return (
    <div className="rounded-2xl border border-dashed border-orange-200 bg-orange-50/70 p-6">
      <h3 className="text-lg font-black text-orange-950">{title}</h3>

      <p className="mt-2 text-sm leading-6 text-orange-900/65">{text}</p>

      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-4 inline-flex rounded-xl bg-orange-500 px-4 py-2 text-sm font-black text-white transition hover:bg-orange-600"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ArchitectBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex rounded-full bg-orange-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-orange-700">
      {children}
    </span>
  );
}

export function ArchitectStatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-orange-700">
      {status.replaceAll("_", " ")}
    </span>
  );
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
    <label className="grid gap-2 text-sm font-bold text-orange-950">
      {label}

      <input
        name={name}
        type={type}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        min={min}
        minLength={minLength}
        className="rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-orange-900/35 focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
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
    <label className="grid gap-2 text-sm font-bold text-orange-950">
      {label}

      <textarea
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        minLength={minLength}
        className="min-h-28 resize-y rounded-xl border border-orange-200 bg-white px-3 py-2.5 text-sm outline-none transition placeholder:text-orange-900/35 focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
      />
    </label>
  );
}

export function ArchitectPrimaryButton({
  children,
  disabled,
  type = "submit"
}: PrimaryButtonProps) {
  return (
    <button
      disabled={disabled}
      type={type}
      className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-5 py-3 text-sm font-black text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ArchitectSecondaryButton({
  children,
  disabled,
  type = "button"
}: PrimaryButtonProps) {
  return (
    <button
      disabled={disabled}
      type={type}
      className="inline-flex items-center justify-center rounded-xl border border-orange-200 bg-white px-5 py-3 text-sm font-black text-orange-800 transition hover:border-orange-400 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function ArchitectLinkButton({
  href,
  children
}: {
  href: Route;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="inline-flex items-center justify-center rounded-xl border border-orange-200 bg-white px-4 py-2.5 text-sm font-black text-orange-800 transition hover:border-orange-400 hover:bg-orange-50"
    >
      {children}
    </Link>
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