"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  startWhatsAppEmbeddedSignup,
  callbackWhatsAppEmbeddedSignup,
  renameWhatsAppConnection,
  type WhatsAppConnection
} from "@/components/architect/features/api";
import { COUNTRY_CODES, buildE164PhoneNumber } from "@/lib/phone-country-codes";
import { WhatsAppIcon } from "./WhatsAppIcon";

type OnboardingStep = "enter" | "connecting" | "redirect" | "success" | "failed";

function isE164Phone(phoneNumber: string): boolean {
  return /^\+[1-9]\d{1,14}$/.test(phoneNumber.trim());
}

function getFriendlyError(errorMessage: string | undefined): string {
  const msg = (errorMessage ?? "").trim();
  return msg || "WhatsApp onboarding failed. Please try again.";
}

function CountryCodeSelect({
  value,
  onChange
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    const updatePosition = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const menuWidth = 208;
      const menuMaxHeight = 240;
      const gap = 4;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const dropUp = spaceBelow < Math.min(menuMaxHeight, 180) && rect.top > menuMaxHeight;
      const left = Math.min(rect.left, window.innerWidth - menuWidth - 8);

      setMenuStyle({
        position: "fixed",
        left,
        width: menuWidth,
        maxHeight: menuMaxHeight,
        zIndex: 400,
        ...(dropUp
          ? { bottom: window.innerHeight - rect.top + gap }
          : { top: rect.bottom + gap })
      });
    };

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className={`relative shrink-0 ${open ? "z-30" : "z-10"}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Country code"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-full w-20 items-center justify-between rounded-l-xl border border-r-0 border-gray-200 bg-slate-50 px-2 py-3 text-sm font-medium text-slate-600"
        data-testid="whatsapp-onboarding-phone-country-code"
      >
        <span>{value}</span>
        <svg
          className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open
        ? createPortal(
            <div
              ref={menuRef}
              role="listbox"
              style={menuStyle}
              className="overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
              data-testid="whatsapp-onboarding-phone-country-menu"
            >
              {COUNTRY_CODES.map((country) => {
                const active = value === country.code;
                return (
                  <button
                    key={country.code}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      onChange(country.code);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition ${
                      active ? "bg-amber-50 text-amber-700" : "text-slate-700 hover:bg-amber-50 hover:text-amber-700"
                    }`}
                    data-testid={`whatsapp-onboarding-phone-country-${country.code.replace("+", "")}`}
                  >
                    <span className="w-10 shrink-0 font-medium">{country.code}</span>
                    <span className="truncate">{country.label}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}

