"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { webFormSmsConsentDisclosure } from "@coreai/shared";
import { CoreHeader } from "@/components/common/header";
import { CoreFooter } from "@/components/common/footer";
import { apiGet, apiPost } from "@/lib/api";

const PRIVACY_ROUTE = "/privacy" as Route;
const TERMS_ROUTE = "/terms" as Route;

type PublicBusiness = {
  slug: string;
  name: string;
  type: string;
  services: string[];
};

type BookingResponse = {
  booking: { id: string; status: string };
  smsConsent: "OPTED_IN" | "NOT_REQUESTED" | "FAILED";
  smsSent: boolean;
};

type BookingForm = {
  customerName: string;
  customerPhone: string;
  service: string;
  preferredDate: string;
  preferredTime: string;
  notes: string;
  smsConsent: boolean;
};

const EMPTY_FORM: BookingForm = {
  customerName: "",
  customerPhone: "",
  service: "",
  preferredDate: "",
  preferredTime: "",
  notes: "",
  // The SMS consent checkbox is OPTIONAL and must start unchecked.
  smsConsent: false
};

function inputClass(hasError: boolean): string {
  return [
    "w-full rounded-xl border bg-white px-4 py-3 text-slate-900 placeholder:text-slate-400 transition focus:outline-none focus:ring-4",
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-red-100"
      : "border-gray-200 focus:border-amber-400 focus:ring-amber-100"
  ].join(" ");
}

