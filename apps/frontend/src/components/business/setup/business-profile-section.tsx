"use client";

import { useEffect, useState } from "react";
import { BusinessAddressSection } from "@/components/business/business-settings-view";
import type { BusinessFaq } from "@/components/business/features/api";
import { TRIVEN_AGENT_TAXONOMY_ENTRIES } from "@coreai/shared";
import { DocumentUploadSection, FaqSection } from "./knowledge-section";
import { FIELD, LABEL, SECTION_TITLE } from "./ui";
import { InfoTooltip } from "./InfoTooltip";

const SERVICE_MAP: Record<string, string[]> = {
  dental: ["Consultation", "Root canal", "Cleaning", "Whitening", "Braces"],
  veterinary: ["Consultation", "Vaccination", "Wellness exam", "Diagnostics", "Follow-up visit"],
  hospital: ["Appointment", "Specialist consultation", "Diagnostics", "Follow-up visit"],
  diagnostic: ["Lab test", "Blood test", "Health panel", "Sample collection"],
  "mental health": ["Initial consultation", "Therapy session", "Follow-up session"],
  cosmetic: ["Consultation", "Treatment consultation", "Follow-up visit"],
  plastic: ["Surgery consultation", "Procedure consultation", "Follow-up visit"],
  clinic: ["Consultation", "General checkup", "Diagnostics", "Follow-up visit"],
  "real estate": ["Property inquiry", "Property viewing", "Buyer consultation", "Seller consultation"],
  dealership: ["Vehicle inquiry", "Test drive", "Sales consultation", "Trade-in inquiry"],
  "auto service": ["Vehicle service", "Inspection", "Oil change", "Repair appointment"],
  "car rental": ["Rental reservation", "Availability inquiry", "Reservation change"],
  law: ["Consultation", "Case review", "Document review", "Follow-up consultation"],
  notary: ["Notary appointment", "Document notarization", "Document review"],
  salon: ["Haircut", "Coloring", "Manicure", "Facial", "Massage"],
  restaurant: ["Reservations", "Takeout orders", "Private events"]
};

const LEGACY_BUSINESS_TYPE_OPTIONS = [
  { value: "dental", label: "Dental clinic (legacy)" },
  { value: "clinic", label: "Medical clinic (legacy)" },
  { value: "law", label: "Law firm (legacy)" },
  { value: "realestate", label: "Real estate (legacy)" },
  { value: "salon", label: "Salon / spa" },
  { value: "restaurant", label: "Restaurant" },
  { value: "other", label: "Other" }
];

const BUSINESS_TYPE_OPTIONS = [
  ...(TRIVEN_AGENT_TAXONOMY_ENTRIES ?? []).map((entry) => ({
    value: entry.subindustry,
    label: `${entry.subindustry} · ${entry.industry}`
  })),
  ...LEGACY_BUSINESS_TYPE_OPTIONS
];

