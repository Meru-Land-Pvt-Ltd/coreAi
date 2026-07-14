"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { getAuthToken, getAuthUser } from "@/lib/auth";
import {
    BUSINESS_LOGIN_PATH,
    BUSINESS_MARKETPLACE_PATH,
    PRIVACY_PATH,
    TERM_PATH,
    businessPaymentFailedPath,
    businessPaymentSuccessPath,
    businessSetupPath
} from "@/lib/routes";

type CheckoutWorkflowNode = {
    data?: {
        label?: string;
        title?: string;
        connector?: string;
    };
};

type CheckoutWorkflow = {
    workflowJson?: {
        nodes?: CheckoutWorkflowNode[];
    } | null;
};

type CheckoutListing = {
    id: string;
    name: string;
    priceCents?: number | null;
    requiredConnectors?: string[];
    supportedLlms?: string[];
    workflow?: CheckoutWorkflow | null;
    architect?: {
        fullName?: string | null;
        email?: string | null;
        architectProfile?: {
            title?: string | null;
            rating?: number | null;
            completedJobs?: number | null;
        } | null;
    } | null;
};

type CheckoutListingResponse = {
    listing?: CheckoutListing;
};

type StartTrialResponse = {
    payment?: { id: string; status: string };
    alreadyActive?: boolean;
};

type PurchaseResponse = {
    payment?: { id: string; status: string };
    alreadyActive?: boolean;
};

type ListingAccess = {
    canStartTrial: boolean;
    hasActiveAccess: boolean;
    trialUsed: boolean;
    canPayNow?: boolean;
    amountCents: number;
    phoneNumberFee?: { label: string; amountCents: number } | null;
    purchaseStatus: string | null;
    pricingModel?: string | null;
    freeTrialEnabled?: boolean | null;
    trialDays?: number | null;
    usagePricing?: {
        perMinuteUsd: number;
        services: Array<{ code: string; name: string; unit: string; unitPriceUsd: number }>;
    };
};

type CheckoutCountry = {
    id: string;
    name: string;
    countryCode: string;
    flag: string;
};

type CountriesResponse = {
    countries: CheckoutCountry[];
};

type CheckoutUsageBill = {
    month: string;
    agentRollup: Array<{
        agentId: string | null;
        agentName: string;
        callCount: number;
        durationMinutes: number;
        amountCents: number;
        serviceCosts: Array<{
            serviceCode: string;
            serviceName: string;
            billedCostUsd: number;
        }>;
    }>;
};

const FALLBACK_COUNTRIES: CheckoutCountry[] = [
    {
        id: "fallback-us",
        name: "United States of America",
        countryCode: "US",
        flag: "🇺🇸"
    }
];

function testPaymentMethodForBrand(brand: CardBrand) {
    if (brand === "mastercard") return "pm_card_mastercard";
    if (brand === "amex") return "pm_card_amex";
    return "pm_card_visa";
}

type PaymentTab = "credit" | "google" | "apple";
type CardBrand = "visa" | "mastercard" | "amex" | null;

type ConfettiPiece = {
    id: number;
    left: string;
    width: string;
    height: string;
    background: string;
    delay: string;
    duration: string;
};

const CHECKOUT_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap');