export default function PublicBookingPage() {
  const params = useParams<{ slug: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : "";

  const [menuOpen, setMenuOpen] = useState(false);
  const [navScrolled, setNavScrolled] = useState(false);

  const [business, setBusiness] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [form, setForm] = useState<BookingForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<Partial<Record<keyof BookingForm, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<BookingResponse | null>(null);

  useEffect(() => {
    const onScroll = () => setNavScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!slug) return;
    let cancelled = false;
    (async () => {
      const response = await apiGet<{ business: PublicBusiness }>(`/public/booking/${slug}`);
      if (cancelled) return;
      if (response.success && response.data?.business) {
        setBusiness(response.data.business);
      } else {
        setNotFound(true);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const updateField = <K extends keyof BookingForm>(field: K, value: BookingForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  };

  const validateForm = (): boolean => {
    const nextErrors: Partial<Record<keyof BookingForm, string>> = {};
    if (!form.customerName.trim()) nextErrors.customerName = "Please enter your name.";
    const phone = form.customerPhone.trim();
    if (!phone) {
      nextErrors.customerPhone = "Please enter your mobile phone number.";
    } else if (!phone.startsWith("+")) {
      nextErrors.customerPhone = "Include the country code, e.g. +1 555 123 4567.";
    }
    setErrors(nextErrors);
    return Object.keys(nextErrors).length === 0;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validateForm() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);

    const response = await apiPost<BookingResponse>(`/public/booking/${slug}`, {
      customerName: form.customerName.trim(),
      customerPhone: form.customerPhone.trim(),
      service: form.service.trim() || undefined,
      preferredDate: form.preferredDate || undefined,
      preferredTime: form.preferredTime || undefined,
      notes: form.notes.trim() || undefined,
      smsConsent: form.smsConsent,
      sourceUrl: typeof window !== "undefined" ? window.location.href : undefined
    });

    setSubmitting(false);
    if (response.success && response.data) {
      setResult(response.data);
    } else {
      setSubmitError(response.error || "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-white text-slate-900 antialiased">
      <CoreHeader
        navTop={0}
        navScrolled={navScrolled}
        menuOpen={menuOpen}
        onToggleMenu={() => setMenuOpen((open) => !open)}
        onCloseMenu={() => setMenuOpen(false)}
      />

      <main className="mx-auto max-w-2xl px-6 pb-20 pt-32 md:pt-36" data-testid="booking-page">
        {loading ? (
          <p className="text-base text-slate-500" data-testid="booking-loading-text">
            Loading booking page…
          </p>
        ) : notFound || !business ? (
          <div data-testid="booking-not-found">
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900">
              Booking page not found
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-600">
              This booking link is invalid or no longer active. Please contact the business
              directly.
            </p>
          </div>
        ) : result ? (
          <div
            className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm"
            data-testid="booking-success"
          >
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              Request received
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-600" data-testid="booking-success-text">
              Thanks, {form.customerName.trim()}! Your request with {business.name} has been
              received. The team will confirm your appointment shortly.
            </p>
            {result.smsConsent === "OPTED_IN" ? (
              <p className="mt-3 text-sm text-slate-500" data-testid="booking-success-sms-text">
                You opted in to transactional text updates from {business.name} through Triven.ai.
                Reply STOP at any time to opt out.
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-500" data-testid="booking-success-no-sms-text">
                No text messages will be sent — you did not opt in to SMS updates.
              </p>
            )}
          </div>
        ) : (
          <>
            <h1
              className="text-3xl font-extrabold tracking-tight text-slate-900"
              data-testid="booking-title-heading"
            >
              Book with {business.name}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-slate-600" data-testid="booking-subtitle-text">
              Request an appointment or service with {business.name}. Powered by Triven.ai.
            </p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit} data-testid="booking-form" noValidate>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="booking-name">
                  Your name
                </label>
                <input
                  id="booking-name"
                  data-testid="booking-name-input"
                  className={inputClass(Boolean(errors.customerName))}
                  type="text"
                  autoComplete="name"
                  value={form.customerName}
                  onChange={(event) => updateField("customerName", event.target.value)}
                  placeholder="Full name"
                />
                {errors.customerName ? (
                  <p className="mt-1.5 text-sm text-red-600" data-testid="booking-name-error">
                    {errors.customerName}
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="booking-phone">
                  Mobile phone number
                </label>
                <input
                  id="booking-phone"
                  data-testid="booking-phone-input"
                  className={inputClass(Boolean(errors.customerPhone))}
                  type="tel"
                  autoComplete="tel"
                  value={form.customerPhone}
                  onChange={(event) => updateField("customerPhone", event.target.value)}
                  placeholder="+1 555 123 4567"
                />
                {errors.customerPhone ? (
                  <p className="mt-1.5 text-sm text-red-600" data-testid="booking-phone-error">
                    {errors.customerPhone}
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="booking-service">
                  Service
                </label>
                {business.services.length > 0 ? (
                  <select
                    id="booking-service"
                    data-testid="booking-service-select"
                    className={inputClass(false)}
                    value={form.service}
                    onChange={(event) => updateField("service", event.target.value)}
                  >
                    <option value="">Select a service (optional)</option>
                    {business.services.map((service) => (
                      <option key={service} value={service}>
                        {service}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id="booking-service"
                    data-testid="booking-service-input"
                    className={inputClass(false)}
                    type="text"
                    value={form.service}
                    onChange={(event) => updateField("service", event.target.value)}
                    placeholder="What do you need help with? (optional)"
                  />
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="booking-date">
                    Preferred date
                  </label>
                  <input
                    id="booking-date"
                    data-testid="booking-date-input"
                    className={inputClass(false)}
                    type="date"
                    value={form.preferredDate}
                    onChange={(event) => updateField("preferredDate", event.target.value)}
                  />
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="booking-time">
                    Preferred time
                  </label>
                  <input
                    id="booking-time"
                    data-testid="booking-time-input"
                    className={inputClass(false)}
                    type="time"
                    value={form.preferredTime}
                    onChange={(event) => updateField("preferredTime", event.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="booking-notes">
                  Notes
                </label>
                <textarea
                  id="booking-notes"
                  data-testid="booking-notes-textarea"
                  className={`${inputClass(false)} min-h-[96px]`}
                  value={form.notes}
                  onChange={(event) => updateField("notes", event.target.value)}
                  placeholder="Anything the team should know? (optional)"
                />
              </div>

              {/*
                SMS consent — a SEPARATE, optional checkbox. It must start
                unchecked, must never be required to submit, and is never
                bundled into Terms acceptance.
              */}
              <div className="rounded-xl border border-gray-200 bg-slate-50 p-4">
                <label className="flex items-start gap-3" htmlFor="booking-sms-consent">
                  <input
                    id="booking-sms-consent"
                    data-testid="booking-sms-consent-checkbox"
                    type="checkbox"
                    className="mt-1 h-4 w-4 shrink-0 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                    checked={form.smsConsent}
                    onChange={(event) => updateField("smsConsent", event.target.checked)}
                  />
                  <span className="text-sm leading-relaxed text-slate-600" data-testid="booking-sms-consent-text">
                    {webFormSmsConsentDisclosure(business.name)}
                  </span>
                </label>
                <p className="mt-2 pl-7 text-xs text-slate-500" data-testid="booking-sms-consent-optional-text">
                  Optional — you can book without agreeing to text messages. See our{" "}
                  <Link
                    href={PRIVACY_ROUTE}
                    className="underline transition hover:text-amber-600"
                    data-testid="booking-privacy-link"
                  >
                    Privacy Policy
                  </Link>{" "}
                  and{" "}
                  <Link
                    href={TERMS_ROUTE}
                    className="underline transition hover:text-amber-600"
                    data-testid="booking-terms-link"
                  >
                    Terms of Service
                  </Link>
                  .
                </p>
              </div>

              {submitError ? (
                <p className="text-sm text-red-600" data-testid="booking-submit-error">
                  {submitError}
                </p>
              ) : null}

              <button
                type="submit"
                data-testid="booking-submit"
                disabled={submitting}
                className="w-full rounded-xl bg-amber-500 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-amber-600 focus:outline-none focus:ring-4 focus:ring-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {submitting ? "Sending request…" : "Request booking"}
              </button>
            </form>
          </>
        )}
      </main>

      <CoreFooter />
    </div>
  );
}
