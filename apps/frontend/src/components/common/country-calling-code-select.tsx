"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

export type CountryCallingCode = {
  id: string;
  name: string;
  countryCode: string;
  callingCode: string;
  flag: string;
};

export function CountryCallingCodeSelect({
  countries,
  value,
  fallbackCallingCode,
  loading,
  error,
  onChange
}: {
  countries: CountryCallingCode[];
  value: string;
  fallbackCallingCode: string;
  loading: boolean;
  error?: string;
  onChange: (country: CountryCallingCode) => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selected = countries.find((country) => country.countryCode === value) ?? null;

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    const updatePosition = () => {
      const rect = buttonRef.current!.getBoundingClientRect();
      const menuWidth = Math.min(320, window.innerWidth - 16);
      const menuMaxHeight = 288;
      const gap = 6;
      const spaceBelow = window.innerHeight - rect.bottom - gap;
      const dropUp = spaceBelow < Math.min(menuMaxHeight, 200) && rect.top > menuMaxHeight;
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - menuWidth - 8));

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

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        aria-label="Country calling code"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-busy={loading}
        onClick={() => setOpen((current) => !current)}
        className="flex h-full min-w-28 items-center justify-between gap-2 rounded-l-xl border border-r-0 border-gray-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-700 transition focus:z-10 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
        data-testid="architect-settings-phone-country-code"
      >
        <span className="whitespace-nowrap">
          {selected ? `${selected.flag} ${selected.callingCode}` : fallbackCallingCode}
        </span>
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
              aria-label="Countries and calling codes"
              style={menuStyle}
              className="overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl"
              data-testid="architect-settings-phone-country-menu"
            >
              {loading ? (
                <p className="px-3 py-3 text-sm text-slate-500">Loading countries…</p>
              ) : error ? (
                <p className="px-3 py-3 text-sm text-red-600">{error}</p>
              ) : (
                countries.map((country) => {
                  const active = country.countryCode === value;

                  return (
                    <button
                      key={country.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        onChange(country);
                        setOpen(false);
                        buttonRef.current?.focus();
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition ${
                        active
                          ? "bg-amber-50 text-amber-800"
                          : "text-slate-700 hover:bg-amber-50 hover:text-amber-800"
                      }`}
                      data-testid={`architect-settings-phone-country-${country.countryCode.toLowerCase()}`}
                    >
                      <span className="text-base" aria-hidden="true">{country.flag}</span>
                      <span className="min-w-0 flex-1 truncate">{country.name}</span>
                      <span className="shrink-0 font-medium text-slate-500">{country.callingCode}</span>
                    </button>
                  );
                })
              )}
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
