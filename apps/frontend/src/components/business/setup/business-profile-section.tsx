"use client";

import { useEffect, useState } from "react";
import { BusinessAddressSection } from "@/components/business/business-settings-view";
import { FIELD } from "./ui";

/**
 * Business Profile section of the Configure step: who the business is.
 * The address block is the SAME authoritative record Business Settings edits
 * (embedded mode — saved by the page-level save, not its own button).
 */

const SERVICE_MAP: Record<string, string[]> = {
  dental: ["Consultation", "Root canal", "Cleaning", "Whitening", "Braces"],
  salon: ["Haircut", "Coloring", "Manicure", "Facial", "Massage"],
  clinic: ["General checkup", "Vaccination", "Lab tests", "Follow-up visit"],
  restaurant: ["Reservations", "Takeout orders", "Private events"],
  law: ["Consultation", "Case review", "Document filing"],
  realestate: ["Property viewing", "Listing inquiry", "Valuation"]
};

const BUSINESS_TYPE_OPTIONS = [
  { value: "dental", label: "Dental clinic" },
  { value: "salon", label: "Salon / spa" },
  { value: "clinic", label: "Medical clinic" },
  { value: "restaurant", label: "Restaurant" },
  { value: "law", label: "Law firm" },
  { value: "realestate", label: "Real estate" },
  { value: "other", label: "Other" }
];

export function BusinessProfileSection({
  businessName,
  businessType,
  contactName,
  servicesText,
  onBusinessName,
  onBusinessType,
  onContactName,
  onServices,
  onAddressDirtyChange,
  registerAddressApi
}: {
  businessName: string;
  businessType: string;
  contactName: string;
  servicesText: string;
  onBusinessName: (v: string) => void;
  onBusinessType: (v: string) => void;
  onContactName: (v: string) => void;
  onServices: (v: string) => void;
  onAddressDirtyChange?: (dirty: boolean) => void;
  registerAddressApi?: (
    api: { save: () => Promise<{ ok: boolean; error?: string }>; isDirty: () => boolean } | null
  ) => void;
}) {
  const [selectedServices, setSelectedServices] = useState<string[]>(() =>
    servicesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const [customServiceInput, setCustomServiceInput] = useState("");

  // Sync selected services → servicesText state
  useEffect(() => {
    onServices(selectedServices.join("\n"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedServices]);

  // Derive service suggestions from businessType
  const typeKey =
    Object.keys(SERVICE_MAP).find((key) => businessType.toLowerCase().includes(key)) ?? "";
  const suggestions = (SERVICE_MAP[typeKey] ?? []).filter((s) => !selectedServices.includes(s));

  function addService(s: string) {
    if (!s.trim() || selectedServices.includes(s.trim())) return;
    setSelectedServices((prev) => [...prev, s.trim()]);
  }

  function removeService(idx: number) {
    setSelectedServices((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div>
      <h4 className="mb-3 text-sm font-bold text-slate-900">Business details</h4>
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="biz-contact-name" className="block text-sm font-medium text-slate-700 mb-1.5">
            Your name <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="biz-contact-name"
            data-testid="business-setup-input-contact"
            type="text"
            value={contactName}
            onChange={(e) => onContactName(e.target.value)}
            placeholder="Dr. Jhon Doe"
            className={FIELD}
          />
        </div>
        <div>
          <label htmlFor="biz-name" className="block text-sm font-medium text-slate-700 mb-2">
            Business name
          </label>
          <div className="relative">
            <input
              id="biz-name"
              data-testid="business-setup-input-name"
              type="text"
              value={businessName}
              onChange={(e) => onBusinessName(e.target.value)}
              placeholder="Central Perk Hospital"
              className={`${FIELD} pr-12`}
            />
            {businessName.trim() && (
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-green-500" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5">
        <label htmlFor="biz-type" className="block text-sm font-medium text-slate-700 mb-2">Business type</label>
        <select
          id="biz-type"
          data-testid="business-setup-input-type"
          value={businessType}
          onChange={(e) => onBusinessType(e.target.value)}
          className={FIELD}
        >
          <option value="">Select your business type</option>
          {BUSINESS_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>

      {/* Structured business address — the same record as Business Settings */}
      <div className="mt-6 border-t border-gray-100 pt-5">
        <BusinessAddressSection
          embedded
          onDirtyChange={onAddressDirtyChange}
          registerApi={registerAddressApi}
        />
      </div>

      {/* Services offered */}
      <div className="mt-6 border-t border-gray-100 pt-5">
        <h4 className="mb-1 text-sm font-bold text-slate-900">Services</h4>
        <p className="text-xs text-slate-500 mb-3">Select what applies, or add your own.</p>
        <div id="serviceChips" className="flex flex-wrap gap-2">
          {selectedServices.map((s, i) => (
            <button
              key={i}
              type="button"
              className="text-xs font-semibold border border-amber-400 bg-amber-400 text-white rounded-full px-3 py-1.5 transition-colors hover:bg-amber-500"
              onClick={() => removeService(i)}
            >
              {s} ✕
            </button>
          ))}
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="text-xs font-semibold border border-gray-200 text-slate-600 rounded-full px-3 py-1.5 hover:border-amber-300 transition-colors"
              onClick={() => addService(s)}
            >
              {s}
            </button>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input
            id="custom-service"
            data-testid="business-setup-input-services"
            type="text"
            value={customServiceInput}
            onChange={(e) => setCustomServiceInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addService(customServiceInput); setCustomServiceInput(""); }
            }}
            placeholder="Add another service"
            className="field flex-1 rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:outline-none"
          />
          <button
            type="button"
            onClick={() => { addService(customServiceInput); setCustomServiceInput(""); }}
            className="btn shrink-0 border border-gray-200 rounded-xl px-5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
