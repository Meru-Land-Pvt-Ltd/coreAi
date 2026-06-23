import Link from "next/link";
import type { Route } from "next";

export function ArchitectPageHeader({
  eyebrow,
  title,
  description,
  actionLabel,
  actionHref
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: Route;
}) {
  return (
    <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-end">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">
          {eyebrow}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-orange-950 md:text-4xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-orange-900/70">
            {description}
          </p>
        ) : null}
      </div>

      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="inline-flex rounded-full bg-orange-500 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ArchitectCard({
  title,
  children
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[32px] border border-orange-100 bg-white/90 p-5 shadow-sm shadow-orange-100/60">
      {title ? <h2 className="mb-4 text-xl font-black text-orange-950">{title}</h2> : null}
      {children}
    </section>
  );
}

export function ArchitectStatCard({
  label,
  value,
  hint
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="rounded-[30px] border border-orange-100 bg-white p-5 shadow-sm shadow-orange-100/70">
      <p className="text-sm font-bold text-orange-700">{label}</p>
      <h3 className="mt-2 text-4xl font-black text-orange-950">{value}</h3>
      {hint ? <p className="mt-2 text-xs font-medium text-orange-800/60">{hint}</p> : null}
    </div>
  );
}

export function ArchitectEmptyState({
  title,
  text,
  actionLabel,
  actionHref
}: {
  title: string;
  text: string;
  actionLabel?: string;
  actionHref?: Route;
}) {
  return (
    <div className="rounded-[28px] border border-dashed border-orange-200 bg-orange-50/70 p-6">
      <h3 className="text-lg font-black text-orange-950">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-orange-900/65">{text}</p>

      {actionHref && actionLabel ? (
        <Link
          href={actionHref}
          className="mt-4 inline-flex rounded-full bg-orange-500 px-4 py-2 text-sm font-bold text-white"
        >
          {actionLabel}
        </Link>
      ) : null}
    </div>
  );
}

export function ArchitectBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full bg-orange-100 px-3 py-1 text-xs font-black uppercase tracking-wide text-orange-700">
      {children}
    </span>
  );
}

export function ArchitectStatusPill({ status }: { status: string }) {
  return (
    <span className="rounded-full border border-orange-200 bg-white px-3 py-1 text-xs font-black uppercase tracking-wide text-orange-700">
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
}: {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  type?: string;
  required?: boolean;
  min?: number;
  minLength?: number;
}) {
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
        className="rounded-2xl border border-orange-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
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
}: {
  label: string;
  name: string;
  placeholder?: string;
  defaultValue?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="grid gap-2 text-sm font-bold text-orange-950">
      {label}
      <textarea
        name={name}
        placeholder={placeholder}
        defaultValue={defaultValue}
        required={required}
        minLength={minLength}
        className="min-h-32 rounded-2xl border border-orange-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-orange-500 focus:ring-4 focus:ring-orange-100"
      />
    </label>
  );
}

export function ArchitectPrimaryButton({
  children,
  disabled
}: {
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      className="rounded-full bg-orange-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-orange-200 transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
      type="submit"
    >
      {children}
    </button>
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