export function BusinessProfileSection({
  businessName,
  businessType,
  contactName,
  allContactNames = [],
  servicesText,
  onBusinessName,
  onBusinessType,
  onContactName,
  onAllContactNames,
  onServices,
  onAddressDirtyChange,
  onAddressValidChange,
  registerAddressApi,
  addressRefreshToken,
  listingId,
  installedAgentId,
  faqs,
  onFaqs,
  onSummaryChange,
  onKnowledgeChanged,
  hoursSuggestionReady = false,
  onReviewHours,
  clearAddressOnMount = false
}: {
  businessName: string;
  businessType: string;
  contactName: string;
  allContactNames?: string[];
  servicesText: string;
  onBusinessName: (v: string) => void;
  onBusinessType: (v: string) => void;
  onContactName: (v: string) => void;
  onAllContactNames?: (names: string[]) => void;
  onServices: (v: string) => void;
  onAddressDirtyChange?: (dirty: boolean) => void;
  onAddressValidChange?: (valid: boolean) => void;
  registerAddressApi?: (
    api: { save: () => Promise<{ ok: boolean; error?: string }>; isDirty: () => boolean } | null
  ) => void;
  /** Bump after document changes so the address section re-reads its suggestion. */
  addressRefreshToken?: number;
  listingId?: string;
  installedAgentId?: string | null;
  faqs?: BusinessFaq[];
  onFaqs?: (faqs: BusinessFaq[]) => void;
  onSummaryChange?: (summary: { files: number; ready: number }) => void;
  onKnowledgeChanged?: () => void;
  hoursSuggestionReady?: boolean;
  onReviewHours?: () => void;
  /** When true, address fields start empty (new agent install). */
  clearAddressOnMount?: boolean;
}) {
  const [selectedServices, setSelectedServices] = useState<string[]>(() =>
    servicesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
  );
  const [customServiceInput, setCustomServiceInput] = useState("");
  const [profileSuggestion, setProfileSuggestion] = useState<import("@/components/business/features/api").DocumentProfileSuggestion | null>(null);

  // Keep selectedServices in sync when servicesText prop changes (e.g. cleared on fresh install)
  useEffect(() => {
    const parsed = servicesText
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean);
    setSelectedServices(parsed);
  }, [servicesText]);

  // Sync selected services → servicesText state
  useEffect(() => {
    const next = selectedServices.join("\n");
    if (next !== servicesText) {
      onServices(next);
    }
  }, [selectedServices, servicesText, onServices]);

  // Handle profile suggestion fetched from uploaded documents
  function handleProfileSuggestion(suggestion: import("@/components/business/features/api").DocumentProfileSuggestion) {
    setProfileSuggestion(suggestion);
    // Do NOT auto-fill automatically. Allow user to review detected/mismatched info and click Apply.
  }

  // Derive service suggestions from businessType
  const typeKey =
    Object.keys(SERVICE_MAP).find((key) => businessType.toLowerCase().includes(key)) ?? "";
  const suggestions = (SERVICE_MAP[typeKey] ?? []).filter((s) => !selectedServices.includes(s));

  const [showDoctorChips, setShowDoctorChips] = useState(false);

  function addService(s: string) {
    if (!s.trim() || selectedServices.includes(s.trim())) return;
    setSelectedServices((prev) => [...prev, s.trim()]);
  }

  function removeService(idx: number) {
    setSelectedServices((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-5 min-w-0 w-full overflow-hidden">
      {/* 1. TOP: Document Upload UI */}
      <DocumentUploadSection
        listingId={listingId}
        installedAgentId={installedAgentId}
        onSummaryChange={onSummaryChange}
        onKnowledgeChanged={onKnowledgeChanged}
        currentContactName={contactName}
        currentBusinessName={businessName}
        currentServices={servicesText}
        onApplyContactName={(rawNames) => {
          const names = rawNames.split(",").map((s) => s.trim()).filter(Boolean);
          if (names.length > 0) {
            onContactName(names[0]); // Primary provider/contact only in the input box
            onAllContactNames?.(names);
          }
          setShowDoctorChips(true);
        }}
        onApplyBusinessName={(name) => onBusinessName(name)}
        onApplyServices={(newServices) => {
          for (const s of newServices) addService(s);
        }}
        onProfileSuggestionFetched={handleProfileSuggestion}
        hoursSuggestionReady={hoursSuggestionReady}
        onReviewHours={onReviewHours}
      />

      {/* 2. MIDDLE: Compact Business Details Form */}
      <div className="border-t border-gray-100 pt-4 space-y-4">
        <h4 className={SECTION_TITLE}>Business Details</h4>

        <div className="grid sm:grid-cols-3 gap-3">
          <div>
            <label htmlFor="biz-contact-name" className={LABEL}>
              Your name / Primary Contact <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="biz-contact-name"
              data-testid="business-setup-input-contact"
              type="text"
              value={contactName}
              onChange={(e) => {
                const newName = e.target.value;
                onContactName(newName);
                if (newName.trim()) {
                  const existingOther = allContactNames.filter((n) => n !== newName.trim());
                  onAllContactNames?.([newName.trim(), ...existingOther]);
                }
              }}
              placeholder="e.g. Jane Smith"
              className={FIELD}
            />
          </div>
          <div>
            <label htmlFor="biz-name" className={LABEL}>
              Business name
            </label>
            <div className="relative">
              <input
                id="biz-name"
                data-testid="business-setup-input-name"
                type="text"
                value={businessName}
                onChange={(e) => onBusinessName(e.target.value)}
                placeholder="e.g. Acme Health or Main Street Realty"
                className={`${FIELD} pr-10`}
              />
              {businessName.trim() && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-500" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              )}
            </div>
          </div>
          <div>
            <label htmlFor="biz-type" className={LABEL}>Business type</label>
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

          {/* Generic provider/team roster (works across healthcare, legal, real estate, automotive, etc.) */}
          {(() => {
            const primaryDoctor = contactName.trim();
            // Active roster consists ONLY of explicitly added team members (or user-entered primary contact)
            const activeRoster = Array.from(
              new Set([primaryDoctor, ...allContactNames].filter(Boolean))
            );

            // Only show the team roster when the user has added team members or clicked "Add Team"
            if (activeRoster.length === 0 && !showDoctorChips) return null;

            const currentPrimary = primaryDoctor || activeRoster[0] || "";

            const setAsPrimary = (docName: string) => {
              onContactName(docName);
              const remaining = activeRoster.filter((n) => n !== docName);
              onAllContactNames?.([docName, ...remaining]);
            };

            const toggleInRoster = (docName: string) => {
              if (activeRoster.includes(docName)) {
                const next = activeRoster.filter((n) => n !== docName);
                onAllContactNames?.(next);
                if (currentPrimary === docName) {
                  onContactName(next[0] ?? "");
                }
              } else {
                const next = [...activeRoster, docName];
                onAllContactNames?.(next);
              }
            };

            return (
              <div className="col-span-full border-t border-gray-100 pt-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider inline-flex items-center gap-1.5">
                    Team / Providers <span className="text-[11px] font-normal text-slate-400 normal-case">({activeRoster.length})</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-medium">
                    All selected stay in agent knowledge
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {activeRoster.map((docName, idx) => {
                    const isPrimary = currentPrimary === docName;

                    return (
                      <div
                        key={idx}
                        className={`inline-flex items-center gap-2 text-xs rounded-full px-3 py-1 border transition-all ${
                          isPrimary
                            ? "bg-amber-500 border-amber-500 text-white font-semibold shadow-2xs"
                            : "bg-white border-amber-300 text-slate-800 font-medium hover:border-amber-400"
                        }`}
                      >
                        <span className="font-medium">
                          {docName}
                        </span>

                        {isPrimary ? (
                          <span className="text-[9px] bg-amber-700/90 text-amber-50 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider">
                            Primary
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setAsPrimary(docName)}
                            className="text-[10px] text-slate-500 hover:text-amber-600 underline font-medium cursor-pointer"
                            title="Make primary contact"
                          >
                            Set Primary
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => toggleInRoster(docName)}
                          className={`cursor-pointer font-bold ${
                            isPrimary ? "text-amber-100 hover:text-white" : "text-slate-400 hover:text-red-500"
                          }`}
                          title="Remove from team"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>

        <div className="border-t border-gray-100 pt-3.5">
          <h4 className={`${SECTION_TITLE} mb-2 inline-flex items-center`}>
            Services
            <InfoTooltip content="Select what applies, or add your own." />
          </h4>
          <div id="serviceChips" className="flex flex-wrap gap-1.5">
            {selectedServices.map((s, i) => (
              <button
                key={i}
                type="button"
                className="text-xs font-medium border border-amber-400 bg-amber-400 text-white rounded-full px-2.5 py-1 transition-colors hover:bg-amber-500"
                onClick={() => removeService(i)}
              >
                {s} ✕
              </button>
            ))}
            {/* Standard preset suggestions */}
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="text-xs font-medium border border-gray-200 text-slate-600 rounded-full px-2.5 py-1 hover:border-amber-300 transition-colors"
                onClick={() => addService(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="flex gap-2 mt-2.5">
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
              className="field flex-1 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs text-slate-900 placeholder-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => { addService(customServiceInput); setCustomServiceInput(""); }}
              className="btn shrink-0 border border-gray-200 rounded-xl px-4 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Add
            </button>
          </div>
        </div>


        <div className="border-t border-gray-100 pt-3.5">
          <BusinessAddressSection
            embedded
            onDirtyChange={onAddressDirtyChange}
            onAddressValidChange={onAddressValidChange}
            registerApi={registerAddressApi}
            refreshToken={addressRefreshToken}
            clearOnMount={clearAddressOnMount}
          />
        </div>
      </div>

      {/* 3. BOTTOM: FAQ UI */}
      {faqs && onFaqs ? (
        <div className="border-t border-gray-100 pt-4">
          <FaqSection faqs={faqs} onFaqs={onFaqs} />
        </div>
      ) : null}
    </div>
  );
}