.checkout-root {
  font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

.tnum {
  font-variant-numeric: tabular-nums;
}

.field-wrap {
  position: relative;
}

.field {
  width: 100%;
  border: 1.5px solid #e5e7eb;
  border-radius: 0.75rem;
  padding: 1rem 1.25rem;
  font-size: 1rem;
  line-height: 1.25rem;
  color: #0f172a;
  background: #fff;
  transition: border-color .25s ease, box-shadow .25s ease;
  outline: none;
  appearance: none;
  -webkit-appearance: none;
}

.field::placeholder {
  color: #9ca3af;
}

.field:hover {
  border-color: #d1d5db;
}

.field:focus {
  border-color: #fbbf24;
  box-shadow: 0 0 0 3px rgba(245,158,11,.16);
}

.field.is-valid {
  border-color: #22c55e;
}

.field.is-valid:focus {
  box-shadow: 0 0 0 3px rgba(34,197,94,.16);
}

.field.is-error {
  border-color: #ef4444;
}

.field.is-error:focus {
  box-shadow: 0 0 0 3px rgba(239,68,68,.16);
}

.field.with-adorn {
  padding-right: 3.25rem;
}

.field.with-brands {
  padding-right: 7.25rem;
}

select.field {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 1rem center;
  padding-right: 3rem;
  cursor: pointer;
}

.country-select {
  position: relative;
}

.country-select-trigger {
  text-align: left;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='20' height='20' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 1rem center;
  padding-right: 3rem;
}

.country-select-menu {
  position: absolute;
  z-index: 40;
  left: 0;
  right: 0;
  margin-top: 0.35rem;
  max-height: 240px;
  overflow-y: auto;
  border: 1.5px solid #e5e7eb;
  border-radius: 0.75rem;
  background: #fff;
  padding: 0.35rem;
  box-shadow: 0 10px 25px rgba(15, 23, 42, 0.12);
  list-style: none;
}

.country-select-option {
  width: 100%;
  border: none;
  border-radius: 0.5rem;
  background: transparent;
  padding: 0.65rem 0.85rem;
  font-size: 0.95rem;
  line-height: 1.25rem;
  color: #0f172a;
  text-align: left;
  cursor: pointer;
}

.country-select-option:hover,
.country-select-option.is-selected {
  background: #fffbeb;
}

.country-select-option.is-selected {
  font-weight: 600;
}

.adorn {
  position: absolute;
  right: 1rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  pointer-events: none;
}

.brands {
  position: absolute;
  right: .85rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  gap: .35rem;
  align-items: center;
  pointer-events: none;
}

.brand {
  transition: opacity .25s ease, filter .25s ease;
  opacity: .35;
}

.brand-on {
  opacity: 1;
}

.brand-off {
  opacity: .15;
  filter: grayscale(1);
}

.error-msg {
  color: #ef4444;
  font-size: .75rem;
  margin-top: .45rem;
  display: flex;
  align-items: center;
  gap: .3rem;
}

.step-circle {
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 9999px;
  display: grid;
  place-items: center;
  font-size: .75rem;
  font-weight: 700;
  flex-shrink: 0;
  transition: all .35s ease;
}

.step-circle.todo {
  background: #fff;
  border: 2px solid #e5e7eb;
  color: #94a3b8;
}

.step-circle.active {
  background: #f59e0b;
  color: #fff;
  box-shadow: 0 4px 12px -4px rgba(245,158,11,.6);
}

.step-circle.done {
  background: #f59e0b;
  color: #fff;
}

.step-line {
  width: 2rem;
  height: 2px;
  background: #e5e7eb;
  margin: 0 .4rem;
  transition: background .35s ease;
  border-radius: 2px;
}

.step-line.done {
  background: #fbbf24;
}

@media (min-width: 640px) {
  .step-line {
    width: 3rem;
  }
}

.pay-tab {
  border: 1px solid #e5e7eb;
  border-bottom: 0;
  border-top-left-radius: .75rem;
  border-top-right-radius: .75rem;
  padding: .7rem 1.25rem;
  font-weight: 600;
  font-size: .9rem;
  color: #64748b;
  background: #f9fafb;
  transition: all .2s ease;
  cursor: pointer;
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: .4rem;
}

.pay-tab:not(:first-child) {
  margin-left: -1px;
}

.pay-tab.active {
  background: #fff;
  color: #0f172a;
  z-index: 10;
}

.pay-tab:hover:not(.active) {
  color: #334155;
  background: #fff;
}

.cta {
  width: 100%;
  background: #f59e0b;
  color: #fff;
  border-radius: .75rem;
  padding: 1rem 1.25rem;
  font-size: 1.05rem;
  font-weight: 700;
  box-shadow: 0 10px 24px -8px rgba(245,158,11,.55);
  transition: all .25s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: .55rem;
  cursor: pointer;
}

.cta:not(:disabled):hover {
  background: #d97706;
  box-shadow: 0 14px 30px -8px rgba(245,158,11,.65);
  transform: translateY(-1px);
}

.cta:not(:disabled):active {
  transform: translateY(0);
}

.cta:disabled {
  opacity: .5;
  cursor: not-allowed;
  box-shadow: none;
}

.spinner {
  width: 1.15rem;
  height: 1.15rem;
  border: 2.5px solid rgba(255,255,255,.45);
  border-top-color: #fff;
  border-radius: 9999px;
  animation: spin .7s linear infinite;
  display: inline-block;
}

.reveal {
  overflow: hidden;
  max-height: 0;
  opacity: 0;
  transition: max-height .35s ease, opacity .3s ease, margin .3s ease;
}

.reveal.open {
  max-height: 420px;
  opacity: 1;
}

.scale-in {
  animation: scaleIn .55s cubic-bezier(.34,1.56,.64,1) both;
}

.fade-up {
  animation: fadeUp .5s ease both;
}

.confetti-host {
  position: fixed;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 60;
}

.confetti-piece {
  position: absolute;
  top: -12vh;
  border-radius: 2px;
  animation-name: confettiFall;
  animation-timing-function: linear;
  animation-fill-mode: forwards;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

@keyframes scaleIn {
  0% { transform: scale(.5); opacity: 0; }
  55% { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); }
}

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(14px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes confettiFall {
  0% { transform: translateY(-12vh) rotateZ(0deg); opacity: 1; }
  100% { transform: translateY(112vh) rotateZ(720deg); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: .001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .001ms !important;
  }

  .confetti-piece {
    display: none !important;
  }
}
`;

// Derive the "What's included" list from the purchased agent's listing so the
// order summary reflects the real agent rather than static copy. The workflow
// nodes describe the actual steps; connectors/LLMs and requiredConnectors are
// used as a fallback when the workflow has no usable step labels.
function getIncludedItems(listing: CheckoutListing) {
    const nodes = listing.workflow?.workflowJson?.nodes ?? [];

    const fromNodes = nodes
        .map((node) => node.data?.label || node.data?.title)
        .filter((value): value is string => Boolean(value?.trim()));

    const fromConnectors = (listing.requiredConnectors ?? []).map(
        (connector) => `${connector} integration`
    );
    const fromLlms = (listing.supportedLlms ?? []).map((llm) => `${llm} support`);

    const items = Array.from(new Set([...fromNodes, ...fromConnectors, ...fromLlms]));

    return items;
}

const nextSteps = [
    "Connect your phone number",
    "Customize your text-back message",
    "Set business hours"
];

function formatTrialDate(days = 7) {
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const date = new Date();
    date.setDate(date.getDate() + days);

    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`;
}

function detectBrand(digits: string): CardBrand {
    if (/^4/.test(digits)) return "visa";
    if (/^(34|37)/.test(digits)) return "amex";
    if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
    return null;
}

function formatCardNumber(value: string) {
    let digits = value.replace(/\D/g, "");
    const brand = detectBrand(digits);

    if (brand === "amex") {
        digits = digits.slice(0, 15);
        const match = digits.match(/^(\d{0,4})(\d{0,6})(\d{0,5})/);
        return [match?.[1], match?.[2], match?.[3]].filter(Boolean).join(" ");
    }

    digits = digits.slice(0, 16);
    return digits.match(/.{1,4}/g)?.join(" ") ?? digits;
}

function formatExpiry(value: string) {
    const digits = value.replace(/\D/g, "").slice(0, 4);

    if (digits.length >= 3) {
        return `${digits.slice(0, 2)} / ${digits.slice(2)}`;
    }

    return digits;
}

function isExpiryValid(value: string) {
    const digits = value.replace(/\D/g, "");

    if (digits.length !== 4) return false;

    const month = Number(digits.slice(0, 2));
    const year = 2000 + Number(digits.slice(2));
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1;

    if (month < 1 || month > 12) return false;
    if (year < currentYear) return false;
    if (year === currentYear && month < currentMonth) return false;

    return true;
}

function isZipValid(country: string, value: string) {
    const clean = value.trim();

    if (country === "US") {
        return /^\d{5}(-\d{4})?$/.test(clean);
    }

    return clean.length >= 3;
}

function formatBillingAddress(addressLine: string, zip: string, countryName: string) {
    return [addressLine.trim(), zip.trim(), countryName.trim()].filter(Boolean).join(", ");
}

export default function BusinessCheckoutPage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const listingId = searchParams.get("listingId");
    const usageMode = searchParams.get("mode") === "usage";
    const usageAgentId = searchParams.get("agentId") || null;

    const [authReady, setAuthReady] = useState(false);
    const [email, setEmail] = useState("");
    const [listingName, setListingName] = useState("");
    const [listingAuthor, setListingAuthor] = useState("");
    const [basePrice, setBasePrice] = useState(0);
    const [includedItems, setIncludedItems] = useState<string[]>([]);
    const [usageSummaryLoading, setUsageSummaryLoading] = useState(usageMode);
    const [usageSummaryReady, setUsageSummaryReady] = useState(!usageMode);
    const [trialError, setTrialError] = useState("");
    const [paymentTab, setPaymentTab] = useState<PaymentTab>("credit");

    const [cardNumber, setCardNumber] = useState("");
    const [expiry, setExpiry] = useState("");
    const [cvc, setCvc] = useState("");
    const [cardName, setCardName] = useState("");
    const [addressLine, setAddressLine] = useState("");
    const [zip, setZip] = useState("");
    const [countries, setCountries] = useState<CheckoutCountry[]>(FALLBACK_COUNTRIES);
    const [countryCode, setCountryCode] = useState("US");

    const [touched, setTouched] = useState({
        card: false,
        expiry: false,
        cvc: false,
        name: false,
        address: false,
        zip: false
    });

    const [attemptedSubmit, setAttemptedSubmit] = useState(false);
    const [processing, setProcessing] = useState(false);
    const [checkoutError, setCheckoutError] = useState("");
    const [listingAccess, setListingAccess] = useState<ListingAccess | null>(null);
    const [postpaidRate, setPostpaidRate] = useState<number | null>(null);
    const [confirmation, setConfirmation] = useState(false);
    const [confetti, setConfetti] = useState<ConfettiPiece[]>([]);

    const isFree = listingAccess?.pricingModel === "FREE";
    const trialDays = listingAccess?.trialDays ?? 7;
    const trialDate = useMemo(() => formatTrialDate(trialDays), [trialDays]);
    const selectedCountry = useMemo(
        () => countries.find((country) => country.countryCode === countryCode) ?? countries[0],
        [countries, countryCode]
    );
    const cardDigits = cardNumber.replace(/\D/g, "");
    const brand = detectBrand(cardDigits);
    const requiredCardLength = brand === "amex" ? 15 : 16;
    const requiredCvcLength = brand === "amex" ? 4 : 3;

    const validations = {
        card: cardDigits.length === requiredCardLength && cardDigits.length > 0,
        expiry: isExpiryValid(expiry),
        cvc: new RegExp(`^\\d{${requiredCvcLength}}$`).test(cvc),
        name: cardName.trim().length >= 2 && /[a-zA-Z]/.test(cardName),
        address: addressLine.trim().length >= 3,
        zip: isZipValid(countryCode, zip)
    };

    // One-time dedicated number fee for phone-capable agents — charged with
    // the agent price, shown as its own summary row.
    const phoneFee = usageMode ? null : listingAccess?.phoneNumberFee ?? null;
    const phoneFeeAmount = (phoneFee?.amountCents ?? 0) / 100;
    const payTotal = basePrice + phoneFeeAmount;

    const futureAmount = payTotal;
    const canPayNow = listingAccess?.canPayNow ?? (
        listingAccess ? listingAccess.trialUsed && !listingAccess.hasActiveAccess : false
    );
    const isPurchaseMode = usageMode || canPayNow || isFree;
    const hasActiveAccess = listingAccess?.hasActiveAccess ?? false;
    const checkoutBlocked = !usageMode && hasActiveAccess && !canPayNow;
    const dueTodayAmount = isFree ? 0 : (isPurchaseMode ? payTotal : 0);
    const checkoutButtonLabel = isFree
        ? "Install Agent"
        : isPurchaseMode
            ? `Pay $${payTotal.toFixed(2)}`
            : `Start ${trialDays}-day free trial`;
    const mobileCheckoutButtonLabel = isFree
        ? "Install Agent"
        : isPurchaseMode
            ? `Pay $${payTotal.toFixed(2)}`
            : "Start free trial";

    const formReady =
        authReady &&
        (isFree ||
        (usageMode && usageSummaryReady) ||
        (paymentTab !== "credit" ||
            (validations.card &&
                validations.expiry &&
                validations.cvc &&
                validations.name &&
                validations.address &&
                validations.zip)));

    useEffect(() => {
        const token = getAuthToken();
        const user = getAuthUser();

        if (!token || user?.role !== "BUSINESS") {
            router.replace(BUSINESS_LOGIN_PATH);
            return;
        }

        setEmail(user.email || "");
        setAuthReady(true);
    }, [router]);

    useEffect(() => {
        if (!authReady || !usageMode) return;

        let mounted = true;

        async function loadUsageSummary() {
            setUsageSummaryLoading(true);
            setUsageSummaryReady(false);

            const response = await apiGet<CheckoutUsageBill>("/business/billing/usage");
            if (!mounted) return;

            const usage = response.data;
            const agentUsage = usage?.agentRollup.find((entry) => entry.agentId === usageAgentId);
            if (!response.success || !usage || !agentUsage) {
                setCheckoutError(response.error ?? "Could not load the current usage summary.");
                setUsageSummaryLoading(false);
                return;
            }

            setListingName(agentUsage.agentName);
            setListingAuthor(
                `${usage.month} · ${agentUsage.callCount} ${agentUsage.callCount === 1 ? "call" : "calls"} · ${agentUsage.durationMinutes.toFixed(1)} minutes`
            );
            setBasePrice(agentUsage.amountCents / 100);
            setIncludedItems(
                agentUsage.serviceCosts
                    .filter((service) => service.billedCostUsd > 0)
                    .map((service) => `${service.serviceName} — $${service.billedCostUsd.toFixed(2)}`)
            );
            setCheckoutError("");
            setUsageSummaryReady(true);
            setUsageSummaryLoading(false);
        }

        void loadUsageSummary();

        return () => {
            mounted = false;
        };
    }, [authReady, usageAgentId, usageMode]);

    useEffect(() => {
        if (!authReady || !listingId) return;

        let mounted = true;

        async function loadListing() {
            const response = await apiGet<CheckoutListingResponse>(
                `/architect/listings/public/${listingId}`
            );

            if (!mounted) return;

            const listing = response.data?.listing;

            if (response.success && listing) {
                setListingName(listing.name);
                setListingAuthor(
                    listing.architect?.fullName ||
                    listing.architect?.architectProfile?.title ||
                    listing.architect?.email ||
                    ""
                );
                setBasePrice((listing.priceCents ?? 0) / 100);

                const items = getIncludedItems(listing);
                if (items.length) setIncludedItems(items);
            }
        }

        loadListing();

        return () => {
            mounted = false;
        };
    }, [authReady, listingId]);

    useEffect(() => {
        if (!authReady || !listingId) return;

        let mounted = true;

        async function loadListingAccess() {
            try {
                const response = await apiGet<ListingAccess>(`/payments/listing-access/${listingId}`);

                if (!mounted) return;

                if (response.success && response.data) {
                    setListingAccess(response.data);
                    setBasePrice(response.data.amountCents / 100);
                    setPostpaidRate(response.data.usagePricing?.perMinuteUsd ?? null);
                }
            } catch {
                if (mounted) setListingAccess(null);
            }
        }

        loadListingAccess();

        return () => {
            mounted = false;
        };
    }, [authReady, listingId]);

    useEffect(() => {
        if (!authReady) return;

        let mounted = true;

        async function loadCountries() {
            const response = await apiGet<CountriesResponse>("/countries");

            if (!mounted) return;

            const loadedCountries = response.success && response.data?.countries?.length
                ? response.data.countries
                : FALLBACK_COUNTRIES;

            setCountries(loadedCountries);
            setCountryCode((current) => {
                if (loadedCountries.some((country) => country.countryCode === current)) {
                    return current;
                }

                return (
                    loadedCountries.find((country) => country.countryCode === "US")?.countryCode ??
                    loadedCountries[0]?.countryCode ??
                    "US"
                );
            });
        }

        loadCountries();

        return () => {
            mounted = false;
        };
    }, [authReady]);

    function fieldState(isValid: boolean, shouldShowError: boolean) {
        if (isValid) return "is-valid";
        if (shouldShowError) return "is-error";
        return "";
    }

    function showError(key: keyof typeof touched) {
        return attemptedSubmit || touched[key];
    }

    function handleCardInput(value: string) {
        const formatted = formatCardNumber(value);
        const nextBrand = detectBrand(formatted.replace(/\D/g, ""));
        const nextCvc = cvc.replace(/\D/g, "").slice(0, nextBrand === "amex" ? 4 : 3);

        setCardNumber(formatted);
        setCvc(nextCvc);
    }

    function buildConfetti() {
        const colors = ["#f59e0b", "#fbbf24", "#f97316", "#fcd34d", "#fde68a", "#d97706"];

        const pieces = Array.from({ length: 50 }).map((_, index) => {
            const size = 6 + Math.random() * 8;

            return {
                id: index,
                left: `${Math.random() * 100}vw`,
                width: `${size}px`,
                height: `${size * 0.6}px`,
                background: colors[index % colors.length],
                delay: `${Math.random() * 0.6}s`,
                duration: `${2.4 + Math.random() * 1.3}s`
            };
        });

        setConfetti(pieces);

        window.setTimeout(() => {
            setConfetti([]);
        }, 4200);
    }

    // Best-effort payment-failed notification. Never blocks or throws into the
    // checkout flow — the redirect happens regardless of the mail result.
    async function notifyPaymentFailed(reason?: string) {
        try {
            await apiPost("/mail/send-payment-failed", {
                to: email,
                agentName: listingName,
                cardLast4: cardDigits.slice(-4),
                failureReason: reason ?? "Payment was declined",
                listingId: listingId ?? undefined
            });
        } catch {
            // ignore — the failure page is still shown to the user
        }
    }

    async function handleCheckout() {
        setAttemptedSubmit(true);
        setTrialError("");

        if (!formReady || processing) return;

        setProcessing(true);

        if (usageMode) {
            router.push(
                usageAgentId
                    ? `/business/billingandusage/billing?agentId=${encodeURIComponent(usageAgentId)}`
                    : "/business/billingandusage/billing"
            );
            return;
        }

        if (!listingId) {
            router.push(
                businessPaymentSuccessPath({
                    agent: listingName,
                    amount: isPurchaseMode ? payTotal : basePrice,
                    email,
                    mode: isPurchaseMode ? "purchase" : "trial"
                })
            );
            return;
        }

        if (checkoutBlocked) {
            router.push(businessSetupPath(listingId));
            return;
        }

        const endpoint = isPurchaseMode ? "/payments/purchase" : "/payments/start-trial";

        try {
            const response = await apiPost<StartTrialResponse | PurchaseResponse>(endpoint, {
                listingId,
                paymentMethodId: isFree ? "free_installation" : testPaymentMethodForBrand(brand),
                billingName: isFree ? "Free Install" : cardName.trim(),
                billingEmail: email.trim(),
                billingAddress: isFree ? "Free Installation" : formatBillingAddress(
                    addressLine,
                    zip,
                    selectedCountry?.name ?? countryCode
                )
            });

            if (!response.success) {
                const reason = response.error ?? (isPurchaseMode
                    ? "We couldn't complete your purchase. Please try again."
                    : "We couldn't start your trial. Please try again.");
                await notifyPaymentFailed(reason);
                router.push(
                    businessPaymentFailedPath({
                        listingId,
                        agent: listingName,
                        amount: isPurchaseMode ? payTotal : basePrice,
                        mode: isPurchaseMode ? "purchase" : "trial"
                    })
                );
                return;
            }

            router.push(
                businessPaymentSuccessPath({
                    listingId,
                    agent: listingName,
                    amount: isPurchaseMode ? payTotal : basePrice,
                    email,
                    mode: isPurchaseMode ? "purchase" : "trial"
                })
            );
        } catch {
            await notifyPaymentFailed("We couldn't reach the payment service. Please try again.");
            router.push(
                businessPaymentFailedPath({
                    listingId,
                    agent: listingName,
                    amount: isPurchaseMode ? payTotal : basePrice,
                    mode: isPurchaseMode ? "purchase" : "trial"
                })
            );
        }
    }

    if (!authReady) {
        return <main className="min-h-screen bg-gray-50" />;
    }

    return (
        <div className="checkout-root min-h-screen bg-gray-50 text-slate-900">
            <style dangerouslySetInnerHTML={{ __html: CHECKOUT_STYLES }} />

            <CheckoutHeader confirmation={confirmation} />

            {!confirmation ? (
                <>
                    <main className="mx-auto max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-12 lg:pb-12">
                        <div className="grid grid-cols-1 gap-8 lg:grid-cols-5 lg:gap-12">
                            <div className="order-2 space-y-6 lg:order-1 lg:col-span-3">
                                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
                                    <h2 className="text-xl font-bold tracking-tight" data-testid="business-protected-checkout-your-account-heading">Your account</h2>

                                    <div className="mt-5">
                                        <div className="flex items-center gap-3 rounded-xl border border-green-100 bg-green-50 p-4 text-green-700">
                                            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-green-100 text-green-600">
                                                <CheckIcon />
                                            </span>

                                            <div className="min-w-0">
                                                <p className="text-sm font-semibold text-green-800" data-testid="business-protected-checkout-signed-in-text">Signed in</p>
                                                <p className="truncate text-sm text-green-700" data-testid="business-protected-checkout-email-text">{email}</p>
                                            </div>
                                        </div>
                                    </div>
                                </section>

                                <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm sm:p-8">
                                    <h2 className="text-xl font-bold tracking-tight" data-testid="business-protected-checkout-payment-method-heading">Payment method</h2>
                                    <p className="mb-6 mt-1 text-sm text-slate-500" data-testid="business-protected-checkout-you-won-apos-t-be-charged-until-text">
                                        {isFree
                                            ? "This agent is free. No charge will be applied."
                                            : isPurchaseMode
                                                ? "Your card will be charged today for this agent."
                                                : `You won&apos;t be charged until your ${trialDays}-day trial ends.`}
                                    </p>

                                    {!isFree ? (
                                    <div className="flex overflow-x-auto" role="tablist" aria-label="Payment options">
                                        <PaymentTabButton active={paymentTab === "credit"} onClick={() => setPaymentTab("credit")} testId="checkout-payment-tab-credit">
                                            <CardIcon />
                                            Credit card
                                        </PaymentTabButton>
                                    </div>
                                    ) : null}

                                    {isFree ? (
                                        <div className="-mt-px rounded-b-xl rounded-tr-xl border border-amber-200 bg-gradient-to-br from-amber-50/60 to-orange-50/60 p-6 sm:p-8 text-center shadow-sm">
                                            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-600 mb-4 ring-8 ring-amber-50">
                                                <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                            </div>
                                            <h3 className="text-lg font-bold text-slate-900">Free Installation</h3>
                                            <p className="mt-2 text-sm text-slate-600 max-w-sm mx-auto">
                                                This agent is free to install. No payment method or credit card details are required.
                                            </p>
                                        </div>
                                    ) : paymentTab === "credit" ? (
                                        <div className="-mt-px rounded-b-xl rounded-tr-xl border border-gray-200 p-5 sm:p-6">
                                            <div>
                                                <label className="mb-1.5 block text-sm font-medium text-slate-700" data-testid="business-protected-checkout-card-number-label">
                                                    Card number
                                                </label>

                                                <div className="field-wrap">
                                                    <input data-testid="checkout-card-number-input"
                                                        type="text"
                                                        inputMode="numeric"
                                                        autoComplete="cc-number"
                                                        value={cardNumber}
                                                        onChange={(event) => handleCardInput(event.target.value)}
                                                        onBlur={() => setTouched((current) => ({ ...current, card: true }))}
                                                        className={`field with-brands tnum ${fieldState(validations.card, showError("card"))}`}
                                                        placeholder="1234 5678 9012 3456"
                                                    />

                                                    <div className="brands" aria-hidden="true">
                                                        <VisaBrand active={brand === "visa"} hasBrand={!!brand} />
                                                        <MastercardBrand active={brand === "mastercard"} hasBrand={!!brand} />
                                                        <AmexBrand active={brand === "amex"} hasBrand={!!brand} />
                                                    </div>
                                                </div>

                                                {!validations.card && showError("card") ? (
                                                    <p className="error-msg" data-testid="business-protected-checkout-enter-a-valid-card-number-text">Enter a valid card number</p>
                                                ) : null}
                                            </div>

                                            <div className="mt-4 grid grid-cols-2 gap-4">
                                                <div>
                                                    <label className="mb-1.5 block text-sm font-medium text-slate-700" data-testid="business-protected-checkout-expiry-date-label">
                                                        Expiry date
                                                    </label>

                                                    <div className="field-wrap">
                                                        <input data-testid="checkout-card-expiry-input"
                                                            type="text"
                                                            inputMode="numeric"
                                                            autoComplete="cc-exp"
                                                            value={expiry}
                                                            onChange={(event) => setExpiry(formatExpiry(event.target.value))}
                                                            onBlur={() => setTouched((current) => ({ ...current, expiry: true }))}
                                                            className={`field with-adorn tnum ${fieldState(validations.expiry, showError("expiry"))}`}
                                                            placeholder="MM / YY"
                                                        />

                                                        {validations.expiry ? (
                                                            <span className="adorn text-green-600" aria-hidden="true">
                                                                <CheckIcon />
                                                            </span>
                                                        ) : null}
                                                    </div>

                                                    {!validations.expiry && showError("expiry") ? (
                                                        <p className="error-msg" data-testid="business-protected-checkout-enter-a-valid-expiry-text">Enter a valid expiry</p>
                                                    ) : null}
                                                </div>

                                                <div>
                                                    <label className="mb-1.5 block text-sm font-medium text-slate-700" data-testid="business-protected-checkout-security-code-label">
                                                        Security code
                                                    </label>

                                                    <div className="field-wrap">
                                                        <input data-testid="checkout-card-cvc-input"
                                                            type="text"
                                                            inputMode="numeric"
                                                            autoComplete="cc-csc"
                                                            value={cvc}
                                                            onChange={(event) =>
                                                                setCvc(event.target.value.replace(/\D/g, "").slice(0, requiredCvcLength))
                                                            }
                                                            onBlur={() => setTouched((current) => ({ ...current, cvc: true }))}
                                                            className={`field with-adorn tnum ${fieldState(validations.cvc, showError("cvc"))}`}
                                                            placeholder="CVC"
                                                        />

                                                        <span className="adorn text-slate-400" aria-hidden="true">
                                                            {validations.cvc ? <CheckIcon /> : <LockIcon />}
                                                        </span>
                                                    </div>

                                                    {!validations.cvc && showError("cvc") ? (
                                                        <p className="error-msg" data-testid="business-protected-checkout-enter-the-required-cvc-digit-code-text">Enter the {requiredCvcLength}-digit code</p>
                                                    ) : null}
                                                </div>
                                            </div>

                                            <div className="mt-4">
                                                <label className="mb-1.5 block text-sm font-medium text-slate-700" data-testid="business-protected-checkout-on-card-label">
                                                    Name on card
                                                </label>

                                                <div className="field-wrap">
                                                    <input data-testid="checkout-cardholder-name-input"
                                                        type="text"
                                                        autoComplete="cc-name"
                                                        value={cardName}
                                                        onChange={(event) => setCardName(event.target.value)}
                                                        onBlur={() => setTouched((current) => ({ ...current, name: true }))}
                                                        className={`field with-adorn ${fieldState(validations.name, showError("name"))}`}
                                                        placeholder="Dr. Sarah Mitchell"
                                                    />

                                                    {validations.name ? (
                                                        <span className="adorn text-green-600" aria-hidden="true">
                                                            <CheckIcon />
                                                        </span>
                                                    ) : null}
                                                </div>

                                                {!validations.name && showError("name") ? (
                                                    <p className="error-msg" data-testid="business-protected-checkout-enter-the-on-your-card-text">Enter the name on your card</p>
                                                ) : null}
                                            </div>

                                            <div className="mt-6">
                                                <h3 className="mb-2.5 text-sm font-medium text-slate-700" data-testid="business-protected-checkout-billing-address-heading">
                                                    Billing address
                                                </h3>

                                                <CountrySelect
                                                    countries={countries}
                                                    value={countryCode}
                                                    onChange={setCountryCode}
                                                />

                                                <div className="field-wrap mt-3">
                                                    <input data-testid="checkout-address-line-input"
                                                        type="text"
                                                        autoComplete="street-address"
                                                        value={addressLine}
                                                        onChange={(event) => setAddressLine(event.target.value)}
                                                        onBlur={() => setTouched((current) => ({ ...current, address: true }))}
                                                        className={`field with-adorn ${fieldState(validations.address, showError("address"))}`}
                                                        placeholder="Address line"
                                                    />

                                                    {validations.address ? (
                                                        <span className="adorn text-green-600" aria-hidden="true">
                                                            <CheckIcon />
                                                        </span>
                                                    ) : null}
                                                </div>

                                                {!validations.address && showError("address") ? (
                                                    <p className="error-msg" data-testid="business-protected-checkout-enter-a-valid-address-text">Enter your billing address</p>
                                                ) : null}

                                                <div className="field-wrap mt-3">
                                                    <input data-testid="checkout-zip-code-input"
                                                        type="text"
                                                        inputMode="numeric"
                                                        autoComplete="postal-code"
                                                        value={zip}
                                                        onChange={(event) => setZip(event.target.value)}
                                                        onBlur={() => setTouched((current) => ({ ...current, zip: true }))}
                                                        className={`field with-adorn ${fieldState(validations.zip, showError("zip"))}`}
                                                        placeholder={countryCode === "US" ? "ZIP code" : "Postal code"}
                                                    />

                                                    {validations.zip ? (
                                                        <span className="adorn text-green-600" aria-hidden="true">
                                                            <CheckIcon />
                                                        </span>
                                                    ) : null}
                                                </div>

                                                {!validations.zip && showError("zip") ? (
                                                    <p className="error-msg" data-testid="business-protected-checkout-enter-a-valid-zip-postal-code-text">Enter a valid ZIP / postal code</p>
                                                ) : null}
                                            </div>

                                            <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 pt-6">
                                                <TrustInline text="256-bit SSL encryption" />
                                                <TrustInline text="PCI DSS compliant" />
                                                <TrustInline text="30-day money back" />
                                            </div>
                                        </div>
                                    ) : (
                                        <WalletPanel tab={paymentTab} />
                                    )}
                                </section>

                                <section>
                                    {checkoutError ? (
                                        <p
                                            data-testid="checkout-error"
                                            className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700"
                                        >
                                            {checkoutError}
                                        </p>
                                    ) : null}
                                    {checkoutBlocked ? (
                                        <p
                                            data-testid="checkout-already-active"
                                            className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700"
                                        >
                                            You already have access to this agent.{" "}
                                            <Link
                                                href={businessSetupPath(listingId ?? undefined)}
                                                className="underline hover:text-green-800"
                                            >
                                                Continue setup
                                            </Link>
                                        </p>
                                    ) : null}
                                    <button
                                        type="button"
                                        onClick={handleCheckout}
                                        data-testid={isPurchaseMode ? "checkout-pay-now" : "checkout-start-trial"}
                                        className="cta hidden lg:inline-flex"
                                        disabled={!formReady || processing || checkoutBlocked}
                                        aria-disabled={!formReady || processing || checkoutBlocked}
                                    >
                                        {processing ? (
                                            <>
                                                <span className="spinner" />
                                                Processing…
                                            </>
                                        ) : (
                                            <>
                                                {checkoutButtonLabel}
                                                <ArrowIcon />
                                            </>
                                        )}
                                    </button>

                                    {trialError ? (
                                        <p className="mt-3 text-center text-sm font-medium text-red-500">
                                            {trialError}
                                        </p>
                                    ) : null}

                                    {!isPurchaseMode ? (
                                    <p className="mt-3 text-center text-xs text-slate-400">
                                        You&apos;ll be charged{" "}
                                        <span className="font-medium text-slate-500" data-testid="business-protected-checkout-future-amount-text">${futureAmount}</span> on{" "}
                                        <span className="font-medium text-slate-500" data-testid="business-protected-checkout-trial-date-text">{trialDate}</span> unless you cancel.
                                    </p>
                                    ) : (
                                    <p className="mt-3 text-center text-xs text-slate-400">
                                        {isFree
                                            ? "This agent is free. No charge today."
                                            : `You'll be charged $${dueTodayAmount.toFixed(2)} today.`}
                                    </p>
                                    )}

                                    <p className="mt-1.5 text-center text-xs text-slate-400" data-testid="business-protected-checkout-by-proceeding-you-agree-to-our-terms-text">
                                        By proceeding, you agree to our{" "}
                                        <a data-testid="checkout-terms-of-service-link" href={TERM_PATH} className="font-medium text-amber-600 hover:text-amber-700">
                                            Terms of Service
                                        </a>{" "}
                                        and{" "}
                                        <a data-testid="checkout-privacy-policy-link" href={PRIVACY_PATH} className="font-medium text-amber-600 hover:text-amber-700">
                                            Privacy Policy
                                        </a>
                                        .
                                    </p>
                                </section>
                            </div>

                            <aside className="order-1 lg:order-2 lg:col-span-2">
                                {usageSummaryLoading ? (
                                    <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" aria-live="polite">
                                        <div className="h-6 w-36 animate-pulse rounded bg-slate-200" />
                                        <div className="mt-6 h-16 animate-pulse rounded-xl bg-slate-100" />
                                        <div className="mt-4 h-32 animate-pulse rounded-xl bg-slate-100" />
                                        <p className="mt-4 text-sm text-slate-500">Loading your current usage…</p>
                                    </div>
                                ) : usageMode && !usageSummaryReady ? null : (
                                    <OrderSummary
                                        trialDate={trialDate}
                                        includedItems={includedItems}
                                        futureAmount={futureAmount}
                                        agentName={listingName}
                                        agentAuthor={listingAuthor}
                                        price={basePrice}
                                        isPurchaseMode={isPurchaseMode}
                                        dueTodayAmount={dueTodayAmount}
                                        postpaidRate={postpaidRate}
                                        isUsageMode={usageMode}
                                        phoneFeeLabel={phoneFee?.label ?? null}
                                        phoneFeeAmount={phoneFeeAmount}
                                        pricingModel={listingAccess?.pricingModel}
                                        freeTrialEnabled={listingAccess?.freeTrialEnabled}
                                        trialDays={listingAccess?.trialDays}
                                    />
                                )}
                            </aside>
                        </div>
                    </main>

                    <div
                        className="fixed bottom-0 left-0 right-0 z-40 flex items-center gap-3 border-t border-gray-100 bg-white px-4 py-3 lg:hidden"
                        style={{ boxShadow: "0 -10px 28px -14px rgba(0,0,0,.18)" }}
                    >
                        <div className="shrink-0 leading-tight">
                            <p className="text-[0.7rem] text-slate-400" data-testid="business-protected-checkout-due-today-text">Due today</p>
                            <p className="tnum text-lg font-bold text-slate-900" data-testid="business-protected-checkout-0-00-text">${dueTodayAmount.toFixed(2)}</p>
                        </div>

                        <button
                            type="button"
                            onClick={handleCheckout}
                            data-testid={isPurchaseMode ? "checkout-pay-now-mobile" : "checkout-start-trial-mobile"}
                            className="cta flex-1"
                            style={{ paddingTop: ".85rem", paddingBottom: ".85rem", fontSize: "1rem" }}
                            disabled={!formReady || processing || checkoutBlocked}
                            aria-disabled={!formReady || processing || checkoutBlocked}
                        >
                            {processing ? (
                                <>
                                    <span className="spinner" />
                                    Processing…
                                </>
                            ) : (
                                <>
                                    {mobileCheckoutButtonLabel}
                                    <ArrowIcon />
                                </>
                            )}
                        </button>
                    </div>
                </>
            ) : (
                <ConfirmationView
                    email={email}
                    agentName={listingName}
                    onSetup={() => router.push(businessSetupPath(listingId ?? undefined))}
                    onDashboard={() => router.push(BUSINESS_MARKETPLACE_PATH)}
                    pricingModel={listingAccess?.pricingModel}
                    trialDays={listingAccess?.trialDays}
                />
            )}

            <div className="confetti-host" aria-hidden="true">
                {confetti.map((piece) => (
                    <span
                        key={piece.id}
                        className="confetti-piece"
                        style={{
                            left: piece.left,
                            width: piece.width,
                            height: piece.height,
                            background: piece.background,
                            animationDelay: piece.delay,
                            animationDuration: piece.duration
                        }} />
                ))}
            </div>
        </div>
    );
}

