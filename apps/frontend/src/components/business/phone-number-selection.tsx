"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getPhoneCities,
  getPhoneCountries,
  getPhoneStates,
  purchaseBusinessPhoneNumber,
  searchBusinessPhoneNumbers,
  type AvailablePhoneNumber,
  type PhoneCountryOption,
  type PhoneNumberSearchResult,
  type PhoneStateOption
} from "@/components/business/features/api";

export function PhoneNumberSelectionSection({
  installedAgentId,
  listingId,
  forwardToPhone,
  replaceExisting = false,
  onProvisioned
}: {
  installedAgentId: string | null;
  /** Bootstraps the business server-side on first-time setup. */
  listingId?: string;
  /** The buyer's own line — stored as the forwarding target at purchase. */
  forwardToPhone?: string;
  /** Change-number flow: the old number is kept until the new one is active. */
  replaceExisting?: boolean;
  onProvisioned: (phoneNumber: string) => void;
}) {
  const [countries, setCountries] = useState<PhoneCountryOption[]>([]);
  const [catalogueNote, setCatalogueNote] = useState("");
  const [catalogueLoading, setCatalogueLoading] = useState(true);
  const [catalogueError, setCatalogueError] = useState("");
  const [country, setCountry] = useState("");
  const [state, setState] = useState("");
  const [city, setCity] = useState("");
  // States and cities are lazy-loaded from the full worldwide catalogue as the
  // buyer drills down: country → its states → that state's cities.
  const [states, setStates] = useState<PhoneStateOption[]>([]);
  const [statesLoading, setStatesLoading] = useState(false);
  const [cities, setCities] = useState<string[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<PhoneNumberSearchResult | null>(null);
  const [selectedNumber, setSelectedNumber] = useState<AvailablePhoneNumber | null>(null);
  const [fallbackType, setFallbackType] = useState<"NEARBY_CITY" | "SAME_STATE" | "NATIONAL" | "TOLL_FREE" | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState("");
  const [progressNote, setProgressNote] = useState("");
  // One idempotency key per confirmed selection — double clicks and retries
  // reuse it so two numbers can never be purchased for one confirmation.
  const clientRequestIdRef = useRef<string>("");
  // A location can change while Twilio is still searching. Only the newest
  // request may offer a number; older responses are ignored.
  const searchRequestSequenceRef = useRef(0);

  const loadCatalogue = useCallback(() => {
    setCatalogueLoading(true);
    setCatalogueError("");
    void getPhoneCountries().then((res) => {
      setCatalogueLoading(false);
      if (res.success && res.data) {
        setCountries(res.data.countries);
        setCatalogueNote(res.data.note);
      } else {
        // Show the safe error instead of hiding the whole section.
        setCatalogueError(res.error ?? "Could not load available locations. Please retry.");
      }
    });
  }, []);

  useEffect(() => {
    loadCatalogue();
  }, [loadCatalogue]);

  // Country picked → load that country's states (never purchases anything).
  useEffect(() => {
    setStates([]);
    setCities([]);
    if (!country) return;
    setStatesLoading(true);
    void getPhoneStates(country).then((res) => {
      setStatesLoading(false);
      if (res.success && res.data) {
        setStates(res.data.states);
        // A few countries have no states — load their city list directly.
        if (res.data.states.length === 0) {
          setCitiesLoading(true);
          void getPhoneCities(country, "").then((cityRes) => {
            setCitiesLoading(false);
            if (cityRes.success && cityRes.data) setCities(cityRes.data.cities);
          });
        }
      } else {
        setCatalogueError(res.error ?? "Could not load states for the selected country.");
      }
    });
  }, [country]);

  // State picked → load that state's cities.
  useEffect(() => {
    if (!country || !state) return;
    setCities([]);
    setCitiesLoading(true);
    void getPhoneCities(country, state).then((res) => {
      setCitiesLoading(false);
      if (res.success && res.data) {
        setCities(res.data.cities);
      } else {
        setCatalogueError(res.error ?? "Could not load cities for the selected state.");
      }
    });
  }, [country, state]);

  const selectedCountry = countries.find((entry) => entry.code === country) ?? null;
  const selectedRegion = states.find((entry) => entry.code === state) ?? null;

  const resetOffer = useCallback(() => {
    searchRequestSequenceRef.current += 1;
    clientRequestIdRef.current = "";
    setSearching(false);
    setSearchResult(null);
    setSelectedNumber(null);
    setFallbackType(null);
    setPurchaseError("");
  }, []);

  const runSearch = useCallback(async (overrides?: {
    state?: string;
    city?: string;
    fallback?: "NEARBY_CITY" | "SAME_STATE" | "NATIONAL" | "TOLL_FREE";
  }) => {
    if (!country) return;

    const requestSequence = searchRequestSequenceRef.current + 1;
    searchRequestSequenceRef.current = requestSequence;
    // Each search creates a new single offer. Confirmation retries without a
    // new search continue to reuse the same provisioning request key.
    clientRequestIdRef.current = "";
    setSearching(true);
    setPurchaseError("");
    setSearchResult(null);
    setSelectedNumber(null);
    setFallbackType(overrides?.fallback ?? null);

    const res = await searchBusinessPhoneNumbers({
      installedAgentId: installedAgentId ?? undefined,
      listingId: listingId || undefined,
      country,
      state: overrides?.state !== undefined ? overrides.state || undefined : state || undefined,
      city: overrides?.city !== undefined ? overrides.city || undefined : city || undefined
    });

    if (searchRequestSequenceRef.current !== requestSequence) return;

    setSearching(false);

    if (res.success && res.data) {
      setSearchResult(res.data);
      // Twilio can return several candidates, but setup deliberately offers
      // only one. Nothing is purchased until the buyer confirms it below.
      setSelectedNumber(res.data.numbers[0] ?? null);
    } else {
      setSearchResult(null);
      setPurchaseError(res.error ?? "Could not search available numbers.");
    }
  }, [city, country, installedAgentId, listingId, state]);

  // Once the complete location is known, immediately offer one exact-location
  // number. The manual button remains for retries and country/state-only cases.
  useEffect(() => {
    if (!country || !city) return;
    void runSearch();
  }, [city, country, runSearch]);

  const confirmPurchase = async () => {
    if (!selectedNumber || purchasing) return;
    if (!clientRequestIdRef.current) {
      clientRequestIdRef.current = `pn_${Math.random().toString(36).slice(2, 12)}${Date.now().toString(36)}`;
    }

    setPurchasing(true);
    setPurchaseError("");
    setProgressNote("Rechecking availability and purchasing your number…");

    const res = await purchaseBusinessPhoneNumber({
      installedAgentId: installedAgentId ?? undefined,
      listingId: listingId || undefined,
      clientRequestId: clientRequestIdRef.current,
      phoneNumber: selectedNumber.phoneNumber,
      country,
      state: state || undefined,
      city: city || undefined,
      fallbackType: fallbackType ?? undefined,
      forwardToPhone: forwardToPhone?.trim() || undefined,
      replaceExisting: replaceExisting || undefined
    });

    setPurchasing(false);
    setProgressNote("");

    if (res.success && res.data && res.data.status === "ACTIVE" && res.data.phoneNumber) {
      onProvisioned(res.data.phoneNumber);
      return;
    }

    const message =
      (res.success ? res.data?.errorMessage : null) ??
      res.error ??
      "The number could not be provisioned. Please try another number.";
    setPurchaseError(message);

    if (res.success && res.data?.errorCode === "NUMBER_NO_LONGER_AVAILABLE") {
      // Reselection: only here does a retry get a fresh idempotency key. All
      // other failures keep the SAME clientRequestId so the server resumes the
      // existing provisioning request instead of purchasing a second number.
      clientRequestIdRef.current = "";
      setSelectedNumber(null);
      void runSearch();
    }
  };

  return (
    <div className="flex items-start gap-3.5" data-testid="business-setup-number-selection">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6 text-amber-500 shrink-0 mt-0.5">
        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />
      </svg>
      <div className="w-full">
        <p className="text-sm font-semibold text-slate-800">Choose your Triven AI phone number</p>
        <p className="mt-1 text-xs text-slate-500">
          {catalogueNote || "Number availability depends on Twilio inventory and local regulatory requirements."}
        </p>

        {catalogueLoading ? (
          <p className="mt-3 text-sm text-slate-500" data-testid="business-setup-phone-locations-loading">
            Loading available locations…
          </p>
        ) : null}

        {catalogueError ? (
          <div className="mt-3 rounded-xl border border-rose-100 bg-rose-50 px-4 py-3" data-testid="business-setup-phone-locations-error">
            <p className="text-sm font-semibold text-rose-700">{catalogueError}</p>
            <button
              type="button"
              onClick={loadCatalogue}
              data-testid="business-setup-phone-locations-retry"
              className="mt-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">Country</span>
            <select
              data-testid="business-setup-phone-country"
              value={country}
              onChange={(event) => {
                resetOffer();
                setCountry(event.target.value);
                setState("");
                setCity("");
              }}
              disabled={purchasing}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50"
            >
              <option value="">Select country…</option>
              {countries.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">State / Province</span>
            <select
              data-testid="business-setup-phone-state"
              value={state}
              onChange={(event) => {
                resetOffer();
                setState(event.target.value);
                setCity("");
              }}
              disabled={purchasing || !selectedCountry || statesLoading || (states.length === 0 && !statesLoading)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:bg-gray-50 disabled:text-slate-400"
            >
              <option value="">
                {statesLoading
                  ? "Loading states…"
                  : selectedCountry && states.length === 0
                    ? "No states — pick a city"
                    : "Select state…"}
              </option>
              {states.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">City</span>
            <select
              data-testid="business-setup-phone-city"
              value={city}
              onChange={(event) => {
                resetOffer();
                setCity(event.target.value);
              }}
              disabled={purchasing || citiesLoading || cities.length === 0}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-400/50 disabled:bg-gray-50 disabled:text-slate-400"
            >
              <option value="">
                {citiesLoading
                  ? "Loading cities…"
                  : cities.length > 0
                    ? "Select city…"
                    : selectedRegion
                      ? "No cities listed"
                      : "Pick a state first"}
              </option>
              {cities.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={!country || searching || purchasing}
          data-testid="business-setup-phone-search"
          className="mt-4 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-60"
        >
          {searching ? "Searching…" : searchResult ? "Retry search" : "Find one available number"}
        </button>

        {searchResult && !searchResult.exactMatchAvailable && searchResult.fallbackOptions.length > 0 ? (
          <div className="mt-4 rounded-xl border border-amber-100 bg-amber-50 p-4" data-testid="business-setup-phone-fallback">
            <p className="text-sm font-semibold text-slate-800">
              No phone numbers are currently available for the selected city.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              You can search a nearby city, choose another number from the same state, or select a national number where available.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {searchResult.fallbackOptions.includes("NEARBY_CITY") ? (
                <button
                  type="button"
                  onClick={() => {
                    resetOffer();
                    setCity("");
                  }}
                  data-testid="business-setup-phone-fallback-nearby"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
                >
                  Pick a nearby city
                </button>
              ) : null}
              {searchResult.fallbackOptions.includes("SAME_STATE") ? (
                <button
                  type="button"
                  onClick={() => void runSearch({ city: "", fallback: "SAME_STATE" })}
                  data-testid="business-setup-phone-fallback-state"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
                >
                  Search the whole state
                </button>
              ) : null}
              {searchResult.fallbackOptions.includes("NATIONAL") ? (
                <button
                  type="button"
                  onClick={() => void runSearch({ state: "", city: "", fallback: "NATIONAL" })}
                  data-testid="business-setup-phone-fallback-national"
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-gray-50"
                >
                  Search nationwide
                </button>
              ) : null}
            </div>
          </div>
        ) : null}

        {searchResult && selectedNumber ? (
          <div className="mt-4 space-y-2" data-testid="business-setup-phone-results">
            {searchResult.localityFilterSupported === false ? (
              <p className="text-xs font-semibold text-amber-700" data-testid="business-setup-phone-countrywide-note">
                State/city filtering isn&apos;t available for this country — showing numbers from across the country. Your selected location is saved with your request.
              </p>
            ) : null}
            {fallbackType ? (
              <p className="text-xs font-semibold text-amber-700" data-testid="business-setup-phone-fallback-note">
                This number is {fallbackType === "SAME_STATE" ? "from the selected state" : "from the selected country"}, not an exact-city match. Confirm below if you want to use it.
              </p>
            ) : null}
            <div
              data-testid="business-setup-phone-review"
              className="w-full rounded-xl border border-amber-400 bg-amber-50 p-4 text-left"
            >
              <div data-testid="business-setup-phone-result">
                <span className="block text-[11px] font-semibold uppercase tracking-wider text-amber-700">Available number</span>
                <span className="mt-1 block font-mono text-sm font-bold text-slate-900">{selectedNumber.friendlyName || selectedNumber.phoneNumber}</span>
                <span className="mt-0.5 block text-xs text-slate-500">
                  {[selectedNumber.locality, selectedNumber.region, selectedNumber.country].filter(Boolean).join(", ")}
                  {" · "}
                  {[
                    selectedNumber.capabilities.voice ? "Voice" : null,
                    selectedNumber.capabilities.sms ? "SMS" : null,
                    selectedNumber.capabilities.mms ? "MMS" : null
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {selectedNumber.feeCents > 0 ? (
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {selectedNumber.feeLabel}: ${(selectedNumber.feeCents / 100).toFixed(2)} (one-time)
                  </span>
                ) : null}
                {selectedNumber.regulatoryNote ? (
                  <span className="mt-0.5 block text-xs font-semibold text-amber-700">{selectedNumber.regulatoryNote}</span>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void confirmPurchase()}
                disabled={purchasing}
                data-testid="business-setup-phone-confirm"
                className="mt-3 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-60"
              >
                {purchasing ? "Provisioning…" : "Confirm and provision this number"}
              </button>
              {progressNote ? (
                <p className="mt-2 text-xs text-slate-500" data-testid="business-setup-phone-progress">{progressNote}</p>
              ) : null}
            </div>
          </div>
        ) : null}

        {searchResult && searchResult.numbers.length === 0 && searchResult.fallbackOptions.length === 0 ? (
          <p className="mt-4 text-sm font-semibold text-rose-600" data-testid="business-setup-phone-empty">
            No phone number is currently available for this location. Choose another location or retry.
          </p>
        ) : null}

        {purchaseError ? (
          <p className="mt-3 text-sm font-semibold text-rose-600" data-testid="business-setup-phone-error">{purchaseError}</p>
        ) : null}
      </div>
    </div>
  );
}
