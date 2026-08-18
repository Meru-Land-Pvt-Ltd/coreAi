import type { CrmContact } from "./api";

/**
 * Display helpers shared by the table and the drawer.
 *
 * Core rule: a blank company or email is NORMAL — most inbound callers are
 * consumers with neither. Blank renders as an em dash, never as an error.
 */

export const EMPTY_VALUE = "—";

export function displayOrDash(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : EMPTY_VALUE;
}

export function contactInitials(contact: CrmContact): string {
  const parts = [contact.firstName, contact.lastName].filter(Boolean) as string[];
  if (parts.length) {
    return parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("");
  }

  const fromName = contact.name?.trim();
  if (fromName && !fromName.startsWith("+")) return fromName[0]!.toUpperCase();
  // Phone-only contact: the last two digits are more recognisable than "?".
  const digits = contact.phone?.replace(/\D/g, "") ?? "";
  return digits ? digits.slice(-2) : "?";
}

export function relativeTime(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return EMPTY_VALUE;

  const diffMs = Date.now() - timestamp;
  if (diffMs < 0) return "Just now";

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;

  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return EMPTY_VALUE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatMoney(amount: number | null, currency: string | null): string {
  if (amount === null || !Number.isFinite(amount)) return EMPTY_VALUE;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency ?? "USD",
      maximumFractionDigits: 0
    }).format(amount);
  } catch {
    return `${amount.toLocaleString()}`;
  }
}

/** Semantic stage pills — reuse of existing tones, not a new colour scale. */
export function stagePillClasses(stage: string | null | undefined): string {
  const value = (stage ?? "").toLowerCase();

  if (/appointment|booked|customer|won/.test(value)) {
    return "bg-green-50 text-green-700 ring-1 ring-green-600/10";
  }
  if (/lead|subscriber|new|open/.test(value)) {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-600/10";
  }
  if (/opportunity|deal|qualified|trial/.test(value)) {
    return "bg-blue-50 text-blue-700 ring-1 ring-blue-600/10";
  }
  return "bg-gray-100 text-slate-600 ring-1 ring-gray-200";
}

/** Tel/WhatsApp links; null when the contact has no usable number. */
export function telHref(phone: string | null): string | null {
  const digits = phone?.replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}

export function whatsappHref(phone: string | null): string | null {
  const digits = phone?.replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}` : null;
}