function CountrySelect({
    countries,
    value,
    onChange
}: {
    countries: CheckoutCountry[];
    value: string;
    onChange: (countryCode: string) => void;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const selected =
        countries.find((country) => country.countryCode === value) ?? countries[0];

    useEffect(() => {
        if (!open) return;

        function handlePointerDown(event: MouseEvent) {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        }

        function handleEscape(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setOpen(false);
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
        <div ref={rootRef} className="country-select">
            <button
                type="button"
                data-testid="checkout-country-select"
                className="field country-select-trigger"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label="Country"
                onClick={() => setOpen((current) => !current)}
            >
                {selected
                    ? `${selected.flag} ${selected.name} (${selected.countryCode})`
                    : "Select country"}
            </button>

            {open ? (
                <ul className="country-select-menu" role="listbox" aria-label="Countries">
                    {countries.map((country) => (
                        <li key={country.id} role="presentation">
                            <button
                                type="button"
                                role="option"
                                aria-selected={country.countryCode === value}
                                data-testid={`checkout-country-option-${country.countryCode.toLowerCase()}`}
                                className={`country-select-option${
                                    country.countryCode === value ? " is-selected" : ""
                                }`}
                                onClick={() => {
                                    onChange(country.countryCode);
                                    setOpen(false);
                                }}
                            >
                                {country.flag} {country.name} ({country.countryCode})
                            </button>
                        </li>
                    ))}
                </ul>
            ) : null}
        </div>
    );
}

function CheckoutHeader({ confirmation }: { confirmation: boolean }) {
    return (
        <header className="sticky top-0 z-30 border-b border-gray-100 bg-white px-5 py-4 sm:px-8">
            <div className="mx-auto flex max-w-6xl items-center justify-center gap-2">
                <div className="flex flex-col items-center">
                    <nav className="flex items-center justify-center" aria-label="Checkout progress">
                        <StepCircle status="done">
                            <CheckIcon className="h-3.5 w-3.5" />
                        </StepCircle>

                        <span className="ml-2 hidden text-sm font-semibold text-amber-600 sm:inline" data-testid="business-protected-checkout-account-text">
                            Account
                        </span>

                        <span className="step-line done" />

                        <StepCircle status={confirmation ? "done" : "active"}>
                            {confirmation ? <CheckIcon className="h-3.5 w-3.5" /> : "2"}
                        </StepCircle>

                        <span
                            className={`ml-2 hidden text-sm sm:inline ${confirmation ? "font-semibold text-amber-600" : "font-bold text-amber-600"
                                }`}
                         data-testid="business-protected-checkout-payment-text">
                            Payment
                        </span>

                        <span className={`step-line ${confirmation ? "done" : ""}`} />

                        <StepCircle status={confirmation ? "active" : "todo"}>3</StepCircle>

                        <span
                            className={`ml-2 hidden text-sm font-semibold sm:inline ${confirmation ? "text-amber-600" : "text-slate-400"
                                }`}
                         data-testid="business-protected-checkout-confirmation-text">
                            Confirmation
                        </span>
                    </nav>

                    <div className="mt-1.5 flex items-center gap-1.5 text-slate-400">
                        <LockIcon className="h-3 w-3" />
                        <span className="text-[0.7rem] font-medium" data-testid="business-protected-checkout-secure-checkout-text">Secure Checkout</span>
                    </div>
                </div>
            </div>
        </header>
    );
}

function StepCircle({
    status,
    children
}: {
    status: "todo" | "active" | "done";
    children: ReactNode;
}) {
    return <span data-testid={`checkout-step-circle-${status}`} className={`step-circle ${status}`}>{children}</span>;
}

function PaymentTabButton({
    active,
    onClick,
    children,
    testId
}: {
    active: boolean;
    onClick: () => void;
    children: ReactNode;
    testId?: string;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            data-testid={testId}
            className={`pay-tab ${active ? "active" : ""}`}
            role="tab"
            aria-selected={active}
        >
            {children}
        </button>
    );
}

function WalletPanel({ tab }: { tab: Exclude<PaymentTab, "credit"> }) {
    const name = tab === "google" ? "Google Pay" : "Apple Pay";

    return (
        <div className="-mt-px rounded-b-xl rounded-tr-xl border border-gray-200 p-8 text-center">
            <div className="mb-4 flex justify-center">
                {tab === "google" ? (
                    <span className="text-2xl font-black text-slate-700" data-testid="business-protected-checkout-g-text">
                        <span className="text-blue-500" data-testid="business-protected-checkout-g-text-2">G</span>
                        <span className="text-red-500" data-testid="business-protected-checkout-o-text">o</span>
                        <span className="text-yellow-500" data-testid="business-protected-checkout-o-text-2">o</span>
                        <span className="text-blue-500" data-testid="business-protected-checkout-g-text-3">g</span>
                        <span className="text-green-500" data-testid="business-protected-checkout-l-text">l</span>
                        <span className="text-red-500" data-testid="business-protected-checkout-e-text">e</span>
                    </span>
                ) : (
                    <span className="text-4xl"></span>
                )}
            </div>

            <p className="text-base font-semibold text-slate-900" data-testid="business-protected-checkout-pay-with-text">Pay with {name}</p>

            <p className="mx-auto mt-1.5 max-w-sm text-sm text-slate-500" data-testid="business-protected-checkout-no-card-details-needed-you-apos-ll-text">
                No card details needed. You&apos;ll confirm payment securely after starting your trial.
            </p>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 border-t border-gray-100 pt-6">
                <TrustInline text="Encrypted & secure" />
                <TrustInline text="PCI DSS compliant" />
            </div>
        </div>
    );
}

function OrderSummary({
    trialDate,
    includedItems,
    futureAmount,
    agentName,
    agentAuthor,
    price,
    isPurchaseMode = false,
    dueTodayAmount = 0,
    postpaidRate = null,
    isUsageMode = false,
    phoneFeeLabel = null,
    phoneFeeAmount = 0,
    pricingModel = "subscription",
    freeTrialEnabled = true,
    trialDays = 7
}: {
    trialDate: string;
    includedItems: string[];
    futureAmount: number;
    agentName: string;
    agentAuthor: string;
    price: number;
    isPurchaseMode?: boolean;
    dueTodayAmount?: number;
    postpaidRate?: number | null;
    isUsageMode?: boolean;
    phoneFeeLabel?: string | null;
    phoneFeeAmount?: number;
    pricingModel?: string | null;
    freeTrialEnabled?: boolean | null;
    trialDays?: number | null;
}) {
    const priceLabel = price.toFixed(2);
    const dueTodayLabel = dueTodayAmount.toFixed(2);
    // Trial discounts everything charged later (agent price + number fee).
    const trialDiscountLabel = (price + phoneFeeAmount).toFixed(2);

    return (
        <div className="lg:sticky lg:top-28">
            <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
                <div className="border-b border-amber-100 bg-gradient-to-br from-amber-50 to-orange-50 px-6 py-5">
                    <h2 className="text-lg font-bold text-slate-900" data-testid="business-protected-checkout-order-summary-heading">Order summary</h2>
                </div>

                <div className="flex gap-4 border-b border-gray-50 px-6 py-5">
                    <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-600">
                        <ChatIcon className="h-7 w-7" />
                    </span>

                    <div className="min-w-0">
                        <p className="font-bold leading-tight text-slate-900">{agentName}</p>
                        {agentAuthor ? (
                            <p className="mt-0.5 text-sm text-slate-500">
                                {isUsageMode ? agentAuthor : `by ${agentAuthor}`}
                            </p>
                        ) : null}
                    </div>
                </div>

                {includedItems.length ? (
                <div className="border-b border-gray-50 px-6 py-5">
                    <p className="mb-3 text-sm font-semibold text-slate-700" data-testid="business-protected-checkout-what-apos-s-included-text">
                        {isUsageMode ? "Billed services" : "What's included"}
                    </p>

                    <ul className="space-y-2.5">
                        {includedItems.map((item) => (
                            <li key={item} data-testid={`checkout-included-item-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex items-start gap-2.5 text-sm text-slate-600">
                                <span data-testid={`checkout-included-check-${item.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-green-100 text-green-600">
                                    <CheckIcon className="h-3.5 w-3.5" />
                                </span>
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
                ) : null}

                <div className="px-6 py-5">
                    <div className="space-y-3">
                        <PriceRow label={isUsageMode ? "Usage amount" : "Agent price"} value={pricingModel === "FREE" ? "Free" : `$${priceLabel}`} />
                        {phoneFeeAmount > 0 ? (
                            <PriceRow
                                label={phoneFeeLabel ?? "AI Receptionist No."}
                                value={`$${phoneFeeAmount.toFixed(2)}`}
                            />
                        ) : null}
                        {isPurchaseMode || pricingModel === "FREE" ? null : (
                            <PriceRow label={`${trialDays}-day free trial`} value={`−$${trialDiscountLabel}`} green />
                        )}
                        {!isUsageMode ? (
                            <PriceRow
                                label="Post-paid execution fees"
                                value={postpaidRate === null ? "Pay as you go" : `$${postpaidRate.toFixed(4)}/minute`}
                                muted
                            />
                        ) : null}
                    </div>

                    <div className="my-4 border-t border-gray-100" />

                    <div className="flex items-baseline justify-between">
                        <div>
                            <span className="text-lg font-bold text-slate-900" data-testid="business-protected-checkout-due-today-text-2">Due today</span>
                            {!isPurchaseMode && pricingModel !== "FREE" ? (
                                <span className="block text-xs font-normal text-slate-400" data-testid="business-protected-checkout-free-for-7-days-text">Free for {trialDays} days</span>
                            ) : null}
                        </div>

                        <span className="tnum text-lg font-bold text-slate-900" data-testid="business-protected-checkout-0-00-text-2">${dueTodayLabel}</span>
                    </div>

                    {isPurchaseMode ? (
                        <div className="mt-2 flex justify-between text-sm">
                            <span className="text-slate-500">Charged today</span>
                            <span className="tnum font-medium text-slate-500">${dueTodayLabel}</span>
                        </div>
                    ) : (
                    <div className="mt-2 flex justify-between text-sm">
                        <span className="text-slate-500">Due {trialDate}</span>
                        <span className="tnum font-medium text-slate-500">${futureAmount.toFixed(2)}</span>
                    </div>
                    )}
                    <p className="mt-3 text-xs leading-5 text-slate-400">
                        Usage starts on the purchase date, is invoiced on the 1st, and is due by the 7th.
                    </p>
                </div>

                {isPurchaseMode || pricingModel === "FREE" ? null : (
                <div className="mx-6 mb-5 rounded-xl border border-amber-100 bg-amber-50 p-4">
                    <p className="flex items-center gap-2 text-sm font-semibold text-amber-800" data-testid="business-protected-checkout-your-7-day-trial-includes-text">
                        ⏱ Your {trialDays}-day trial includes:
                    </p>

                    <ul className="mt-2 space-y-1 text-xs text-amber-700">
                        <li data-testid="business-protected-checkout-full-agent-functionality-item">• Full agent functionality</li>
                        <li data-testid="business-protected-checkout-up-to-50-free-executions-item">• Up to 50 free executions</li>
                        <li data-testid="business-protected-checkout-cancel-anytime-no-charge-item">• Cancel anytime — no charge</li>
                    </ul>
                </div>
                )}

                <div className="mx-6 mb-6 flex items-start gap-3 rounded-xl border border-green-100 bg-green-50 p-4">
                    <span className="mt-0.5 shrink-0 text-green-600">
                        <ShieldIcon />
                    </span>

                    <div>
                        <p className="text-sm font-semibold text-green-800" data-testid="business-protected-checkout-30-day-money-back-guarantee-text">30-day money-back guarantee</p>
                        <p className="mt-0.5 text-xs text-green-600" data-testid="business-protected-checkout-not-satisfied-full-refund-no-questions-text">Not satisfied? Full refund, no questions.</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

function ConfirmationView({
    email,
    agentName,
    onSetup,
    onDashboard,
    pricingModel = "subscription",
    trialDays = 7
}: {
    email: string;
    agentName: string;
    onSetup: () => void;
    onDashboard: () => void;
    pricingModel?: string | null;
    trialDays?: number | null;
}) {
    return (
        <main className="fade-up mx-auto max-w-2xl px-5 py-14 text-center sm:py-16">
            <div className="scale-in mx-auto grid h-20 w-20 place-items-center rounded-full bg-amber-50">
                <CheckIcon className="h-10 w-10 text-green-600" />
            </div>

            <h1 className="mt-6 text-3xl font-black tracking-tight text-slate-900" data-testid="business-protected-checkout-you-apos-re-all-set-heading">
                You&apos;re all set! 🎉
            </h1>

            <p className="mt-2 text-lg text-slate-600">{agentName} is now active.</p>

            {pricingModel === "FREE" ? (
                <p className="mt-4 text-sm text-slate-500">
                    Your free agent is installed. We&apos;ll send setup instructions to{" "}
                    <span className="font-medium text-slate-600" data-testid="business-protected-checkout-email-text-2">{email}</span>.
                </p>
            ) : pricingModel === "ONE_TIME" ? (
                <p className="mt-4 text-sm text-slate-500">
                    Your one-time purchase is complete. We&apos;ll send setup instructions to{" "}
                    <span className="font-medium text-slate-600" data-testid="business-protected-checkout-email-text-2">{email}</span>.
                </p>
            ) : (
                <p className="mt-4 text-sm text-slate-500" data-testid="business-protected-checkout-your-7-day-free-trial-has-started-text">
                    Your {trialDays}-day free trial has started. We&apos;ll send setup instructions to{" "}
                    <span className="font-medium text-slate-600" data-testid="business-protected-checkout-email-text-2">{email}</span>.
                </p>
            )}

            <div className="mt-8 rounded-2xl bg-gray-50 p-6 text-left sm:p-8">
                <p className="mb-4 font-bold text-slate-900" data-testid="business-protected-checkout-next-steps-text">Next steps</p>

                <ol className="space-y-3.5">
                    {nextSteps.map((step, index) => (
                        <li key={step} className="flex items-center gap-3" data-testid="business-protected-checkout-1-step-item">
                            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-amber-100 text-sm font-bold text-amber-700" data-testid="business-protected-checkout-1-text">
                                {index + 1}
                            </span>
                            <span className="text-slate-700" data-testid="business-protected-checkout-step-text">{step}</span>
                        </li>
                    ))}
                </ol>

                <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400" data-testid="business-protected-checkout-takes-about-2-minutes-text">
                    ⏱ Takes about 2 minutes
                </p>
            </div>

            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row sm:gap-4">
                <button
                    type="button"
                    onClick={onSetup}
                    data-testid="checkout-setup-agent"
                    className="cta px-8 py-3.5 sm:w-auto"
                    style={{ boxShadow: "0 10px 24px -8px rgba(245,158,11,.55)" }}
                >
                    Set up my agent
                    <ArrowIcon />
                </button>

                <button
                    type="button"
                    onClick={onDashboard}
                    data-testid="checkout-go-dashboard"
                    className="rounded-xl border border-gray-200 px-8 py-3.5 font-semibold text-slate-600 transition-colors hover:border-amber-300 hover:text-amber-600"
                >
                    Go to dashboard
                </button>
            </div>
        </main>
    );
}

function PriceRow({
    label,
    value,
    green,
    muted
}: {
    label: string;
    value: string;
    green?: boolean;
    muted?: boolean;
}) {
    return (
        <div className="flex justify-between text-sm">
            <span className={green ? "text-green-600" : "text-slate-600"} data-testid="business-protected-checkout-label-text">{label}</span>
            <span
                data-testid={`checkout-summary-value-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className={`tnum font-medium ${green ? "text-green-600" : muted ? "text-slate-400" : "text-slate-900"
                    }`}
            >
                {value}
            </span>
        </div>
    );
}

function TrustInline({ text }: { text: string }) {
    return (
        <span data-testid={`checkout-trust-inline-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="flex items-center gap-1.5 text-slate-400">
            <LockIcon className="h-3.5 w-3.5" />
            <span data-testid={`checkout-trust-text-${text.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`} className="text-xs font-medium">{text}</span>
        </span>
    );
}

function VisaBrand({ active, hasBrand }: { active: boolean; hasBrand: boolean }) {
    return (
        <span className={`brand ${hasBrand ? (active ? "brand-on" : "brand-off") : ""}`} data-testid="business-protected-checkout-visa-text">
            <svg width="34" height="22" viewBox="0 0 34 22">
                <rect width="34" height="22" rx="4" fill="#fff" stroke="#e5e7eb" />
                <text
                    x="17"
                    y="15.5"
                    textAnchor="middle"
                    fontFamily="Inter,sans-serif"
                    fontSize="9.5"
                    fontWeight="800"
                    fontStyle="italic"
                    fill="#1a1f71"
                    letterSpacing="0.3"
                >
                    VISA
                </text>
            </svg>
        </span>
    );
}

function MastercardBrand({ active, hasBrand }: { active: boolean; hasBrand: boolean }) {
    return (
        <span className={`brand ${hasBrand ? (active ? "brand-on" : "brand-off") : ""}`}>
            <svg width="34" height="22" viewBox="0 0 34 22">
                <rect width="34" height="22" rx="4" fill="#fff" stroke="#e5e7eb" />
                <circle cx="14" cy="11" r="6" fill="#eb001b" />
                <circle cx="20" cy="11" r="6" fill="#f79e1b" fillOpacity="0.92" />
            </svg>
        </span>
    );
}

function AmexBrand({ active, hasBrand }: { active: boolean; hasBrand: boolean }) {
    return (
        <span className={`brand ${hasBrand ? (active ? "brand-on" : "brand-off") : ""}`} data-testid="business-protected-checkout-amex-text">
            <svg width="34" height="22" viewBox="0 0 34 22">
                <rect width="34" height="22" rx="4" fill="#1f6fc4" />
                <text
                    x="17"
                    y="14.5"
                    textAnchor="middle"
                    fontFamily="Inter,sans-serif"
                    fontSize="7"
                    fontWeight="800"
                    fill="#fff"
                    letterSpacing="0.2"
                >
                    AMEX
                </text>
            </svg>
        </span>
    );
}

function CheckIcon({ className = "h-5 w-5" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <polyline points="20 6 9 17 4 12" />
        </svg>
    );
}

function ArrowIcon({ className = "h-5 w-5" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <line x1="5" y1="12" x2="19" y2="12" />
            <polyline points="12 5 19 12 12 19" />
        </svg>
    );
}

function LockIcon({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="3" y="11" width="18" height="11" rx="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    );
}

function ShieldIcon({ className = "h-5 w-5" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <polyline points="9 12 11 14 15 10" />
        </svg>
    );
}

function ChatIcon({ className = "h-6 w-6" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
        </svg>
    );
}

function CardIcon({ className = "h-4 w-4" }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <rect x="1" y="4" width="22" height="16" rx="2" />
            <line x1="1" y1="10" x2="23" y2="10" />
        </svg>
    );
}