export function WhatsAppEmbeddedSignupOnboarding({
  variant = "page",
  onClose,
  onConnected
}: {
  variant?: "page" | "modal";
  onClose?: () => void;
  onConnected?: (connection: WhatsAppConnection) => void;
} = {}) {
  const [step, setStep] = useState<OnboardingStep>("enter");
  const [countryCode, setCountryCode] = useState<string>(COUNTRY_CODES[0]!.code);
  const [phoneDigits, setPhoneDigits] = useState<string>("");
  const [fullPhoneNumber, setFullPhoneNumber] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);
  const [connection, setConnection] = useState<WhatsAppConnection | null>(null);
  const [connectionName, setConnectionName] = useState<string>("Sales WhatsApp");

  const shellClass =
    variant === "modal"
      ? "w-full p-6"
      : "mx-auto w-full max-w-lg px-4 py-10";

  const cardClass =
    variant === "modal"
      ? "w-full"
      : "rounded-2xl border border-gray-100 bg-white p-6 shadow-sm";

  const canContinue = useMemo(() => {
    const normalized = buildE164PhoneNumber(countryCode, phoneDigits);
    return isE164Phone(normalized);
  }, [countryCode, phoneDigits]);

  const openPopup = useCallback((url: string) => {
    return window.open(url, "wa_embedded_signup", "width=900,height=760,resizable=yes,scrollbars=yes");
  }, []);

  useEffect(() => {
    if (step !== "redirect") return;

    const allowedOrigins = ["https://www.facebook.com", "https://business.facebook.com"];
    const timeoutMs = 10 * 60 * 1000;
    const timeout = window.setTimeout(() => {
      setErrorMessage("Meta signup timed out. Please try again.");
      setStep("failed");
    }, timeoutMs);

    const handler = async (event: MessageEvent) => {
      const origin = String(event.origin ?? "");
      if (!allowedOrigins.some((o) => origin === o || origin.endsWith(o.replace("https://", "")))) return;

      try {
        const raw = event.data;
        const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
        if (!payload || typeof payload !== "object") return;
        if (payload.type !== "WA_EMBEDDED_SIGNUP") return;

        const embeddedEvent = String(payload.event ?? "");
        if (embeddedEvent === "CANCEL") {
          const currentStep = String(payload.data?.current_step ?? "unknown");
          setErrorMessage(`Meta signup was cancelled (step: ${currentStep}).`);
          setStep("failed");
          return;
        }

        if (embeddedEvent === "ERROR") {
          const msg = String(payload.data?.error_message ?? "Meta embedded signup error");
          setErrorMessage(msg);
          setStep("failed");
          return;
        }

        if (embeddedEvent === "FINISH" || embeddedEvent === "FINISH_ONLY_WABA") {
          const code = String(payload.data?.code ?? payload.data?.auth_code ?? payload.code ?? "");
          const phoneNumberId = String(payload.data?.phone_number_id ?? "");
          const wabaId = String(payload.data?.waba_id ?? "");

          if (!code || !phoneNumberId || !wabaId) {
            setErrorMessage("Meta embedded signup completed, but identifiers were missing.");
            setStep("failed");
            return;
          }

          const cbRes = await callbackWhatsAppEmbeddedSignup({
            code,
            phoneNumberId,
            wabaId,
            phoneNumber: fullPhoneNumber
          });

          if (!cbRes.success) {
            setErrorMessage(cbRes.error ?? cbRes.code ?? "Callback failed");
            setStep("failed");
            return;
          }

          setConnection(cbRes.data?.connection ?? null);
          setConnectionName(cbRes.data?.connection?.displayName ?? "Sales WhatsApp");
          setStep("success");
        }
      } catch (err) {
        setErrorMessage(getFriendlyError(err instanceof Error ? err.message : undefined));
        setStep("failed");
      } finally {
        window.clearTimeout(timeout);
      }
    };

    window.addEventListener("message", handler);
    return () => {
      window.removeEventListener("message", handler);
      window.clearTimeout(timeout);
    };
  }, [fullPhoneNumber, step]);

  const onContinue = useCallback(async () => {
    setErrorMessage("");
    const normalized = buildE164PhoneNumber(countryCode, phoneDigits);
    if (!isE164Phone(normalized)) {
      setErrorMessage("Enter a valid phone number with country code.");
      setStep("failed");
      return;
    }

    setFullPhoneNumber(normalized);
    setBusy(true);
    setStep("connecting");

    try {
      const startRes = await startWhatsAppEmbeddedSignup(normalized);
      if (!startRes.success) {
        setErrorMessage(startRes.error ?? "Could not start Meta embedded signup");
        setStep("failed");
        return;
      }
      const redirectUrl = startRes.data?.redirectUrl;
      if (!redirectUrl) {
        setErrorMessage("Meta redirect URL missing.");
        setStep("failed");
        return;
      }

      setStep("redirect");
      openPopup(redirectUrl);
    } finally {
      setBusy(false);
    }
  }, [countryCode, openPopup, phoneDigits]);

  const onSaveConnectionName = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    try {
      const res = await renameWhatsAppConnection(connection.id, connectionName);
      if (!res.success) {
        setErrorMessage(res.error ?? "Could not save connection name");
        setStep("failed");
        return;
      }
      const saved = res.data?.connection ?? connection;
      setConnection(saved);
      onConnected?.(saved);
      if (!onConnected) setStep("success");
    } finally {
      setBusy(false);
    }
  }, [connection, connectionName, onConnected]);

  if (step === "failed") {
    return (
      <div className={shellClass}>
        <div className={`${cardClass} ${variant === "page" ? "border-rose-100" : ""}`}>
          <h1
            className="flex items-center gap-2 text-xl font-extrabold text-slate-900"
            data-testid="whatsapp-onboarding-failed-title"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-rose-50 text-emerald-600">
              <WhatsAppIcon className="h-4 w-4" />
            </span>
            Connection Failed
          </h1>
          <p className="mt-3 text-sm text-slate-600" data-testid="whatsapp-onboarding-failed-message">
            {errorMessage}
          </p>
          <div className="mt-6 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setStep("enter");
                setErrorMessage("");
              }}
              className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400"
              data-testid="whatsapp-onboarding-retry"
            >
              Try Again
            </button>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600"
                data-testid="whatsapp-onboarding-failed-close"
              >
                Close
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (step === "success" && connection) {
    return (
      <div className={shellClass}>
        <div className={`${cardClass} ${variant === "page" ? "border-emerald-100" : ""}`}>
          <h1
            className="flex items-center gap-2 text-xl font-extrabold text-slate-900"
            data-testid="whatsapp-onboarding-success-title"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <WhatsAppIcon className="h-4 w-4" />
            </span>
            WhatsApp Connected
          </h1>

          <div className="mt-5 grid gap-3 rounded-xl bg-slate-50 p-4" data-testid="whatsapp-onboarding-success-details">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Business</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{connection.businessName ?? "—"}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Phone Number</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{connection.phoneNumber}</p>
            </div>
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Status</p>
              <p className="mt-1 text-sm font-bold text-slate-900">
                {connection.status === "CONNECTED" ? "Connected" : connection.status}
              </p>
            </div>
          </div>

          <div className="mt-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Connection Name</p>
            <input
              className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
              value={connectionName}
              onChange={(e) => setConnectionName(e.target.value)}
              data-testid="whatsapp-onboarding-connection-name"
            />
          </div>

          <button
            type="button"
            onClick={() => void onSaveConnectionName()}
            disabled={busy || !connectionName.trim()}
            className="mt-5 w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
            data-testid="whatsapp-onboarding-save-connection"
          >
            {busy ? "Saving…" : "Save Connection"}
          </button>

          <p className="mt-3 text-xs leading-relaxed text-slate-500" data-testid="whatsapp-onboarding-success-hint">
            You can now select this connection inside your WhatsApp Trigger/Action nodes.
          </p>
        </div>
      </div>
    );
  }

  if (step === "connecting") {
    return (
      <div className={shellClass}>
        <div className={cardClass}>
          <h1
            className="flex items-center gap-2 text-xl font-extrabold text-slate-900"
            data-testid="whatsapp-onboarding-connecting-title"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <WhatsAppIcon className="h-4 w-4" />
            </span>
            Connecting…
          </h1>
          <p className="mt-3 text-sm text-slate-600">Validating your number and opening Meta Embedded Signup.</p>
          <div className="mt-6 h-2 w-full overflow-hidden rounded-full bg-slate-100" aria-hidden>
            <div className="h-full w-2/3 animate-pulse rounded-full bg-amber-500" />
          </div>
        </div>
      </div>
    );
  }

  if (step === "redirect") {
    return (
      <div className={shellClass}>
        <div className={cardClass}>
          <h1
            className="flex items-center gap-2 text-xl font-extrabold text-slate-900"
            data-testid="whatsapp-onboarding-redirect-title"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <WhatsAppIcon className="h-4 w-4" />
            </span>
            Redirecting to Meta…
          </h1>
          <p className="mt-3 text-sm text-slate-600">
            Complete the WhatsApp Business authorization in the popup window.
          </p>
          <button
            type="button"
            onClick={() => {
              setStep("enter");
              setErrorMessage("");
            }}
            className="mt-6 w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            data-testid="whatsapp-onboarding-cancel"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className={cardClass}>
        <h1
          className="flex items-center gap-2.5 text-2xl font-extrabold tracking-tight text-slate-900"
          data-testid="whatsapp-onboarding-title"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
            <WhatsAppIcon className="h-5 w-5" />
          </span>
          Connect WhatsApp Business
        </h1>
        <p className="mt-2 text-sm text-slate-600" data-testid="whatsapp-onboarding-description">
          Connect your WhatsApp Business number to automate messages with Triven.ai.
        </p>

        <div className="mt-6">
          <label
            htmlFor="whatsapp-onboarding-phone"
            className="mb-1.5 block text-sm font-medium text-slate-700"
            data-testid="whatsapp-onboarding-phone-label"
          >
            WhatsApp Business Phone Number
          </label>
          <div className="flex">
            <CountryCodeSelect value={countryCode} onChange={setCountryCode} />
            <input
              id="whatsapp-onboarding-phone"
              type="tel"
              value={phoneDigits}
              onChange={(event) => setPhoneDigits(event.target.value)}
              placeholder="Phone number"
              className="w-full rounded-r-xl border border-gray-200 px-4 py-3 text-sm"
              data-testid="whatsapp-onboarding-phone-input"
            />
          </div>
        </div>

        {errorMessage ? (
          <p className="mt-3 text-sm font-medium text-rose-600" data-testid="whatsapp-onboarding-inline-error">
            {errorMessage}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => void onContinue()}
          disabled={!canContinue || busy}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-60"
          data-testid="whatsapp-onboarding-continue"
        >
          <WhatsAppIcon className="h-4 w-4" />
          {busy ? "Continuing…" : "Continue"}
        </button>
      </div>
    </div>
  );
}
