"use client";

import Link from "next/link";
import type { Route } from "next";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  deleteBusinessAccount,
  downloadBusinessDataExport,
  disconnectBusinessCalendar,
  getBusinessCalendarOAuthUrl,
  getBusinessCalendarStatus,
  getBusinessLoginHistory,
  getBusinessActiveSessions,
  getBusinessSettingsProfile,
  getBusinessSetup,
  requestBusinessEmailChange,
  revokeBusinessSession,
  revokeOtherBusinessSessions,
  saveBusinessBillingAddress,
  saveBusinessPaymentMethod,
  saveBusinessProfilePhoto,
  saveBusinessSettingsProfile,
  saveBusinessSetup,
  verifyBusinessEmailChange,
  type BusinessLoginHistoryEntry,
  type BusinessSettingsProfile,
  type BusinessSettingsSession,
  type BusinessSetupData
} from "@/components/business/features/api";
import { BusinessPaymentMethodModal } from "@/components/business/business-payment-method-modal";
import { apiGet } from "@/lib/api";
import { getAuthUser, logout, saveAuthSession, updateAuthUser, type AuthUser } from "@/lib/auth";
import { readProfilePhotoFile } from "@/lib/profile-photo";
import { BUSINESS_BILLING_PATH } from "@/lib/routes";
import { requestSignedDpa } from "@/lib/dpa";
import { BusinessPageHeader } from "@/components/business/business-page-header";

type SettingsTab =
  | "profile"
  | "security"
  | "notifications"
  | "integrations"
  | "billing"
  | "privacy"
  | "danger";

const TABS: Array<{ id: SettingsTab; label: string; danger?: boolean }> = [
  { id: "profile", label: "Profile" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "integrations", label: "Integrations" },
  { id: "billing", label: "Billing" },
  { id: "privacy", label: "Data & Privacy" },
  { id: "danger", label: "Danger Zone", danger: true }
];

const INDUSTRIES = [
  "Dental",
  "Medical Clinic",
  "Dermatology",
  "Physiotherapy",
  "Chiropractor",
  "Optometry",
  "Veterinary",
  "Med Spa",
  "Salon",
  "Barbershop",
  "Spa & Wellness",
  "Yoga Studio",
  "Gym / Fitness",
  "Law Firm",
  "Plumber",
  "HVAC",
  "Electrician",
  "Garage Door",
  "Roofing",
  "Landscaping",
  "Pool Service",
  "Real Estate",
  "Auto Repair",
  "Restaurant",
  "Insurance",
  "Mortgage Broker",
  "Urgent Care",
  "Senior Care",
  "Property Management",
  "E-commerce",
  "Other"
];

const BUSINESS_SIZES = [
  "Solo practitioner",
  "2-10 employees",
  "11-50",
  "51-200",
  "200+"
];

const TIMEZONES = [
  "America/Los_Angeles (Pacific Time)",
  "America/Denver (Mountain Time)",
  "America/Chicago (Central Time)",
  "America/New_York (Eastern Time)",
  "America/Anchorage (Alaska Time)",
  "Pacific/Honolulu (Hawaii Time)",
  "Europe/London (GMT)",
  "Asia/Kolkata (India Standard Time)"
];

const PHONE_COUNTRIES = [
  { dialCode: "+1", label: "+1 US / Canada" },
  { dialCode: "+44", label: "+44 United Kingdom" },
  { dialCode: "+91", label: "+91 India" },
  { dialCode: "+61", label: "+61 Australia" },
  { dialCode: "+971", label: "+971 UAE" },
  { dialCode: "+65", label: "+65 Singapore" },
  { dialCode: "+49", label: "+49 Germany" },
  { dialCode: "+33", label: "+33 France" },
  { dialCode: "+81", label: "+81 Japan" },
  { dialCode: "+55", label: "+55 Brazil" }
] as const;

function getPhoneCountryCode(phone: string) {
  return (
    [...PHONE_COUNTRIES]
      .sort((a, b) => b.dialCode.length - a.dialCode.length)
      .find(({ dialCode }) => phone.trim().startsWith(dialCode))?.dialCode ?? "+1"
  );
}

function getNationalPhoneNumber(phone: string, dialCode = getPhoneCountryCode(phone)) {
  const trimmedPhone = phone.trim();
  return trimmedPhone.startsWith(dialCode) ? trimmedPhone.slice(dialCode.length).trimStart() : trimmedPhone;
}

function buildInternationalPhoneNumber(dialCode: string, nationalNumber: string) {
  const trimmedNumber = nationalNumber.trim();
  return trimmedNumber ? `${dialCode}${trimmedNumber}` : "";
}

function optionSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function SettingsSelect({
  id,
  value,
  options,
  placeholder,
  testId,
  menuTestId,
  optionTestIdPrefix,
  onChange
}: {
  id: string;
  value: string;
  options: readonly string[];
  placeholder: string;
  testId: string;
  menuTestId: string;
  optionTestIdPrefix: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const visibleOptions = useMemo(() => {
    if (!value || options.includes(value)) return options;
    return [value, ...options];
  }, [options, value]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <div ref={dropdownRef} className="relative">
      <button
        id={id}
        type="button"
        onClick={() => setOpen((current) => !current)}
        data-testid={testId}
        className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-sm shadow-sm transition focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={value ? "truncate text-slate-900" : "truncate text-slate-500"}>
          {value || placeholder}
        </span>
        <svg
          className={`ml-3 h-4 w-4 shrink-0 text-slate-400 transition ${open ? "rotate-180" : ""}`}
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

      {open ? (
        <div
          role="listbox"
          data-testid={menuTestId}
          className="absolute left-0 top-full z-[80] mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-lg"
        >
          {visibleOptions.map((option) => {
            const active = value === option;

            return (
              <button
                key={option}
                type="button"
                role="option"
                aria-selected={active}
                data-testid={`${optionTestIdPrefix}-${optionSlug(option)}`}
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
                  active ? "bg-amber-50 text-amber-700" : "bg-white text-slate-700 hover:bg-amber-50 hover:text-amber-700"
                }`}
              >
                <span className="truncate">{option}</span>
                {active ? (
                  <svg className="ml-2 h-4 w-4 shrink-0 text-amber-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const NOTIFICATION_ROWS: Array<{
  key: string;
  title: string;
  description: string;
  locked?: boolean;
  defaults: { email: boolean };
}> = [
  {
    key: "agentActivity",
    title: "Agent activity",
    description: "When your agents complete tasks, encounter errors, or need attention",
    defaults: { email: true }
  },
  {
    key: "billingPayments",
    title: "Billing & payments",
    description: "Payment confirmations, failed charges, upcoming renewals",
    defaults: { email: true }
  },
  {
    key: "productUpdates",
    title: "Product updates",
    description: "New features, marketplace additions, and platform improvements",
    defaults: { email: false }
  },
  {
    key: "securityAlerts",
    title: "Security alerts",
    description: "New logins, password changes, and suspicious activity",
    defaults: { email: true },
    locked: true
  }
];

const PRIVACY_PREFS = [
  {
    key: "personalizedRecommendations",
    label: "Personalized recommendations",
    description: "Allow Triven to suggest agents based on your usage patterns",
    defaultOn: true
  },
  {
    key: "usageAnalytics",
    label: "Usage analytics",
    description: "Help improve Triven by sharing anonymized usage data",
    defaultOn: true
  },
  {
    key: "marketingCommunications",
    label: "Marketing communications",
    description: "Receive occasional emails about new marketplace agents and features",
    defaultOn: false
  }
];

const COOKIE_PREFS = [
  {
    key: "essentialCookies",
    label: "Essential cookies",
    description: "Required for the platform to function",
    defaultOn: true,
    locked: true
  },
  {
    key: "analyticsCookies",
    label: "Analytics cookies",
    description: "Help us understand how you use Triven",
    defaultOn: true
  },
  {
    key: "marketingCookies",
    label: "Marketing cookies",
    description: "Used for relevant advertising",
    defaultOn: false
  }
];

const PASSWORD_REQUIREMENTS = [
  { key: "len" as const, label: "12+ characters" },
  { key: "upper" as const, label: "1 uppercase letter" },
  { key: "number" as const, label: "1 number" },
  { key: "special" as const, label: "1 special character" }
];

type BillingPaymentMethod = {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
};

type BillingInvoice = {
  id: string;
  createdAt: string;
  amountCents: number;
  displayAmountCents?: number;
  status: string;
};

type BillingData = {
  plan: { name: string; status: string };
  summary: { nextChargeCents: number };
  invoices: BillingInvoice[];
  paymentMethod: BillingPaymentMethod | null;
  backupPaymentMethod: BillingPaymentMethod | null;
  businessName: string | null;
  billingEmail: string | null;
  billingAddress: string | null;
  billingPostalCode: string | null;
};

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(iso));
}

function formatDateTime(iso: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(iso));
}

function getInitials(name: string) {
  return (
    name
      .split(" ")
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "U"
  );
}

function passwordStrength(password: string) {
  const checks = {
    len: password.length >= 12,
    upper: /[A-Z]/.test(password),
    number: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password)
  };
  const score = Object.values(checks).filter(Boolean).length;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  return { checks, score, label: labels[score] ?? "" };
}

function Toggle({
  checked,
  disabled,
  onChange,
  testId
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-testid={testId}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? "bg-amber-500" : "bg-gray-200"} ${disabled ? "cursor-not-allowed opacity-55" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

function LockIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={`h-5 w-5 text-slate-400 transition ${open ? "rotate-180" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function SettingsSection({
  tabId,
  activeTab,
  expandedMobile,
  label,
  danger,
  testId,
  onMobileToggle,
  children
}: {
  tabId: SettingsTab;
  activeTab: SettingsTab;
  expandedMobile: SettingsTab | null;
  label: string;
  danger?: boolean;
  testId: string;
  onMobileToggle: (tab: SettingsTab) => void;
  children: ReactNode;
}) {
  const mobileOpen = expandedMobile === tabId;
  const desktopVisible = activeTab === tabId;

  const inner = (
    <>
      <button
        type="button"
        className={`flex w-full items-center justify-between px-5 py-4 text-left lg:hidden ${danger ? "text-red-700" : ""}`}
        aria-expanded={mobileOpen}
        data-testid={`business-settings-mobile-tab-${tabId}`}
        onClick={() => onMobileToggle(tabId)}
      >
        <span className={`text-base font-semibold ${danger ? "text-red-700" : "text-slate-900"}`}>{label}</span>
        <ChevronIcon open={mobileOpen} />
      </button>
      <div
        className={`${mobileOpen ? "block" : "hidden"} p-5 sm:p-6 lg:block lg:p-8`}
        role="tabpanel"
        tabIndex={0}
      >
        {children}
      </div>
    </>
  );

  if (danger) {
    return (
      <section className="block lg:block" data-testid={testId}>
        <div className={`overflow-hidden rounded-2xl border-2 border-red-200 bg-red-50/50 ${desktopVisible ? "lg:block" : "lg:hidden"}`}>
          {inner}
        </div>
      </section>
    );
  }

  return (
    <section
      className={`block overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm ${desktopVisible ? "lg:block" : "lg:hidden"}`}
      data-testid={testId}
    >
      {inner}
    </section>
  );
}

function formatTimeZoneLabel(value: string) {
  const match = TIMEZONES.find((option) => option.startsWith(value) || option === value);
  return match ?? value;
}

function buildProfileForm(
  authUser: AuthUser | null,
  setup: BusinessSetupData | null,
  settingsProfile?: BusinessSettingsProfile | null
) {
  return {
    businessId: settingsProfile?.businessId ?? setup?.business?.id ?? "",
    fullName: settingsProfile?.fullName ?? authUser?.fullName ?? "",
    email: settingsProfile?.email ?? authUser?.email ?? "",
    phone: settingsProfile?.phone ?? setup?.profile?.teamPhone ?? "",
    businessName: settingsProfile?.businessName ?? setup?.business?.name ?? "",
    industry: settingsProfile?.businessType ?? setup?.business?.type ?? INDUSTRIES[0]!,
    businessSize: settingsProfile?.businessSize || BUSINESS_SIZES[1]!,
    website: settingsProfile?.bookingUrl ?? setup?.profile?.bookingUrl ?? "",
    address: settingsProfile?.businessAddress ?? "",
    timezone: formatTimeZoneLabel(settingsProfile?.timeZone ?? setup?.profile?.timeZone ?? TIMEZONES[0]!)
  };
}

export function BusinessSettingsView() {
  const authUser = useMemo(() => getAuthUser(), []);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [setupData, setSetupData] = useState<BusinessSetupData | null>(null);
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [calendarConnected, setCalendarConnected] = useState(false);
  const [calendarEmail, setCalendarEmail] = useState<string | null>(null);

  const [profileForm, setProfileForm] = useState(() => buildProfileForm(authUser, null));
  const [accountEmail, setAccountEmail] = useState(authUser?.email ?? "");
  const [emailDraft, setEmailDraft] = useState(authUser?.email ?? "");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailOtpVisible, setEmailOtpVisible] = useState(false);
  const [emailVerified, setEmailVerified] = useState(false);
  const [emailChangeSending, setEmailChangeSending] = useState(false);
  const [emailChangeVerifying, setEmailChangeVerifying] = useState(false);
  const [savedProfilePhotoUrl, setSavedProfilePhotoUrl] = useState<string | null>(
    authUser?.profilePhotoUrl ?? null
  );
  const [profilePhotoSelecting, setProfilePhotoSelecting] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: "", next: "", confirm: "" });
  const [notificationPrefs, setNotificationPrefs] = useState<
    Record<string, { email: boolean; locked?: boolean }>
  >({});
  const [privacyPrefs, setPrivacyPrefs] = useState<Record<string, boolean>>({});
  const [cookiePrefs, setCookiePrefs] = useState<Record<string, boolean>>({});
  const [expandedMobile, setExpandedMobile] = useState<SettingsTab | null>("profile");
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [sessions, setSessions] = useState<BusinessSettingsSession[]>([]);
  const [loginHistory, setLoginHistory] = useState<BusinessLoginHistoryEntry[]>([]);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [billingAddressEditing, setBillingAddressEditing] = useState(false);
  const [billingAddressSaving, setBillingAddressSaving] = useState(false);
  const [billingAddressForm, setBillingAddressForm] = useState({ address: "", pincode: "" });
  const [exportingData, setExportingData] = useState(false);
  const [requestingDpa, setRequestingDpa] = useState(false);
  const [cardModalMode, setCardModalMode] = useState<"primary" | "backup" | null>(null);
  const [makingCardPrimary, setMakingCardPrimary] = useState(false);

  const initials = getInitials(profileForm.fullName || accountEmail || "User");
  const pwStrength = passwordStrength(passwordForm.next);
  const profilePhotoDraft = profilePhotoPreview ?? savedProfilePhotoUrl;
  const normalizedEmailDraft = emailDraft.trim().toLowerCase();
  const normalizedAccountEmail = accountEmail.trim().toLowerCase();
  const emailDraftChanged =
    Boolean(normalizedEmailDraft) && normalizedEmailDraft !== normalizedAccountEmail;
  const emailDraftValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmailDraft);
  const phoneCountryCode = getPhoneCountryCode(profileForm.phone);
  const nationalPhoneNumber = getNationalPhoneNumber(profileForm.phone, phoneCountryCode);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }, []);

  async function handleMakeBackupCardPrimary() {
    if (!billing?.backupPaymentMethod || makingCardPrimary) return;
    setMakingCardPrimary(true);
    const result = await saveBusinessPaymentMethod("primary", billing.backupPaymentMethod.id);
    setMakingCardPrimary(false);
    if (!result.success) {
      showToast(result.error ?? "Could not update the primary payment method");
      return;
    }
    await loadData();
    showToast("Primary payment method updated ✓");
  }

  const loadData = useCallback(async () => {
    const [setupResult, billingResult, calendarResult, profileResult, sessionsResult, loginHistoryResult] =
      await Promise.all([
      getBusinessSetup(),
      apiGet<{ billing: BillingData }>("/payments/billing"),
      getBusinessCalendarStatus(),
      getBusinessSettingsProfile(),
      getBusinessActiveSessions(),
      getBusinessLoginHistory()
    ]);

    const settingsProfile =
      profileResult.success && profileResult.data?.profile ? profileResult.data.profile : null;
    const businessId =
      settingsProfile?.businessId ??
      (setupResult.success ? setupResult.data?.business?.id : undefined);

    if (setupResult.success && setupResult.data) {
      setSetupData(setupResult.data);
    }

    const profileRequest =
      businessId && !settingsProfile?.businessId
        ? await getBusinessSettingsProfile(businessId)
        : profileResult;
    const resolvedProfile =
      profileRequest.success && profileRequest.data?.profile ? profileRequest.data.profile : settingsProfile;

    const nextForm = buildProfileForm(
      authUser,
      setupResult.success ? setupResult.data ?? null : null,
      resolvedProfile
    );
    setProfileForm(nextForm);

    const nextEmail = resolvedProfile?.email ?? authUser?.email ?? "";
    setAccountEmail(nextEmail);
    setEmailDraft(nextEmail);
    setEmailOtp("");
    setEmailOtpVisible(false);
    setEmailVerified(false);
    setProfilePhotoPreview(null);

    const nextPhoto = resolvedProfile?.profilePhotoUrl ?? authUser?.profilePhotoUrl ?? null;
    setSavedProfilePhotoUrl(nextPhoto);
    if (nextPhoto) {
      updateAuthUser({ profilePhotoUrl: nextPhoto });
    }

    if (billingResult.success && billingResult.data?.billing) {
      setBilling(billingResult.data.billing);
      setBillingAddressForm({
        address: billingResult.data.billing.billingAddress ?? "",
        pincode: billingResult.data.billing.billingPostalCode ?? ""
      });
    }

    if (calendarResult.success && calendarResult.data) {
      setCalendarConnected(calendarResult.data.connected);
      setCalendarEmail(calendarResult.data.email);
    }

    if (sessionsResult.success && sessionsResult.data?.sessions) {
      setSessions(sessionsResult.data.sessions);
    } else {
      setSessions([]);
    }

    if (loginHistoryResult.success && loginHistoryResult.data?.loginHistory) {
      setLoginHistory(loginHistoryResult.data.loginHistory);
    } else {
      setLoginHistory([]);
    }
  }, [authUser]);

  useEffect(() => {
    const prefs: Record<string, { email: boolean; locked?: boolean }> = {};
    for (const row of NOTIFICATION_ROWS) {
      prefs[row.key] = { ...row.defaults, locked: row.locked };
    }
    setNotificationPrefs(prefs);

    const privacy: Record<string, boolean> = {};
    for (const row of PRIVACY_PREFS) {
      privacy[row.key] = row.defaultOn;
    }
    setPrivacyPrefs(privacy);

    const cookies: Record<string, boolean> = {};
    for (const row of COOKIE_PREFS) {
      cookies[row.key] = row.defaultOn;
    }
    setCookiePrefs(cookies);

    loadData().finally(() => setLoading(false));
  }, [loadData]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTab = params.get("tab");

    if (requestedTab && TABS.some((tab) => tab.id === requestedTab)) {
      const tab = requestedTab as SettingsTab;
      setActiveTab(tab);
      setExpandedMobile(tab);
    }

    if (params.get("gmail") === "connected") {
      showToast("Google Calendar connected");
    } else if (params.get("gmail") === "failed") {
      showToast("Could not connect Google Calendar");
    }
  }, [showToast]);

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();

    if (emailDraftChanged && !emailVerified) {
      showToast("Verify your new email before saving");
      return;
    }

    if (!profileForm.businessId) {
      showToast("Business profile is not available yet");
      return;
    }

    setSaving(true);

    let nextProfilePhotoUrl = savedProfilePhotoUrl;

    if (profilePhotoPreview) {
      const photoResult = await saveBusinessProfilePhoto(profilePhotoPreview);
      if (!photoResult.success || !photoResult.data?.profile) {
        setSaving(false);
        showToast(photoResult.error ?? "Could not save profile photo");
        return;
      }
      nextProfilePhotoUrl = photoResult.data.profile.profilePhotoUrl ?? profilePhotoPreview;
    }

    const result = await saveBusinessSettingsProfile({
      businessId: profileForm.businessId,
      fullName: profileForm.fullName,
      phone: profileForm.phone,
      email: emailDraftChanged && emailVerified ? normalizedEmailDraft : undefined,
      businessName: profileForm.businessName,
      businessType: profileForm.industry,
      businessSize: profileForm.businessSize,
      teamPhone: profileForm.phone || undefined,
      bookingUrl: profileForm.website || undefined,
      timeZone: profileForm.timezone,
      businessAddress: profileForm.address || undefined
    });

    if (!result.success || !result.data?.profile) {
      setSaving(false);
      showToast(result.error ?? "Could not save profile");
      return;
    }

    if (result.data.token && result.data.user) {
      saveAuthSession(result.data.token, {
        ...result.data.user,
        role: "BUSINESS"
      });
    }

    const savedProfile = result.data.profile;
    const nextEmail = savedProfile.email;
    setAccountEmail(nextEmail);
    setEmailDraft(nextEmail);
    setEmailOtp("");
    setEmailOtpVisible(false);
    setEmailVerified(false);
    setProfilePhotoPreview(null);
    setSavedProfilePhotoUrl(nextProfilePhotoUrl);
    setProfileForm((current) => ({
      ...current,
      fullName: savedProfile.fullName,
      email: nextEmail,
      phone: savedProfile.phone,
      businessName: savedProfile.businessName,
      industry: savedProfile.businessType,
      businessSize: savedProfile.businessSize || current.businessSize,
      website: savedProfile.bookingUrl,
      address: savedProfile.businessAddress,
      timezone: formatTimeZoneLabel(savedProfile.timeZone)
    }));

    updateAuthUser({
      fullName: savedProfile.fullName,
      email: nextEmail,
      ...(nextProfilePhotoUrl ? { profilePhotoUrl: nextProfilePhotoUrl } : {})
    });

    if (setupData?.business) {
      await saveBusinessSetup({
        businessName: savedProfile.businessName,
        businessType: savedProfile.businessType,
        forwardToPhone: setupData.phoneNumber?.forwardToPhone ?? "",
        teamPhone: savedProfile.teamPhone || undefined,
        bookingUrl: savedProfile.bookingUrl || undefined,
        timeZone: savedProfile.timeZone,
        services: setupData.profile?.services ?? [],
        faqs: setupData.profile?.faqs ?? [],
        hours: setupData.profile?.hours ?? [],
        knowledge: setupData.knowledge ?? []
      });
    }

    setSaving(false);
    showToast("Changes saved ✓");
    await loadData();
  }

  async function handleRequestEmailChange() {
    if (!emailDraftChanged || !emailDraftValid) {
      showToast("Enter a valid new email address");
      return;
    }

    setEmailChangeSending(true);
    const result = await requestBusinessEmailChange(normalizedEmailDraft);
    setEmailChangeSending(false);

    if (!result.success) {
      showToast(result.error ?? "Could not send verification code");
      return;
    }

    setEmailVerified(false);
    setEmailOtp("");
    setEmailOtpVisible(true);
    showToast(`Verification code sent to ${normalizedEmailDraft}`);
  }

  async function handleVerifyEmailChange() {
    if (emailOtp.trim().length !== 6) {
      showToast("Enter the 6-digit code");
      return;
    }

    setEmailChangeVerifying(true);
    const result = await verifyBusinessEmailChange({
      email: normalizedEmailDraft,
      code: emailOtp.trim()
    });
    setEmailChangeVerifying(false);

    if (!result.success) {
      showToast(result.error ?? "Could not verify email");
      return;
    }

    setEmailVerified(true);
    setProfileForm((current) => ({ ...current, email: normalizedEmailDraft }));
    showToast("Email verified. Click Save changes to update your account.");
  }

  async function handleConnectCalendar() {
    const result = await getBusinessCalendarOAuthUrl();
    if (result.success && result.data?.url) {
      window.location.href = result.data.url;
      return;
    }
    showToast(result.error ?? "Could not start Google Calendar connection");
  }

  async function handleDisconnectCalendar() {
    const result = await disconnectBusinessCalendar();
    if (result.success) {
      setCalendarConnected(false);
      setCalendarEmail(null);
      showToast("Google Calendar disconnected");
      return;
    }
    showToast(result.error ?? "Could not disconnect Google Calendar");
  }

  function handleSaveNotifications() {
    showToast("Preferences saved ✓");
  }

  async function handleSaveBillingAddress(event: FormEvent) {
    event.preventDefault();

    if (!profileForm.businessId) {
      showToast("Business profile is not available yet");
      return;
    }

    const address = billingAddressForm.address.trim();
    const pincode = billingAddressForm.pincode.trim();

    if (!address || !pincode) {
      showToast("Enter both address and pincode");
      return;
    }

    setBillingAddressSaving(true);
    const result = await saveBusinessBillingAddress({
      businessId: profileForm.businessId,
      address,
      pincode
    });
    setBillingAddressSaving(false);

    if (!result.success || !result.data?.billingAddress) {
      showToast(result.error ?? "Could not update billing address");
      return;
    }

    const savedAddress = result.data.billingAddress;
    setBilling((current) =>
      current
        ? {
            ...current,
            billingAddress: savedAddress.address,
            billingPostalCode: savedAddress.pincode
          }
        : current
    );
    setBillingAddressEditing(false);
    showToast("Billing address updated");
  }

  async function handleExportData() {
    if (!profileForm.businessId || exportingData) return;

    setExportingData(true);
    const result = await downloadBusinessDataExport(profileForm.businessId);
    setExportingData(false);
    showToast(result.success ? "Business data downloaded" : result.error ?? "Could not export your data");
  }

  function handleSavePrivacy() {
    showToast("Preferences saved ✓");
  }

  async function handleRequestSignedDpa() {
    if (requestingDpa) return;
    setRequestingDpa(true);
    const result = await requestSignedDpa({
      fullName: profileForm.fullName,
      company: profileForm.businessName,
      email: accountEmail,
      industry: profileForm.industry
    });
    setRequestingDpa(false);
    showToast(result.success ? "Signed DPA request sent" : result.error ?? "Could not send DPA request");
  }

  function handleUpdatePassword() {
    if (!passwordForm.current || !passwordForm.next || passwordForm.next !== passwordForm.confirm) {
      showToast("Please complete all password fields correctly");
      return;
    }
    if (pwStrength.score < 4) {
      showToast("Password does not meet all requirements");
      return;
    }
    setPasswordForm({ current: "", next: "", confirm: "" });
    showToast("Password updated ✓");
  }

  function handleMobileToggle(tab: SettingsTab) {
    setActiveTab(tab);
    setExpandedMobile((current) => (current === tab ? null : tab));
  }

  function handleDesktopTab(tab: SettingsTab) {
    setActiveTab(tab);
    setExpandedMobile(tab);
  }

  function handleProfilePhotoSelect(file: File | undefined) {
    if (!file) return;

    setProfilePhotoSelecting(true);
    readProfilePhotoFile(file)
      .then((preview) => setProfilePhotoPreview(preview))
      .catch((error: unknown) => {
        showToast(error instanceof Error ? error.message : "Could not read image");
      })
      .finally(() => setProfilePhotoSelecting(false));
  }

  async function handleRevokeSession(sessionId: string) {
    const result = await revokeBusinessSession(sessionId);
    if (result.success) {
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      showToast("Session revoked");
      return;
    }
    showToast(result.error ?? "Could not revoke session");
  }

  async function handleRevokeOtherSessions() {
    const result = await revokeOtherBusinessSessions();
    if (result.success) {
      setSessions((current) => current.filter((session) => session.isCurrent));
      showToast("All other sessions revoked");
      return;
    }
    showToast(result.error ?? "Could not revoke sessions");
  }

  async function handleDeleteAccount() {
    if (deleteConfirm !== "DELETE" || deleting) return;

    setDeleting(true);
    const result = await deleteBusinessAccount(deleteConfirm);
    setDeleting(false);

    if (!result.success) {
      showToast(result.error ?? "Could not delete your account");
      return;
    }

    // The account and all business data are gone server-side — end the session.
    setDeleteModalOpen(false);
    logout();
  }

  const twilioConnected = Boolean(setupData?.phoneNumber?.phoneNumber);
  const recentInvoices = billing?.invoices?.slice(0, 3) ?? [];

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6" data-testid="business-settings-loading">
        <div className="mx-auto max-w-5xl animate-pulse space-y-6">
          <div className="h-10 w-64 rounded-xl bg-white" />
          <div className="h-96 rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <BusinessPageHeader
          eyebrow="Configure"
          title="Settings"
          description="Manage your account, security, and preferences."
        />

        <div className="lg:grid lg:grid-cols-[14rem_minmax(0,1fr)] lg:items-start lg:gap-8">
          <nav
            className="mb-4 hidden lg:flex lg:flex-col lg:gap-1 lg:sticky lg:top-10"
            role="tablist"
            aria-label="Settings sections"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                data-testid={`business-settings-tab-${tab.id}`}
                onClick={() => handleDesktopTab(tab.id)}
                className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition ${
                  activeTab === tab.id
                    ? tab.danger
                      ? "border-l-2 border-red-500 bg-red-50 font-semibold text-red-700"
                      : "border-l-2 border-amber-500 bg-amber-50 font-semibold text-amber-700"
                    : tab.danger
                      ? "border-l-2 border-transparent text-red-600 hover:bg-red-50"
                      : "border-l-2 border-transparent text-slate-600 hover:bg-gray-50"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex min-w-0 flex-col gap-4">
            <SettingsSection
              tabId="profile"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Profile"
              testId="business-settings-panel-profile"
              onMobileToggle={handleMobileToggle}
            >
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900">Profile information</h2>
                    <p className="mt-1 text-sm text-slate-500">Manage your personal and business details.</p>
                  </div>

                  <form onSubmit={handleSaveProfile}>
                    <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Personal</h3>

                    <div className="mb-6 flex items-center gap-4">
                      <div className="group relative h-20 w-20 shrink-0 rounded-full">
                        <div
                          className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-2xl font-semibold text-white"
                          data-testid="business-settings-avatar"
                        >
                          {profilePhotoDraft ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={profilePhotoDraft} alt="" className="h-full w-full object-cover" />
                          ) : (
                            initials
                          )}
                        </div>
                        <button
                          type="button"
                          className="absolute inset-0 flex flex-col items-center justify-center rounded-full bg-slate-900/55 text-white opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100"
                          aria-label="Change profile photo"
                          data-testid="business-settings-avatar-change"
                          disabled={profilePhotoSelecting || saving}
                          onClick={() => avatarInputRef.current?.click()}
                        >
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
                            <circle cx="12" cy="13" r="4" />
                          </svg>
                          <span className="mt-0.5 text-[11px] font-semibold">Change</span>
                        </button>
                        <input
                          ref={avatarInputRef}
                          type="file"
                          accept="image/png,image/jpeg"
                          className="hidden"
                          data-testid="business-settings-avatar-input"
                          onChange={(e) => handleProfilePhotoSelect(e.target.files?.[0])}
                        />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Profile photo</p>
                        <p className="text-sm text-slate-500">
                          {profilePhotoSelecting ? "Loading preview..." : "JPG or PNG, up to 2MB. Saved when you click Save changes."}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div className="sm:col-span-2 sm:max-w-md">
                        <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Full name
                        </label>
                        <input
                          id="fullName"
                          data-testid="business-settings-full-name"
                          value={profileForm.fullName}
                          onChange={(e) => setProfileForm((c) => ({ ...c, fullName: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Email address
                        </label>
                        <div className="relative sm:max-w-md">
                          <input
                            id="email"
                            type="email"
                            value={emailDraft}
                            data-testid="business-settings-email"
                            onChange={(e) => {
                              setEmailDraft(e.target.value);
                              setEmailVerified(false);
                              setEmailOtpVisible(false);
                              setEmailOtp("");
                            }}
                            className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-24 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                          />
                          <span
                            className={`absolute right-3 top-1/2 flex -translate-y-1/2 items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${
                              emailDraftChanged
                                ? emailVerified
                                  ? "bg-green-50 text-green-700"
                                  : "bg-amber-50 text-amber-700"
                                : "bg-green-50 text-green-700"
                            }`}
                          >
                            {emailDraftChanged ? (
                              emailVerified ? (
                                <>
                                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M20 6 9 17l-5-5" />
                                  </svg>
                                  Verified
                                </>
                              ) : (
                                "New"
                              )
                            ) : (
                              <>
                                <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                  <path d="M20 6 9 17l-5-5" />
                                </svg>
                                Verified
                              </>
                            )}
                          </span>
                        </div>
                        {emailDraftChanged ? (
                          <button
                            type="button"
                            disabled={!emailDraftValid || emailChangeSending}
                            className="mt-2 text-sm font-semibold text-amber-700 hover:underline disabled:opacity-50"
                            data-testid="business-settings-change-email"
                            onClick={handleRequestEmailChange}
                          >
                            {emailChangeSending ? "Sending code..." : "Change email"}
                          </button>
                        ) : null}
                        {emailOtpVisible ? (
                          <div className="mt-3 max-w-md rounded-lg border border-amber-100 bg-amber-50 px-3 py-3">
                            <p className="text-sm text-slate-600">
                              A confirmation code was sent to <span className="font-semibold text-slate-800">{normalizedEmailDraft}</span>.
                            </p>
                            <label htmlFor="emailOtp" className="mb-1.5 mt-3 block text-xs font-semibold text-amber-900">
                              Enter verification code
                            </label>
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                              <input
                                id="emailOtp"
                                value={emailOtp}
                                onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                data-testid="business-settings-email-otp"
                                className="w-full rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                                placeholder="6-digit code"
                              />
                              <button
                                type="button"
                                disabled={emailOtp.length !== 6 || emailChangeVerifying}
                                onClick={handleVerifyEmailChange}
                                data-testid="business-settings-verify-email"
                                className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                              >
                                {emailChangeVerifying ? "Verifying..." : "Verify"}
                              </button>
                            </div>
                            <button
                              type="button"
                              disabled={emailChangeSending}
                              onClick={handleRequestEmailChange}
                              data-testid="business-settings-resend-email-otp"
                              className="mt-2 text-sm font-semibold text-amber-700 hover:underline disabled:opacity-50"
                            >
                              {emailChangeSending ? "Sending..." : "Resend code"}
                            </button>
                          </div>
                        ) : null}
                      </div>

                      <div className="sm:max-w-md">
                        <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Phone number
                        </label>
                        <div className="flex">
                          <select
                            aria-label="Phone country code"
                            data-testid="business-settings-phone-country-code"
                            value={phoneCountryCode}
                            onChange={(e) =>
                              setProfileForm((current) => ({
                                ...current,
                                phone: buildInternationalPhoneNumber(
                                  e.target.value,
                                  getNationalPhoneNumber(current.phone)
                                )
                              }))
                            }
                            className="w-36 shrink-0 rounded-l-xl border border-r-0 border-gray-200 bg-white px-3 py-3 text-sm text-slate-700 shadow-sm focus:z-10 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100 sm:w-44"
                          >
                            {PHONE_COUNTRIES.map((country) => (
                              <option key={country.dialCode} value={country.dialCode}>
                                {country.label}
                              </option>
                            ))}
                          </select>
                          <input
                            id="phone"
                            type="tel"
                            data-testid="business-settings-phone"
                            value={nationalPhoneNumber}
                            onChange={(e) =>
                              setProfileForm((current) => ({
                                ...current,
                                phone: buildInternationalPhoneNumber(phoneCountryCode, e.target.value)
                              }))
                            }
                            className="min-w-0 w-full rounded-r-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:z-10 focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                          />
                        </div>
                      </div>
                    </div>

                    <hr className="my-7 border-gray-100" />

                    <h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">Business</h3>

                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                      <div>
                        <label htmlFor="businessName" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Business name
                        </label>
                        <input
                          id="businessName"
                          data-testid="business-settings-business-name"
                          value={profileForm.businessName}
                          onChange={(e) => setProfileForm((c) => ({ ...c, businessName: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        />
                      </div>
                      <div>
                        <label htmlFor="industry" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Industry
                        </label>
                        <SettingsSelect
                          id="industry"
                          value={profileForm.industry}
                          options={INDUSTRIES}
                          placeholder="Select industry"
                          testId="business-settings-industry"
                          menuTestId="business-settings-industry-menu"
                          optionTestIdPrefix="business-settings-industry-option"
                          onChange={(industry) => setProfileForm((c) => ({ ...c, industry }))}
                        />
                      </div>
                      <div>
                        <label htmlFor="businessSize" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Business size
                        </label>
                        <SettingsSelect
                          id="businessSize"
                          value={profileForm.businessSize}
                          options={BUSINESS_SIZES}
                          placeholder="Select business size"
                          testId="business-settings-business-size"
                          menuTestId="business-settings-business-size-menu"
                          optionTestIdPrefix="business-settings-business-size-option"
                          onChange={(businessSize) => setProfileForm((c) => ({ ...c, businessSize }))}
                        />
                      </div>
                      <div>
                        <label htmlFor="website" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Business website
                        </label>
                        <input
                          id="website"
                          data-testid="business-settings-website"
                          value={profileForm.website}
                          onChange={(e) => setProfileForm((c) => ({ ...c, website: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="address" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Business address
                        </label>
                        <input
                          id="address"
                          data-testid="business-settings-address"
                          value={profileForm.address}
                          onChange={(e) => setProfileForm((c) => ({ ...c, address: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        />
                      </div>
                      <div className="sm:col-span-2 sm:max-w-md">
                        <label htmlFor="timezone" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Timezone
                        </label>
                        <select
                          id="timezone"
                          data-testid="business-settings-timezone"
                          value={profileForm.timezone}
                          onChange={(e) => setProfileForm((c) => ({ ...c, timezone: e.target.value }))}
                          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                        >
                          {TIMEZONES.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="mt-8 flex items-center gap-3">
                      <button
                        type="submit"
                        disabled={saving}
                        data-testid="business-settings-save-profile"
                        className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600 disabled:opacity-50"
                      >
                        Save changes
                      </button>
                      <button
                        type="button"
                        className="text-sm font-semibold text-amber-700 hover:underline"
                        onClick={() => {
                          void loadData();
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
            </SettingsSection>

            <SettingsSection
              tabId="security"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Security"
              testId="business-settings-panel-security"
              onMobileToggle={handleMobileToggle}
            >
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900">Security &amp; authentication</h2>
                    <p className="mt-1 text-sm text-slate-500">Keep your account secure with strong authentication.</p>
                  </div>

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Active sessions</h3>
                  <div className="overflow-hidden rounded-xl border border-gray-100">
                    {sessions.length === 0 ? (
                      <p className="p-4 text-sm text-slate-500" data-testid="business-settings-sessions-empty">
                        No active sessions found.
                      </p>
                    ) : (
                      sessions.map((session, index) => (
                      <div
                        key={session.id}
                        className={`flex items-center gap-3 p-4 ${index < sessions.length - 1 ? "border-b border-gray-100" : ""}`}
                        data-testid={`business-settings-session-${session.id}`}
                      >
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gray-50 text-slate-500">
                          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            {/iphone|ipad|android/i.test(session.deviceLabel) ? (
                              <>
                                <rect x="7" y="2" width="10" height="20" rx="2" />
                                <path d="M11 18h2" />
                              </>
                            ) : (
                              <>
                                <rect x="2" y="3" width="20" height="14" rx="2" />
                                <path d="M8 21h8M12 17v4" />
                              </>
                            )}
                          </svg>
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">
                            {session.deviceLabel}
                            {session.isCurrent ? (
                              <span className="ml-1 rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                                This device
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {session.ipMasked} · {session.location} · {session.statusLabel}
                          </p>
                        </div>
                        {!session.isCurrent ? (
                          <button
                            type="button"
                            className="rounded-xl border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-gray-50"
                            data-testid={`business-settings-revoke-${session.id}`}
                            onClick={() => void handleRevokeSession(session.id)}
                          >
                            Revoke
                          </button>
                        ) : null}
                      </div>
                    ))
                    )}
                  </div>
                  <div className="mt-3">
                    <button
                      type="button"
                      data-testid="business-settings-revoke-all"
                      disabled={sessions.filter((session) => !session.isCurrent).length === 0}
                      className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-50 disabled:opacity-50"
                      onClick={() => void handleRevokeOtherSessions()}
                    >
                      Revoke all other sessions
                    </button>
                  </div>

                  <hr className="my-7 border-gray-100" />

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Login history</h3>
                  <div className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                    {loginHistory.length === 0 ? (
                      <p className="p-4 text-sm text-slate-500" data-testid="business-settings-login-history-empty">
                        No login history yet.
                      </p>
                    ) : (
                      loginHistory.map((entry) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-3" data-testid={`business-settings-login-${entry.id}`}>
                        <div className="min-w-0">
                          <p className="text-sm text-slate-700">{formatDateTime(entry.date)}</p>
                          <p className="mt-0.5 text-xs text-slate-500">
                            {entry.device} · {entry.location}
                          </p>
                        </div>
                        <span
                          className={`rounded-full px-2 py-1 text-xs font-semibold ${
                            entry.status === "Success"
                              ? "border border-green-200 bg-green-50 text-green-700"
                              : "border border-red-200 bg-red-50 text-red-700"
                          }`}
                        >
                          {entry.status}
                        </span>
                      </div>
                    ))
                    )}
                  </div>
            </SettingsSection>

            <SettingsSection
              tabId="notifications"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Notifications"
              testId="business-settings-panel-notifications"
              onMobileToggle={handleMobileToggle}
            >
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900">Notification preferences</h2>
                    <p className="mt-1 text-sm text-slate-500">Choose how and when Triven contacts you.</p>
                  </div>

                  <div className="hidden grid-cols-[1fr_5rem] gap-4 px-1 pb-3 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:grid">
                    <span>Notification</span>
                    <span className="text-center">Email</span>
                  </div>

                  {NOTIFICATION_ROWS.map((row) => {
                    const pref = notificationPrefs[row.key] ?? row.defaults;
                    return (
                      <div
                        key={row.key}
                        className="grid grid-cols-[1fr_auto] items-center gap-4 border-t border-gray-100 py-4 sm:grid-cols-[1fr_5rem]"
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                            {row.title}
                            {row.locked ? (
                              <span className="text-slate-400" title="Required for account security">
                                <LockIcon />
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-500">{row.description}</p>
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <Toggle
                            checked={pref.email}
                            disabled={pref.locked}
                            testId={`business-settings-notify-${row.key}-email`}
                            onChange={(email) =>
                              setNotificationPrefs((current) => ({
                                ...current,
                                [row.key]: { ...pref, email }
                              }))
                            }
                          />
                          <span className="text-[10px] text-slate-400 sm:hidden">Email</span>
                        </div>
                      </div>
                    );
                  })}

                  <div className="mt-7">
                    <button
                      type="button"
                      onClick={handleSaveNotifications}
                      data-testid="business-settings-save-notifications"
                      className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
                    >
                      Save preferences
                    </button>
                  </div>
            </SettingsSection>

            <SettingsSection
              tabId="integrations"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Integrations"
              testId="business-settings-panel-integrations"
              onMobileToggle={handleMobileToggle}
            >
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900">Connected services</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Manage third-party services connected to your Triven account. Agents use these integrations to perform
                      tasks.
                    </p>
                  </div>

                  <div className="space-y-3">
                    <IntegrationCard
                      name="Google Calendar"
                      description="Sync appointments and scheduling from your AI agents"
                      connected={calendarConnected}
                      connectedDetail={calendarEmail ? `Connected · since recently` : undefined}
                      testId="google-calendar"
                      icon="google-calendar"
                      onConnect={handleConnectCalendar}
                      onDisconnect={handleDisconnectCalendar}
                    />
                    <IntegrationCard
                      name="Google Business Profile"
                      description="Manage reviews, respond to customers, update business listing"
                      connected={false}
                      testId="google-business-profile"
                      icon="google-business"
                      onConnect={() => showToast("Google Business Profile connection coming soon")}
                    />
                    <IntegrationCard
                      name="Slack"
                      description="Receive real-time agent notifications in your Slack workspace"
                      connected={false}
                      testId="slack"
                      icon="slack"
                      onConnect={() => showToast("Slack connection coming soon")}
                    />
                    <IntegrationCard
                      name="Zapier"
                      description="Connect Triven to 5,000+ apps with automated workflows"
                      connected={false}
                      testId="zapier"
                      icon="zapier"
                      onConnect={() => showToast("Zapier connection coming soon")}
                    />
                    <IntegrationCard
                      name="QuickBooks"
                      description="Sync invoicing and payment data from your agents"
                      connected={false}
                      testId="quickbooks"
                      icon="quickbooks"
                      onConnect={() => showToast("QuickBooks connection coming soon")}
                    />
                  </div>
            </SettingsSection>

            <SettingsSection
              tabId="billing"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Billing"
              testId="business-settings-panel-billing"
              onMobileToggle={handleMobileToggle}
            >
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900">Billing &amp; subscription</h2>
                    <p className="mt-1 text-sm text-slate-500">Manage your plan, payment methods, and invoices.</p>
                  </div>             

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Payment method</h3>
                  {billing?.paymentMethod ? (
                    <div className="space-y-4">
                    <div className="rounded-xl border border-gray-100 p-4">
                      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <svg viewBox="0 0 48 32" className="h-8 w-12 shrink-0" aria-hidden="true">
                            <rect width="48" height="32" rx="5" fill="#fff" stroke="#E5E7EB" />
                            <text x="24" y="21" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="11" fontWeight="800" fontStyle="italic" fill="#1434CB">
                              {billing.paymentMethod.brand.toUpperCase()}
                            </text>
                          </svg>
                          <div className="min-w-0">
                            <p className="flex items-center gap-2 text-sm font-medium text-slate-800">
                              •••• •••• •••• {billing.paymentMethod.last4}
                              <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-xs font-semibold text-green-700">
                                Primary
                              </span>
                            </p>
                            <p className="mt-0.5 text-xs text-slate-500">
                              Expires {String(billing.paymentMethod.expMonth).padStart(2, "0")}/{billing.paymentMethod.expYear}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 sm:ml-auto sm:flex-none">
                          <button
                            type="button"
                            data-testid="business-settings-update-card"
                            className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-50"
                            onClick={() => setCardModalMode("primary")}
                          >
                            Update card
                          </button>
                          <button
                            type="button"
                            className="text-sm font-semibold text-amber-700 hover:underline"
                            data-testid="business-settings-add-backup-card"
                            onClick={() => setCardModalMode("backup")}
                          >
                            Add backup method
                          </button>
                        </div>
                      </div>
                    </div>
                    {billing.backupPaymentMethod ? (
                      <div className="rounded-xl border border-gray-100 bg-slate-50/60 p-4" data-testid="business-settings-backup-card">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <span className="grid h-8 w-12 shrink-0 place-items-center rounded-md border border-gray-200 bg-white text-[10px] font-extrabold uppercase text-slate-600">{billing.backupPaymentMethod.brand}</span>
                            <div>
                              <p className="flex items-center gap-2 text-sm font-medium text-slate-800">•••• •••• •••• {billing.backupPaymentMethod.last4}<span className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-500">Backup</span></p>
                              <p className="mt-0.5 text-xs text-slate-500">Expires {String(billing.backupPaymentMethod.expMonth).padStart(2, "0")}/{billing.backupPaymentMethod.expYear}</p>
                            </div>
                          </div>
                          <button type="button" disabled={makingCardPrimary} onClick={() => void handleMakeBackupCardPrimary()} className="rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50" data-testid="business-settings-make-card-primary">{makingCardPrimary ? "Updating…" : "Make primary"}</button>
                        </div>
                      </div>
                    ) : null}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-gray-100 p-4">
                      <p className="text-sm text-slate-500">No payment method on file.</p>
                      <button type="button" onClick={() => setCardModalMode("primary")} className="mt-3 rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600" data-testid="business-settings-add-card">Add payment method</button>
                    </div>
                  )}
                  <p className="mt-2 text-xs text-slate-400">Your card will be charged on the 1st of each month.</p>

                  <hr className="my-7 border-gray-100" />

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Billing address</h3>
                  {billingAddressEditing ? (
                    <form
                      className="space-y-4 rounded-xl border border-gray-100 p-4"
                      onSubmit={handleSaveBillingAddress}
                      data-testid="business-settings-billing-address-form"
                    >
                      <div>
                        <label htmlFor="billingAddress" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Address
                        </label>
                        <input
                          id="billingAddress"
                          value={billingAddressForm.address}
                          onChange={(event) =>
                            setBillingAddressForm((current) => ({ ...current, address: event.target.value }))
                          }
                          data-testid="business-settings-billing-address-input"
                          autoComplete="street-address"
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                          placeholder="Enter billing address"
                          required
                        />
                      </div>
                      <div>
                        <label htmlFor="billingPincode" className="mb-1.5 block text-sm font-medium text-slate-700">
                          Pincode
                        </label>
                        <input
                          id="billingPincode"
                          value={billingAddressForm.pincode}
                          onChange={(event) =>
                            setBillingAddressForm((current) => ({ ...current, pincode: event.target.value }))
                          }
                          data-testid="business-settings-billing-pincode-input"
                          autoComplete="postal-code"
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                          placeholder="Enter pincode"
                          required
                        />
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-50"
                          onClick={() => {
                            setBillingAddressForm({
                              address: billing?.billingAddress ?? "",
                              pincode: billing?.billingPostalCode ?? ""
                            });
                            setBillingAddressEditing(false);
                          }}
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={billingAddressSaving}
                          data-testid="business-settings-save-billing-address"
                          className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                        >
                          {billingAddressSaving ? "Saving..." : "Save address"}
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex items-start justify-between gap-4 rounded-xl border border-gray-100 p-4">
                      <address className="not-italic text-sm leading-relaxed text-slate-700">
                        {billing?.businessName ?? profileForm.businessName}
                        <br />
                        {billing?.billingAddress ?? (profileForm.address || "No billing address on file")}
                        {billing?.billingPostalCode ? (
                          <>
                            <br />
                            {billing.billingPostalCode}
                          </>
                        ) : null}
                      </address>
                      <button
                        type="button"
                        data-testid="business-settings-edit-billing-address"
                        className="shrink-0 rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-gray-50"
                        onClick={() => setBillingAddressEditing(true)}
                      >
                        Edit address
                      </button>
                    </div>
                  )}

                  <hr className="my-7 border-gray-100" />

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Recent invoices</h3>
                  {recentInvoices.length ? (
                    <div className="overflow-hidden rounded-xl border border-gray-100">
                      <table className="w-full text-sm">
                        <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
                          <tr>
                            <th className="px-4 py-3 text-left font-semibold">Date</th>
                            <th className="px-4 py-3 text-left font-semibold">Amount</th>
                            <th className="px-4 py-3 text-left font-semibold">Status</th>
                            <th className="px-4 py-3 text-right font-semibold">Invoice</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {recentInvoices.map((invoice) => (
                            <tr key={invoice.id}>
                              <td className="px-4 py-3 text-slate-700">{formatDate(invoice.createdAt)}</td>
                              <td className="px-4 py-3 text-slate-700">
                                {formatUsd(invoice.displayAmountCents ?? invoice.amountCents)}
                              </td>
                              <td className="px-4 py-3">
                                <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2 py-1 text-xs font-semibold text-green-700">
                                  <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M20 6 9 17l-5-5" />
                                  </svg>
                                  Paid
                                </span>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  aria-label={`Download invoice from ${formatDate(invoice.createdAt)}`}
                                  data-testid={`business-settings-download-invoice-${invoice.id}`}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-gray-100 hover:text-slate-700"
                                  onClick={() => showToast("Invoice downloaded")}
                                >
                                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                    <path d="M7 10l5 5 5-5" />
                                    <path d="M12 15V3" />
                                  </svg>
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">No invoices yet.</p>
                  )}
                  <Link
                    href={BUSINESS_BILLING_PATH}
                    data-testid="business-settings-view-all-invoices"
                    className="mt-3 inline-block text-sm font-semibold text-amber-700 hover:underline"
                  >
                    View all invoices
                  </Link>
            </SettingsSection>

            <SettingsSection
              tabId="privacy"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Data & Privacy"
              testId="business-settings-panel-privacy"
              onMobileToggle={handleMobileToggle}
            >
                  <div className="mb-6">
                    <h2 className="text-lg font-bold text-slate-900">Data &amp; privacy</h2>
                    <p className="mt-1 text-sm text-slate-500">Control how your data is used and manage your privacy preferences.</p>
                  </div>

                  <h3 className="mb-2 text-base font-semibold text-slate-900">Data export</h3>
                  <p className="mb-4 text-sm text-slate-500">
                    Download a ZIP containing this business&apos;s account data, agent configurations, conversation history,
                    and activity logs.
                  </p>
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      data-testid="business-settings-export-data"
                      className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50"
                      disabled={exportingData || !profileForm.businessId}
                      onClick={() => void handleExportData()}
                    >
                      {exportingData ? "Preparing export..." : "Request data export"}
                    </button>
                    <span className="text-xs text-slate-400">Last export: Never requested</span>
                  </div>

                  <hr className="my-7 border-gray-100" />

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Privacy preferences</h3>
                  <div className="space-y-1">
                    {PRIVACY_PREFS.map((row, index) => (
                      <div
                        key={row.key}
                        className={`flex items-start justify-between gap-4 py-3 ${index > 0 ? "border-t border-gray-100" : ""}`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{row.label}</p>
                          <p className="mt-0.5 text-sm text-slate-500">{row.description}</p>
                        </div>
                        <Toggle
                          checked={privacyPrefs[row.key] ?? row.defaultOn}
                          testId={`business-settings-privacy-${row.key}`}
                          onChange={(value) => setPrivacyPrefs((current) => ({ ...current, [row.key]: value }))}
                        />
                      </div>
                    ))}
                  </div>

                  <hr className="my-7 border-gray-100" />

                  <h3 className="mb-4 text-base font-semibold text-slate-900">Cookie preferences</h3>
                  <div className="space-y-1">
                    {COOKIE_PREFS.map((row, index) => (
                      <div
                        key={row.key}
                        className={`flex items-start justify-between gap-4 py-3 ${index > 0 ? "border-t border-gray-100" : ""}`}
                      >
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800">
                            {row.label}
                            {row.locked ? (
                              <span className="text-slate-400" title="Required for the platform to function">
                                <LockIcon />
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-sm text-slate-500">{row.description}</p>
                        </div>
                        <Toggle
                          checked={cookiePrefs[row.key] ?? row.defaultOn}
                          disabled={row.locked}
                          testId={`business-settings-cookie-${row.key}`}
                          onChange={(value) => setCookiePrefs((current) => ({ ...current, [row.key]: value }))}
                        />
                      </div>
                    ))}
                  </div>

                  <hr className="my-7 border-gray-100" />

                  <h3 className="mb-2 text-base font-semibold text-slate-900">Data processing agreement</h3>
                  <p className="mb-4 text-sm text-slate-500">
                    <Link
                      href={"/DPA" as Route}
                      className="font-semibold text-amber-700 hover:underline"
                      data-testid="business-settings-view-dpa"
                    >
                      View our Data Processing Agreement
                    </Link>
                  </p>
                  <button
                    type="button"
                    data-testid="business-settings-request-dpa"
                    className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50"
                    disabled={requestingDpa}
                    onClick={() => void handleRequestSignedDpa()}
                  >
                    {requestingDpa ? "Sending request..." : "Request a signed DPA for your organization"}
                  </button>
                  <p className="mt-2 text-xs text-slate-400">
                    Enterprise customers can request a countersigned DPA. Delivered within 2 business days.
                  </p>

                  <div className="mt-7">
                    <button
                      type="button"
                      onClick={handleSavePrivacy}
                      data-testid="business-settings-save-privacy"
                      className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-amber-600"
                    >
                      Save preferences
                    </button>
                  </div>
            </SettingsSection>

            <SettingsSection
              tabId="danger"
              activeTab={activeTab}
              expandedMobile={expandedMobile}
              label="Danger Zone"
              danger
              testId="business-settings-panel-danger"
              onMobileToggle={handleMobileToggle}
            >
                    <div className="mb-6">
                      <h2 className="text-lg font-bold text-red-700">Danger zone</h2>
                      <p className="mt-1 text-sm text-slate-500">
                        These actions are irreversible. Please proceed with extreme caution.
                      </p>
                    </div>

                    <div className="flex flex-col gap-4 rounded-xl border border-red-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Deactivate your account</p>
                        <p className="mt-1 text-sm text-slate-500">
                          Temporarily disable your account. All your agents will stop running immediately. Your data will
                          be preserved and you can reactivate at any time by logging back in.
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="business-settings-deactivate"
                        className="w-full shrink-0 rounded-xl border border-red-500 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 sm:w-auto"
                        onClick={() => showToast("Account deactivation coming soon")}
                      >
                        Deactivate account
                      </button>
                    </div>

                    <div className="mt-4 flex flex-col gap-4 rounded-xl border border-red-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900">Permanently delete account</p>
                        <p className="mt-1 text-sm text-slate-500">
                          This will permanently delete your account, all agent configurations, conversation history, and
                          personal data. Active agent subscriptions will be cancelled immediately. This cannot be undone.
                        </p>
                      </div>
                      <button
                        type="button"
                        data-testid="business-settings-delete-open"
                        className="w-full shrink-0 rounded-xl bg-red-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-red-600 sm:w-auto"
                        onClick={() => setDeleteModalOpen(true)}
                      >
                        Delete my account
                      </button>
                    </div>
            </SettingsSection>
          </div>
        </div>
      </main>

      {deleteModalOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          data-testid="business-settings-delete-modal"
        >
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
            aria-label="Close modal"
            onClick={() => setDeleteModalOpen(false)}
          />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <div className="flex items-start gap-4">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900">Delete your account?</h2>
                <p className="mt-1 text-sm text-slate-500">This will permanently delete:</p>
              </div>
            </div>
            <ul className="mt-4 space-y-2 text-sm text-slate-600">
              {[
                "Your profile and business information",
                "All active agent subscriptions",
                "Conversation messages and history",
                "Payment history and invoices",
                "All connected integrations"
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                  {item}
                </li>
              ))}
            </ul>
            <div className="mt-5">
              <label htmlFor="deleteConfirm" className="mb-1.5 block text-sm font-medium text-slate-700">
                Type <span className="font-semibold text-slate-900">DELETE</span> to confirm
              </label>
              <input
                id="deleteConfirm"
                data-testid="business-settings-delete-confirm-input"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm shadow-sm focus:border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-100"
                placeholder="DELETE"
              />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteModalOpen(false)}
                data-testid="business-settings-delete-cancel"
                className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deleteConfirm !== "DELETE" || deleting}
                onClick={() => void handleDeleteAccount()}
                data-testid="business-settings-delete-confirm"
                className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50"
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cardModalMode ? (
        <BusinessPaymentMethodModal
          mode={cardModalMode}
          onClose={() => setCardModalMode(null)}
          onSaved={async () => {
            const savedMode = cardModalMode;
            setCardModalMode(null);
            await loadData();
            showToast(savedMode === "backup" ? "Backup payment method added ✓" : "Payment method updated ✓");
          }}
        />
      ) : null}

      {toast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg"
          role="status"
          data-testid="business-settings-toast"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M20 6 9 17l-5-5" />
          </svg>
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function IntegrationIcon({ icon }: { icon?: string }) {
  switch (icon) {
    case "google-calendar":
      return (
        <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
          <rect x="9" y="9" width="30" height="30" rx="4" fill="#fff" stroke="#E0E0E0" />
          <path d="M9 13a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v3H9z" fill="#4285F4" />
          <rect x="14" y="6" width="3" height="6" rx="1.5" fill="#9AA0A6" />
          <rect x="31" y="6" width="3" height="6" rx="1.5" fill="#9AA0A6" />
          <text x="24" y="33" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="14" fontWeight="700" fill="#4285F4">31</text>
        </svg>
      );
    case "twilio":
      return (
        <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
          <rect x="6" y="6" width="36" height="36" rx="9" fill="#F22F46" />
          <circle cx="24" cy="24" r="11" fill="#fff" />
          <circle cx="19.5" cy="19.5" r="2.6" fill="#F22F46" />
          <circle cx="28.5" cy="19.5" r="2.6" fill="#F22F46" />
          <circle cx="19.5" cy="28.5" r="2.6" fill="#F22F46" />
          <circle cx="28.5" cy="28.5" r="2.6" fill="#F22F46" />
        </svg>
      );
    case "google-business":
      return (
        <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
          <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z" />
          <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z" />
          <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z" />
          <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z" />
        </svg>
      );
    case "slack":
      return (
        <svg viewBox="0 0 122.8 122.8" className="h-6 w-6" aria-hidden="true">
          <path d="M25.8 77.6c0 7.1-5.8 12.9-12.9 12.9S0 84.7 0 77.6s5.8-12.9 12.9-12.9h12.9v12.9z" fill="#E01E5A" />
          <path d="M32.3 77.6c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9v32.3c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V77.6z" fill="#E01E5A" />
          <path d="M45.2 25.8c-7.1 0-12.9-5.8-12.9-12.9S38.1 0 45.2 0s12.9 5.8 12.9 12.9v12.9H45.2z" fill="#36C5F0" />
          <path d="M45.2 32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H12.9C5.8 58.1 0 52.3 0 45.2s5.8-12.9 12.9-12.9h32.3z" fill="#36C5F0" />
          <path d="M97 45.2c0-7.1 5.8-12.9 12.9-12.9s12.9 5.8 12.9 12.9-5.8 12.9-12.9 12.9H97V45.2z" fill="#2EB67D" />
          <path d="M90.5 45.2c0 7.1-5.8 12.9-12.9 12.9s-12.9-5.8-12.9-12.9V12.9C64.7 5.8 70.5 0 77.6 0s12.9 5.8 12.9 12.9v32.3z" fill="#2EB67D" />
          <path d="M77.6 97c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9-12.9-5.8-12.9-12.9V97h12.9z" fill="#ECB22E" />
          <path d="M77.6 90.5c-7.1 0-12.9-5.8-12.9-12.9s5.8-12.9 12.9-12.9h32.3c7.1 0 12.9 5.8 12.9 12.9s-5.8 12.9-12.9 12.9H77.6z" fill="#ECB22E" />
        </svg>
      );
    case "zapier":
      return (
        <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
          <g stroke="#FF4F00" strokeWidth="5" strokeLinecap="round">
            <line x1="24" y1="9" x2="24" y2="39" />
            <line x1="9" y1="24" x2="39" y2="24" />
            <line x1="13.4" y1="13.4" x2="34.6" y2="34.6" />
            <line x1="34.6" y1="13.4" x2="13.4" y2="34.6" />
          </g>
        </svg>
      );
    case "quickbooks":
      return (
        <svg viewBox="0 0 48 48" className="h-7 w-7" aria-hidden="true">
          <circle cx="24" cy="24" r="19" fill="#2CA01C" />
          <text x="24" y="31" textAnchor="middle" fontFamily="Inter, Arial, sans-serif" fontSize="17" fontWeight="700" fill="#fff">qb</text>
        </svg>
      );
    default:
      return <span className="text-sm font-bold text-slate-500">?</span>;
  }
}

function IntegrationCard({
  name,
  description,
  connected,
  connectedDetail,
  testId,
  icon,
  onConnect,
  onDisconnect
}: {
  name: string;
  description: string;
  connected: boolean;
  connectedDetail?: string;
  testId: string;
  icon?: string;
  onConnect: () => void;
  onDisconnect?: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-4 rounded-xl border border-gray-100 p-4 sm:flex-row sm:items-center"
      data-testid={`business-settings-integration-${testId}`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gray-50">
          <IntegrationIcon icon={icon} />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">{name}</p>
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          <div className="mt-2 flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-green-500" : "bg-slate-300"}`} />
            <span>{connected ? connectedDetail ?? "Connected" : "Not connected"}</span>
          </div>
        </div>
      </div>
      <div className="sm:ml-auto sm:flex-none">
        {connected && onDisconnect ? (
          <button
            type="button"
            data-testid={`business-settings-integration-${testId}-disconnect`}
            className="w-full rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:border-red-200 hover:bg-red-50 hover:text-red-600 sm:w-auto"
            onClick={onDisconnect}
          >
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            data-testid={`business-settings-integration-${testId}-connect`}
            className="w-full rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 sm:w-auto"
            onClick={onConnect}
          >
            {connected ? "Manage" : "Connect"}
          </button>
        )}
      </div>
    </div>
  );
}
