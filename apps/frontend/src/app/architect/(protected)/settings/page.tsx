"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  deleteArchitectAccount,
  downloadArchitectDataExport,
  getArchitectSettings,
  payArchitectRefundObligations,
  pauseAllArchitectAgents,
  reactivateAllArchitectAgents,
  requestArchitectEmailChange,
  revokeArchitectSession,
  revokeOtherArchitectSessions,
  saveArchitectNotificationPrefs,
  saveArchitectPayoutSchedule,
  saveArchitectPrivacyPrefs,
  saveArchitectProfilePhoto,
  saveArchitectSettingsProfile,
  saveArchitectSettingsStorefront,
  verifyArchitectEmailChange,
  type ArchitectLoginHistoryEntry,
  type ArchitectPayoutSchedule,
  type ArchitectRefundAgent,
  type ArchitectSettingsPayload,
  type ArchitectSettingsSession
} from "@/components/architect/features/api";
import { ProfileAvatar } from "@/components/architect/ui/profile-avatar";
import { ARCHITECT_PAYOUTS_PATH } from "@/lib/routes";
import { getAuthUser, logout, saveAuthSession, updateAuthUser, type AuthUser } from "@/lib/auth";
import { readProfilePhotoFile } from "@/lib/profile-photo";

type SettingsTab =
  | "profile"
  | "storefront"
  | "security"
  | "notifications"
  | "payouts"
  | "data"
  | "danger";

const TABS: Array<{ id: SettingsTab; label: string; danger?: boolean }> = [
  { id: "profile", label: "Profile" },
  { id: "storefront", label: "Public Storefront" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "payouts", label: "Payouts" },
  { id: "data", label: "Data & Privacy" },
  { id: "danger", label: "Danger Zone", danger: true }
];

const SPECIALIZATION_TAGS = [
  "Dental",
  "Medical",
  "HVAC",
  "Legal",
  "Real Estate",
  "Fitness",
  "Restaurant",
  "E-commerce",
  "SaaS"
];

const TIMEZONES = [
  "America/Los_Angeles (Pacific Time)",
  "America/Denver (Mountain Time)",
  "America/Chicago (Central Time)",
  "America/New_York (Eastern Time)",
  "Europe/London (GMT)",
  "Asia/Kolkata (India Standard Time)"
];

const COUNTRY_CODES = [
  { code: "+1", label: "US / Canada" },
  { code: "+44", label: "United Kingdom" },
  { code: "+91", label: "India" },
  { code: "+61", label: "Australia" },
  { code: "+971", label: "UAE" },
  { code: "+65", label: "Singapore" },
  { code: "+49", label: "Germany" },
  { code: "+33", label: "France" },
  { code: "+81", label: "Japan" },
  { code: "+55", label: "Brazil" }
];

const NOTIFICATION_ROWS: Array<{
  key: string;
  title: string;
  description: string;
  locked?: boolean;
  defaults: { email: boolean; push: boolean };
}> = [
  { key: "newSale", title: "New sale", description: "When a buyer purchases one of your agents", defaults: { email: true, push: true } },
  { key: "agentSubmissionUpdates", title: "Agent submission updates", description: "Approval, rejection, or change requests from the review team", defaults: { email: true, push: true } },
  { key: "payoutProcessed", title: "Payout processed", description: "When earnings are sent to your bank account", defaults: { email: true, push: false } },
  { key: "marketplaceInsights", title: "Marketplace insights", description: "Weekly tips to optimize listings and increase sales", defaults: { email: false, push: false } },
  { key: "platformUpdates", title: "Platform updates", description: "New features, API changes, and policy updates", defaults: { email: true, push: false } },
  { key: "securityAlerts", title: "Security alerts", description: "New logins, password changes, payout method changes", defaults: { email: true, push: true }, locked: true }
];

const PRIVACY_TOGGLES = [
  { key: "showProfileOnMarketplace", label: "Show profile on marketplace", description: "Display your storefront on public agent listings." },
  { key: "showSalesCount", label: "Show sales count", description: "Display total installs on your public profile." },
  { key: "showRating", label: "Show rating", description: "Display your architect rating publicly." },
  { key: "allowBuyerMessages", label: "Allow buyer messages", description: "Let buyers contact you from listing pages." },
  { key: "analyticsCookies", label: "Analytics cookies", description: "Help us improve CORE with usage analytics." },
  { key: "marketingCookies", label: "Marketing cookies", description: "Receive personalized marketplace tips." }
];

const PRIVACY_GROUPS = [
  {
    title: "Cookie preferences",
    keys: ["analyticsCookies", "marketingCookies"]
  }
];

const DEFAULT_PAYOUT_SCHEDULE: ArchitectPayoutSchedule = {
  frequency: "Monthly",
  day: "1st",
  thresholdCents: 5000
};

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function getInitials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "A";
}

function splitPhoneNumber(value: string) {
  const phone = value.trim();
  const countryCode = COUNTRY_CODES.find((country) => phone.startsWith(`${country.code} `) || phone === country.code);

  if (!countryCode) {
    return { countryCode: COUNTRY_CODES[0]!.code, phone };
  }

  return {
    countryCode: countryCode.code,
    phone: phone.replace(countryCode.code, "").trim()
  };
}

function joinPhoneNumber(countryCode: string, phone: string) {
  const trimmedPhone = phone.trim();
  return trimmedPhone ? `${countryCode} ${trimmedPhone}` : "";
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

function PauseAgentsModal({
  open,
  pausing,
  onClose,
  onConfirm
}: {
  open: boolean;
  pausing: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="architect-settings-pause-modal">
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">Pause all agents?</h2>
        <div className="mt-3 space-y-2 text-sm text-slate-500">
          <p>All your agents will be paused.</p>
          <p>Your live listed agents will be removed from the marketplace.</p>
          <p>You can reactivate your agents anytime to go live again.</p>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50" data-testid="architect-settings-pause-cancel">Cancel</button>
          <button type="button" disabled={pausing} onClick={onConfirm} className="rounded-xl border border-amber-300 px-5 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50" data-testid="architect-settings-pause-confirm">Pause all agents</button>
        </div>
      </div>
    </div>
  );
}

function RefundModal({
  open,
  title,
  agents,
  totalCents,
  paying,
  onClose,
  onPay
}: {
  open: boolean;
  title: string;
  agents: ArchitectRefundAgent[];
  totalCents: number;
  paying: boolean;
  onClose: () => void;
  onPay: () => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="architect-settings-refund-modal">
      <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={onClose} />
      <div className="relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-bold text-slate-900">{title}</h2>
        <p className="mt-2 text-sm text-slate-500">
          You have live agents with paid installs. Refund buyers before continuing.
        </p>
        <div className="mt-4 space-y-3">
          {agents.map((agent) => (
            <div key={agent.listingId} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3" data-testid={`architect-settings-refund-agent-${agent.listingId}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{agent.listingName}</p>
                  <p className="text-xs text-slate-500">{agent.paidInstallCount} paid install{agent.paidInstallCount === 1 ? "" : "s"} · {formatUsd(agent.refundPerInstallCents)} each</p>
                </div>
                <p className="text-sm font-bold text-red-600">{formatUsd(agent.totalRefundCents)}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3">
          <span className="text-sm font-semibold text-red-700">Total refund due</span>
          <span className="text-lg font-extrabold text-red-700" data-testid="architect-settings-refund-total">{formatUsd(totalCents)}</span>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50" data-testid="architect-settings-refund-cancel">Cancel</button>
          <button type="button" disabled={paying} onClick={onPay} className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50" data-testid="architect-settings-refund-pay">Pay {formatUsd(totalCents)}</button>
        </div>
      </div>
    </div>
  );
}

function buildProfileFormFromAuth(user: AuthUser | null) {
  return {
    fullName: user?.fullName ?? "",
    phone: "",
    location: "",
    timezone: TIMEZONES[0]!
  };
}

function buildStorefrontFormFromAuth(user: AuthUser | null) {
  const fallbackName = user?.fullName ?? user?.email.split("@")[0] ?? "";
  return {
    displayName: fallbackName,
    tagline: "",
    bio: "",
    portfolioUrl: "",
    githubUrl: "",
    linkedinUrl: "",
    twitterHandle: "",
    experienceBand: "5-10",
    skills: [] as string[]
  };
}

export default function ArchitectSettingsPage() {
  const authUser = useMemo(() => getAuthUser(), []);
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [settings, setSettings] = useState<ArchitectSettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState("");
  const [saving, setSaving] = useState(false);
  const [sessions, setSessions] = useState<ArchitectSettingsSession[]>([]);
  const [loginHistory, setLoginHistory] = useState<ArchitectLoginHistoryEntry[]>([]);
  const [accountEmail, setAccountEmail] = useState(authUser?.email ?? "");
  const [emailDraft, setEmailDraft] = useState(authUser?.email ?? "");
  const [emailOtp, setEmailOtp] = useState("");
  const [emailOtpVisible, setEmailOtpVisible] = useState(false);
  const [emailChangeSending, setEmailChangeSending] = useState(false);
  const [emailChangeVerifying, setEmailChangeVerifying] = useState(false);
  const [phoneCountryCode, setPhoneCountryCode] = useState(COUNTRY_CODES[0]!.code);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);
  const [pausingAgents, setPausingAgents] = useState(false);
  const [reactivatingAgents, setReactivatingAgents] = useState(false);
  const [refundModal, setRefundModal] = useState<{
    action: "DELETE_ACCOUNT";
    agents: ArchitectRefundAgent[];
    totalCents: number;
  } | null>(null);
  const [payingRefund, setPayingRefund] = useState(false);
  const [savedProfilePhotoUrl, setSavedProfilePhotoUrl] = useState<string | null>(
    authUser?.profilePhotoUrl ?? null
  );
  const [profilePhotoPreview, setProfilePhotoPreview] = useState<string | null>(null);
  const [profilePhotoSelecting, setProfilePhotoSelecting] = useState(false);

  const [profileForm, setProfileForm] = useState(() => buildProfileFormFromAuth(authUser));

  const [storefrontForm, setStorefrontForm] = useState(() => buildStorefrontFormFromAuth(authUser));

  const [notificationPrefs, setNotificationPrefs] = useState<Record<string, { email: boolean; push: boolean; locked?: boolean }>>({});
  const [privacyPrefs, setPrivacyPrefs] = useState<Record<string, boolean>>({});
  const [payoutSchedule, setPayoutSchedule] = useState<ArchitectPayoutSchedule>(DEFAULT_PAYOUT_SCHEDULE);
  const [exportingData, setExportingData] = useState(false);

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 3000);
  }, []);

  const loadSettings = useCallback(async () => {
    const result = await getArchitectSettings();
    const localUser = getAuthUser();

    if (!result.success || !result.data) {
      if (localUser) {
        setAccountEmail(localUser.email);
        setEmailDraft(localUser.email);
        setProfileForm((current) => ({
          ...current,
          fullName: current.fullName || localUser.fullName || ""
        }));
        setStorefrontForm((current) => ({
          ...current,
          displayName: current.displayName || localUser.fullName || localUser.email.split("@")[0] || ""
        }));
      }
      return;
    }

    setSettings(result.data);
    setSessions(result.data.security.sessions);
    setLoginHistory(result.data.security.loginHistory);
    setAccountEmail(result.data.profile.email || localUser?.email || "");
    setEmailDraft(result.data.profile.email || localUser?.email || "");
    const phoneParts = splitPhoneNumber(result.data.profile.phone);
    setPhoneCountryCode(phoneParts.countryCode);
    setProfileForm({
      fullName: result.data.profile.fullName || localUser?.fullName || "",
      phone: phoneParts.phone,
      location: result.data.profile.location,
      timezone: result.data.profile.timezone || TIMEZONES[0]!
    });
    setSavedProfilePhotoUrl(result.data.profile.profilePhotoUrl ?? null);
    setProfilePhotoPreview(null);
    if (result.data.profile.profilePhotoUrl) {
      updateAuthUser({ profilePhotoUrl: result.data.profile.profilePhotoUrl });
    }
    setEmailOtp("");
    setEmailOtpVisible(false);
    setStorefrontForm({
      displayName:
        result.data.storefront.displayName ||
        result.data.profile.fullName ||
        localUser?.fullName ||
        localUser?.email.split("@")[0] ||
        "",
      tagline: result.data.storefront.tagline,
      bio: result.data.storefront.bio,
      portfolioUrl: result.data.storefront.portfolioUrl,
      githubUrl: result.data.storefront.githubUrl,
      linkedinUrl: result.data.storefront.linkedinUrl,
      twitterHandle: result.data.storefront.twitterHandle,
      experienceBand: result.data.storefront.experienceBand,
      skills: result.data.storefront.skills
    });
    setNotificationPrefs(result.data.notifications as Record<string, { email: boolean; push: boolean; locked?: boolean }>);
    setPrivacyPrefs(result.data.privacy);
    if (result.data.payoutSchedule) {
      setPayoutSchedule(result.data.payoutSchedule);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      setLoading(true);
      await loadSettings();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [loadSettings]);

  const initials = useMemo(
    () => getInitials(profileForm.fullName || accountEmail || authUser?.email || "A"),
    [profileForm.fullName, accountEmail, authUser?.email]
  );
  const storefrontInitials = useMemo(
    () => getInitials(storefrontForm.displayName || accountEmail || authUser?.email || "A"),
    [storefrontForm.displayName, accountEmail, authUser?.email]
  );
  const normalizedAccountEmail = accountEmail.trim().toLowerCase();
  const normalizedEmailDraft = emailDraft.trim().toLowerCase();
  const emailDraftChanged = Boolean(normalizedEmailDraft) && normalizedEmailDraft !== normalizedAccountEmail;
  const emailDraftValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmailDraft);

  const profilePhotoDraft = profilePhotoPreview ?? savedProfilePhotoUrl;

  async function handleProfilePhotoSelect(file: File) {
    setProfilePhotoSelecting(true);
    try {
      const photoDataUrl = await readProfilePhotoFile(file);
      setProfilePhotoPreview(photoDataUrl);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not read profile photo");
    } finally {
      setProfilePhotoSelecting(false);
    }
  }

  async function handleSaveProfile(event: FormEvent) {
    event.preventDefault();
    setSaving(true);

    let nextProfilePhotoUrl = savedProfilePhotoUrl;

    if (profilePhotoPreview) {
      const photoResult = await saveArchitectProfilePhoto(profilePhotoPreview);
      if (!photoResult.success || !photoResult.data?.profile) {
        setSaving(false);
        showToast(photoResult.error ?? "Could not save profile photo");
        return;
      }

      nextProfilePhotoUrl = photoResult.data.profile.profilePhotoUrl ?? profilePhotoPreview;
    }

    const result = await saveArchitectSettingsProfile({
      fullName: profileForm.fullName,
      phone: joinPhoneNumber(phoneCountryCode, profileForm.phone),
      location: profileForm.location,
      timezone: profileForm.timezone
    });
    setSaving(false);
    if (result.success) {
      setSavedProfilePhotoUrl(nextProfilePhotoUrl);
      setProfilePhotoPreview(null);
      updateAuthUser({
        fullName: result.data?.profile.fullName ?? profileForm.fullName,
        ...(nextProfilePhotoUrl ? { profilePhotoUrl: nextProfilePhotoUrl } : {})
      });
      showToast("Profile saved ✓");
      await loadSettings();
    } else {
      showToast(result.error ?? "Could not save profile");
    }
  }

  async function handleRequestEmailChange() {
    if (!emailDraftChanged || !emailDraftValid) {
      showToast("Enter a valid new email address");
      return;
    }

    setEmailChangeSending(true);
    const result = await requestArchitectEmailChange(normalizedEmailDraft);
    setEmailChangeSending(false);

    if (!result.success) {
      showToast(result.error ?? "Could not send verification code");
      return;
    }

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
    const result = await verifyArchitectEmailChange({
      email: normalizedEmailDraft,
      code: emailOtp.trim()
    });
    setEmailChangeVerifying(false);

    if (!result.success || !result.data) {
      showToast(result.error ?? "Could not change email");
      return;
    }

    saveAuthSession(result.data.token, {
      ...result.data.user,
      role: "ARCHITECT"
    });
    setAccountEmail(result.data.email);
    setEmailDraft(result.data.email);
    setEmailOtp("");
    setEmailOtpVisible(false);
    showToast("Email address changed ✓");
    await loadSettings();
  }

  async function handleSaveStorefront(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const result = await saveArchitectSettingsStorefront(storefrontForm);
    setSaving(false);
    if (result.success) {
      showToast("Storefront saved ✓");
      await loadSettings();
    } else {
      showToast(result.error ?? "Could not save storefront");
    }
  }

  async function handleSaveNotifications() {
    setSaving(true);
    const result = await saveArchitectNotificationPrefs(notificationPrefs);
    setSaving(false);
    if (result.success) showToast("Preferences saved ✓");
    else showToast(result.error ?? "Could not save preferences");
  }

  async function handleSavePrivacy() {
    setSaving(true);
    const result = await saveArchitectPrivacyPrefs(privacyPrefs);
    setSaving(false);
    if (result.success) showToast("Privacy settings saved ✓");
    else showToast(result.error ?? "Could not save privacy settings");
  }

  async function handleSavePayoutSchedule() {
    setSaving(true);
    const result = await saveArchitectPayoutSchedule(payoutSchedule);
    setSaving(false);
    if (result.success) {
      if (result.data?.payoutSchedule) setPayoutSchedule(result.data.payoutSchedule);
      showToast("Payout schedule saved ✓");
    } else {
      showToast(result.error ?? "Could not save payout schedule");
    }
  }

  async function handleExportData() {
    setExportingData(true);
    const result = await downloadArchitectDataExport();
    setExportingData(false);
    if (result.success) showToast("Data export downloaded ✓");
    else showToast(result.error ?? "Could not export your data");
  }

  async function handleRevokeSession(sessionId: string) {
    const result = await revokeArchitectSession(sessionId);
    if (result.success) {
      setSessions((current) => current.filter((session) => session.id !== sessionId));
      showToast("Session revoked");
    }
  }

  async function handleRevokeOthers() {
    const result = await revokeOtherArchitectSessions();
    if (result.success) {
      setSessions((current) => current.filter((session) => session.isCurrent));
      showToast("All other sessions revoked");
    }
  }

  async function handlePayRefund() {
    if (!refundModal) return;
    setPayingRefund(true);
    const result = await payArchitectRefundObligations(refundModal.action);
    setPayingRefund(false);
    if (!result.success) {
      showToast(result.error ?? "Payment failed");
      return;
    }
    showToast("Refund payment recorded ✓");
    setRefundModal(null);
    await executeDeleteAccount();
  }

  async function executePauseAgents() {
    setPausingAgents(true);
    const result = await pauseAllArchitectAgents();
    setPausingAgents(false);
    if (result.success && result.data?.paused) {
      setPauseModalOpen(false);
      showToast("All agents paused");
      await loadSettings();
      return;
    }
    showToast(result.error ?? "Could not pause agents");
  }

  async function executeReactivateAgents() {
    setReactivatingAgents(true);
    const result = await reactivateAllArchitectAgents();
    setReactivatingAgents(false);
    if (result.success && result.data?.reactivated) {
      showToast("All agents are live again");
      await loadSettings();
      return;
    }
    showToast(result.error ?? "Could not reactivate agents");
  }

  async function executeDeleteAccount() {
    const result = await deleteArchitectAccount("DELETE");
    if (result.success && result.data?.deleted) {
      logout();
      return;
    }
    if (result.data?.requiresPayment && result.data.obligations) {
      setRefundModal({
        action: "DELETE_ACCOUNT",
        agents: result.data.obligations.agents,
        totalCents: result.data.obligations.totalRefundCents
      });
      return;
    }
    showToast(result.error ?? "Could not delete account");
  }

  function toggleSkill(tag: string) {
    setStorefrontForm((current) => {
      const selected = current.skills.includes(tag);
      if (!selected && current.skills.length >= 5) {
        showToast("Maximum 5 tags");
        return current;
      }
      return {
        ...current,
        skills: selected ? current.skills.filter((item) => item !== tag) : [...current.skills, tag]
      };
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-6" data-testid="architect-settings-loading">
        <div className="mx-auto max-w-6xl animate-pulse space-y-6">
          <div className="h-10 w-64 rounded-xl bg-white" />
          <div className="h-96 rounded-2xl bg-white" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-slate-900">
      <header className="sticky top-0 z-30 border-b border-gray-100 bg-white px-5 py-4 backdrop-blur lg:px-8">
        <h1 className="text-xl font-extrabold tracking-tight text-slate-900" data-testid="architect-settings-title">Settings</h1>
        <p className="hidden text-sm text-slate-500 sm:block">Manage your account, storefront, and agent business.</p>
      </header>

      <main className="px-5 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 lg:flex-row lg:gap-8">
          <div className="hidden w-56 shrink-0 lg:block">
            <div role="tablist" aria-label="Settings sections" className="sticky top-24 space-y-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  data-testid={`architect-settings-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full rounded-xl px-4 py-2.5 text-left text-sm font-medium transition ${
                    activeTab === tab.id
                      ? tab.danger
                        ? "border-l-2 border-red-500 bg-red-50 font-semibold text-red-700"
                        : "border-l-2 border-amber-500 bg-amber-50 font-semibold text-amber-700"
                      : tab.danger
                        ? "border-l-2 border-transparent text-red-600 hover:bg-gray-50"
                        : "border-l-2 border-transparent text-slate-600 hover:bg-gray-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold ${activeTab === tab.id ? "bg-amber-500 text-white" : "bg-white text-slate-600"}`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === "profile" ? (
              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-settings-panel-profile">
                <h2 className="text-lg font-bold text-slate-900">Personal Information</h2>
                <p className="mt-1 text-sm text-slate-500">Your private account details. Not shown publicly.</p>
                <form onSubmit={handleSaveProfile} className="mt-6 space-y-6">
                  <div className="flex items-center gap-5">
                    <ProfileAvatar
                      photoUrl={profilePhotoDraft}
                      initials={initials}
                      testId="architect-settings-profile-avatar"
                    />
                    <div className="text-sm text-slate-500">
                      <p className="font-medium text-slate-700">Profile photo</p>
                      <p>JPG or PNG, up to 2MB. Saved when you click Save changes.</p>
                      <label className="mt-2 inline-flex cursor-pointer rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-gray-50">
                        {profilePhotoSelecting ? "Loading preview..." : "Upload photo"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg"
                          className="sr-only"
                          disabled={profilePhotoSelecting || saving}
                          data-testid="architect-settings-profile-photo"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            event.target.value = "";
                            if (file) void handleProfilePhotoSelect(file);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="fullName" className="mb-1.5 block text-sm font-medium text-slate-700">Full name</label>
                      <input id="fullName" data-testid="architect-settings-full-name" value={profileForm.fullName} onChange={(e) => setProfileForm((c) => ({ ...c, fullName: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" />
                    </div>
                    <div>
                      <label htmlFor="email" className="mb-1.5 block text-sm font-medium text-slate-700">Email address</label>
                      <div className="relative">
                        <input
                          id="email"
                          type="email"
                          value={emailDraft}
                          data-testid="architect-settings-email"
                          onChange={(event) => {
                            setEmailDraft(event.target.value);
                            setEmailOtp("");
                            setEmailOtpVisible(false);
                          }}
                          className="w-full rounded-xl border border-gray-200 px-4 py-3 pr-24 text-sm"
                        />
                        <span className={`absolute right-2 top-1/2 -translate-y-1/2 rounded-full border px-2 py-1 text-[11px] font-semibold ${emailDraftChanged ? "border-amber-200 bg-amber-50 text-amber-700" : "border-green-200 bg-green-50 text-green-700"}`}>
                          {emailDraftChanged ? "New" : "Verified ✓"}
                        </span>
                      </div>
                      {emailDraftChanged ? (
                        <button
                          type="button"
                          onClick={() => void handleRequestEmailChange()}
                          disabled={!emailDraftValid || emailChangeSending}
                          className="mt-2 text-xs font-semibold text-amber-700 transition hover:text-amber-800 disabled:cursor-not-allowed disabled:text-slate-400"
                          data-testid="architect-settings-change-email"
                        >
                          {emailChangeSending ? "Sending code..." : "Change email"}
                        </button>
                      ) : null}
                      {emailOtpVisible ? (
                        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                          <p className="mb-2 text-xs text-amber-900">
                            We sent a 6-digit code to <span className="font-semibold">{normalizedEmailDraft}</span>. Check your inbox and spam folder.
                          </p>
                          <label htmlFor="emailOtp" className="mb-1.5 block text-xs font-semibold text-amber-900">Enter verification code</label>
                          <div className="flex flex-wrap gap-2">
                            <input
                              id="emailOtp"
                              value={emailOtp}
                              inputMode="numeric"
                              maxLength={6}
                              onChange={(event) => setEmailOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                              className="w-36 rounded-xl border border-amber-200 bg-white px-4 py-2.5 font-mono text-sm tracking-[0.35em] text-slate-900"
                              data-testid="architect-settings-email-otp"
                            />
                            <button
                              type="button"
                              onClick={() => void handleVerifyEmailChange()}
                              disabled={emailOtp.length !== 6 || emailChangeVerifying}
                              className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
                              data-testid="architect-settings-verify-email"
                            >
                              {emailChangeVerifying ? "Verifying..." : "Verify"}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleRequestEmailChange()}
                              disabled={emailChangeSending}
                              className="rounded-xl border border-amber-200 bg-white px-4 py-2.5 text-sm font-semibold text-amber-700 transition hover:bg-amber-100 disabled:opacity-50"
                              data-testid="architect-settings-resend-email-otp"
                            >
                              {emailChangeSending ? "Sending..." : "Resend code"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                    <div>
                      <label htmlFor="phone" className="mb-1.5 block text-sm font-medium text-slate-700">Phone number</label>
                      <div className="flex">
                        <select
                          aria-label="Country code"
                          value={phoneCountryCode}
                          onChange={(event) => setPhoneCountryCode(event.target.value)}
                          className="w-32 rounded-l-xl border border-r-0 border-gray-200 bg-slate-50 px-3 py-3 text-sm font-medium text-slate-600"
                          data-testid="architect-settings-phone-country-code"
                        >
                          {COUNTRY_CODES.map((country) => (
                            <option key={country.code} value={country.code}>{country.code} {country.label}</option>
                          ))}
                        </select>
                        <input id="phone" data-testid="architect-settings-phone" value={profileForm.phone} onChange={(e) => setProfileForm((c) => ({ ...c, phone: e.target.value }))} className="w-full rounded-r-xl border border-gray-200 px-4 py-3 text-sm" />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="location" className="mb-1.5 block text-sm font-medium text-slate-700">Location</label>
                      <input id="location" data-testid="architect-settings-location" value={profileForm.location} onChange={(e) => setProfileForm((c) => ({ ...c, location: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="timezone" className="mb-1.5 block text-sm font-medium text-slate-700">Timezone</label>
                      <select id="timezone" data-testid="architect-settings-timezone" value={profileForm.timezone} onChange={(e) => setProfileForm((c) => ({ ...c, timezone: e.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
                        {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
                      </select>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button type="submit" disabled={saving} data-testid="architect-settings-save-profile" className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">Save changes</button>
                    <button type="button" onClick={() => void loadSettings()} className="text-sm font-medium text-slate-500 hover:text-slate-700">Cancel</button>
                  </div>
                </form>
              </section>
            ) : null}

            {activeTab === "storefront" ? (
              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-settings-panel-storefront">
                <h2 className="text-lg font-bold text-slate-900">Public Profile &amp; Storefront</h2>
                <p className="mt-1 text-sm text-slate-500">This is how buyers see you on the CORE marketplace. Make it count.</p>
                <form onSubmit={handleSaveStorefront} className="mt-6 space-y-8">
                  <div>
                    <h3 className="mb-4 text-base font-semibold text-slate-900">Display identity</h3>
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="displayName" className="mb-1.5 block text-sm font-medium text-slate-700">Display name</label>
                      <input id="displayName" data-testid="architect-settings-display-name" value={storefrontForm.displayName} onChange={(e) => setStorefrontForm((c) => ({ ...c, displayName: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" />
                      <p className="mt-1.5 text-xs text-slate-400">This appears on all your agent listings.</p>
                    </div>
                    <div className="sm:col-span-2 flex flex-wrap items-center gap-5">
                      <div className="flex h-[100px] w-[100px] shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-2xl font-bold text-white" data-testid="architect-settings-storefront-avatar">{storefrontInitials}</div>
                      <div>
                        <p className="text-sm font-medium text-slate-700">Marketplace photo</p>
                        <label className="mt-2 inline-flex cursor-pointer rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50">
                          Upload marketplace photo
                          <input
                            type="file"
                            accept="image/png,image/jpeg"
                            className="sr-only"
                            data-testid="architect-settings-marketplace-photo"
                            onChange={(event) => {
                              if (event.target.files?.[0]) showToast("Marketplace photo selected");
                            }}
                          />
                        </label>
                        <p className="mt-1.5 text-xs text-slate-400">Recommended: professional headshot, 400x400px minimum.</p>
                      </div>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="inline-flex items-center gap-1.5 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm font-semibold text-green-700">
                        Identity Verified
                      </span>
                    </div>
                    {settings?.storefront ? (
                      <div className="sm:col-span-2 rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5" data-testid="architect-settings-storefront-tier">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <span className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 px-3 py-1.5 text-sm font-bold text-white shadow-sm shadow-amber-200">
                            {settings.storefront.approvalStatus === "APPROVED" ? "Gold Architect" : "Architect"}
                          </span>
                          <span className="text-sm text-slate-500">
                            Rating <span className="font-semibold text-slate-700">{settings.storefront.rating.toFixed(1)}</span>
                            · {settings.storefront.completedJobs} completed jobs
                          </span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                  </div>
                  <div className="border-t border-gray-100 pt-7">
                    <h3 className="mb-4 text-base font-semibold text-slate-900">Bio &amp; expertise</h3>
                    <div className="grid gap-5 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label htmlFor="tagline" className="mb-1.5 block text-sm font-medium text-slate-700">Tagline</label>
                      <input id="tagline" maxLength={80} data-testid="architect-settings-tagline" value={storefrontForm.tagline} onChange={(e) => setStorefrontForm((c) => ({ ...c, tagline: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" />
                      <p className="mt-1.5 text-right text-xs text-slate-400">{storefrontForm.tagline.length}/80</p>
                    </div>
                    <div className="sm:col-span-2">
                      <label htmlFor="bio" className="mb-1.5 block text-sm font-medium text-slate-700">Full bio</label>
                      <textarea id="bio" rows={4} maxLength={500} data-testid="architect-settings-bio" value={storefrontForm.bio} onChange={(e) => setStorefrontForm((c) => ({ ...c, bio: e.target.value }))} className="w-full resize-y rounded-xl border border-gray-200 px-4 py-3 text-sm" />
                      <p className="mt-1.5 text-right text-xs text-slate-400">{storefrontForm.bio.length}/500</p>
                    </div>
                    <div className="sm:col-span-2">
                      <span className="mb-2 block text-sm font-medium text-slate-700">Specialization tags (max 5)</span>
                      <div className="flex flex-wrap gap-2">
                        {SPECIALIZATION_TAGS.map((tag) => {
                          const selected = storefrontForm.skills.includes(tag);
                          return (
                            <button key={tag} type="button" data-testid={`architect-settings-tag-${tag.toLowerCase()}`} onClick={() => toggleSkill(tag)} className={`rounded-full border px-3.5 py-1.5 text-[13px] font-semibold transition ${selected ? "border-amber-300 bg-amber-50 text-amber-700" : "border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100"}`}>{tag}</button>
                          );
                        })}
                      </div>
                    </div>
                    <div className="sm:max-w-xs">
                      <label htmlFor="experience" className="mb-1.5 block text-sm font-medium text-slate-700">Years of experience</label>
                      <select id="experience" data-testid="architect-settings-experience" value={storefrontForm.experienceBand} onChange={(e) => setStorefrontForm((c) => ({ ...c, experienceBand: e.target.value }))} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm">
                        {["1–2", "3–5", "5–10", "10+"].map((band) => <option key={band} value={band}>{band}</option>)}
                      </select>
                    </div>
                    </div>
                  </div>
                  <div className="border-t border-gray-100 pt-7">
                    <h3 className="mb-4 text-base font-semibold text-slate-900">Links</h3>
                    <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="portfolio" className="mb-1.5 block text-sm font-medium text-slate-700">Portfolio website</label>
                      <input id="portfolio" data-testid="architect-settings-portfolio" value={storefrontForm.portfolioUrl} onChange={(e) => setStorefrontForm((c) => ({ ...c, portfolioUrl: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" />
                    </div>
                    <div>
                      <label htmlFor="github" className="mb-1.5 block text-sm font-medium text-slate-700">GitHub profile</label>
                      <input id="github" data-testid="architect-settings-github" value={storefrontForm.githubUrl} onChange={(e) => setStorefrontForm((c) => ({ ...c, githubUrl: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" />
                    </div>
                    <div>
                      <label htmlFor="linkedin" className="mb-1.5 block text-sm font-medium text-slate-700">LinkedIn</label>
                      <input id="linkedin" data-testid="architect-settings-linkedin" value={storefrontForm.linkedinUrl} onChange={(e) => setStorefrontForm((c) => ({ ...c, linkedinUrl: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" />
                    </div>
                    <div>
                      <label htmlFor="twitter" className="mb-1.5 block text-sm font-medium text-slate-700">Twitter / X</label>
                      <input id="twitter" data-testid="architect-settings-twitter" value={storefrontForm.twitterHandle} onChange={(e) => setStorefrontForm((c) => ({ ...c, twitterHandle: e.target.value }))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" />
                    </div>
                  </div>
                  </div>
                  <button type="submit" disabled={saving} data-testid="architect-settings-save-storefront" className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">Save storefront</button>
                </form>
              </section>
            ) : null}

            {activeTab === "security" ? (
              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-settings-panel-security">
                <h2 className="text-lg font-bold text-slate-900">Security</h2>
                <p className="mt-1 text-sm text-slate-500">Active sessions and login history for your architect account.</p>
                <div className="mt-8 border-t border-gray-100 pt-7">
                  <h3 className="mb-4 text-base font-semibold text-slate-900">Active sessions</h3>
                  <div className="space-y-3">
                    {sessions.map((session) => (
                      <div key={session.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 px-4 py-3" data-testid={`architect-settings-session-${session.id}`}>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-800">
                            {session.deviceLabel}
                            {session.isCurrent ? <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">This device</span> : null}
                          </p>
                          <p className="font-mono text-xs text-slate-400">{session.ipMasked} · {session.location}</p>
                        </div>
                        {session.isCurrent ? (
                          <span className="text-xs font-semibold text-green-600">{session.statusLabel}</span>
                        ) : (
                          <button type="button" onClick={() => void handleRevokeSession(session.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:text-red-700" data-testid={`architect-settings-revoke-session-${session.id}`}>Revoke</button>
                        )}
                      </div>
                    ))}
                  </div>
                  <button type="button" onClick={() => void handleRevokeOthers()} className="mt-4 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50" data-testid="architect-settings-revoke-other-sessions">Revoke all other sessions</button>
                </div>
                <div className="mt-8 border-t border-gray-100 pt-7">
                  <h3 className="mb-4 text-base font-semibold text-slate-900">Login history</h3>
                  <div className="overflow-x-auto">
                    <table className="min-w-[520px] w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-slate-400">
                          <th className="py-2 font-semibold">Date</th>
                          <th className="py-2 font-semibold">Device</th>
                          <th className="py-2 font-semibold">Location</th>
                          <th className="py-2 font-semibold">Status</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-600">
                        {loginHistory.map((entry) => (
                          <tr key={entry.id} className="border-b border-gray-50" data-testid={`architect-settings-login-${entry.id}`}>
                            <td className="py-2.5">{formatDateTime(entry.date)}</td>
                            <td>{entry.device}</td>
                            <td>{entry.location}</td>
                            <td className={entry.status === "Success" ? "font-medium text-green-600" : "font-medium text-red-600"}>{entry.status}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === "notifications" ? (
              <section className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-settings-panel-notifications">
                <h2 className="text-lg font-bold text-slate-900">Notification Preferences</h2>
                <p className="mt-1 text-sm text-slate-500">Choose how and when CORE contacts you about your agent business.</p>
                <div className="mt-6 overflow-x-auto">
                  <table className="min-w-[560px] w-full">
                    <thead>
                      <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-slate-400">
                        <th className="py-3 font-semibold">Notification type</th>
                        <th className="w-24 py-3 text-center font-semibold">Email</th>
                        {/* Push notifications section commented out
                        <th className="w-24 py-3 text-center font-semibold">Push</th>
                        */}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {NOTIFICATION_ROWS.map((row) => {
                        const pref = notificationPrefs[row.key] ?? row.defaults;
                        return (
                          <tr key={row.key}>
                            <td className="py-3.5 pr-4">
                              <p className="text-sm font-medium text-slate-800">{row.title}{row.locked ? " · Required" : ""}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{row.description}</p>
                            </td>
                            <td className="py-3.5 text-center">
                              <div className="flex justify-center">
                                <Toggle checked={pref.email ?? row.defaults.email} disabled={row.locked} onChange={(email) => setNotificationPrefs((c) => ({ ...c, [row.key]: { ...pref, email } }))} testId={`architect-settings-notify-email-${row.key}`} />
                              </div>
                            </td>
                            {/* Push notifications section commented out
                            <td className="py-3.5 text-center">
                              <div className="flex justify-center">
                                <Toggle checked={pref.push ?? row.defaults.push} disabled={row.locked} onChange={(push) => setNotificationPrefs((c) => ({ ...c, [row.key]: { ...pref, push } }))} testId={`architect-settings-notify-push-${row.key}`} />
                              </div>
                            </td>
                            */}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <button type="button" onClick={() => void handleSaveNotifications()} disabled={saving} data-testid="architect-settings-save-notifications" className="mt-6 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">Save preferences</button>
              </section>
            ) : null}

            {activeTab === "payouts" ? (
              <section className="space-y-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-settings-panel-payouts">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Payout Settings</h2>
                  <p className="mt-1 text-sm text-slate-500">Manage how and when you receive earnings from agent sales.</p>
                </div>
                <div>
                  <h3 className="mb-4 text-base font-semibold text-slate-900">Payout method</h3>
                  <div className="rounded-2xl border border-gray-200 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        {settings?.payouts.payoutMethod ? (
                          <>
                            <p className="text-sm font-semibold text-slate-900">{settings.payouts.payoutMethod.bankName}</p>
                            <p className="mt-0.5 font-mono text-xs text-slate-500">Account •••• {settings.payouts.payoutMethod.accountLast4}</p>
                            {settings.payouts.payoutMethod.routingLast4 ? (
                              <p className="font-mono text-xs text-slate-500">
                                {settings.payouts.payoutMethod.routingLabel} •••• {settings.payouts.payoutMethod.routingLast4}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <p className="text-sm text-slate-500">No payout method on file.</p>
                        )}
                      </div>
                      {settings?.payouts.payoutMethod?.verified ? (
                        <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-[11px] font-semibold text-green-700">Verified ✓</span>
                      ) : null}
                    </div>
                    <button type="button" onClick={() => showToast("Payout method update requested")} className="mt-4 rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50">Update bank account</button>
                  </div>
                  <Link href={ARCHITECT_PAYOUTS_PATH} className="mt-3 inline-block text-sm font-semibold text-amber-700 hover:text-amber-800">+ Add backup payout method</Link>
                </div>
                <div className="border-t border-gray-100 pt-7">
                  <h3 className="mb-4 text-base font-semibold text-slate-900">Payout schedule</h3>
                  <div className="grid gap-5 sm:grid-cols-3">
                    <div>
                      <label htmlFor="payoutFrequency" className="mb-1.5 block text-sm font-medium text-slate-700">Frequency</label>
                      <select
                        id="payoutFrequency"
                        value={payoutSchedule.frequency}
                        onChange={(e) => setPayoutSchedule((c) => ({ ...c, frequency: e.target.value as ArchitectPayoutSchedule["frequency"] }))}
                        data-testid="architect-settings-payout-frequency"
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm"
                      >
                        <option value="Weekly">Weekly</option>
                        <option value="Bi-weekly">Bi-weekly</option>
                        <option value="Monthly">Monthly</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="payoutDay" className="mb-1.5 block text-sm font-medium text-slate-700">Payout day</label>
                      <select
                        id="payoutDay"
                        value={payoutSchedule.day}
                        onChange={(e) => setPayoutSchedule((c) => ({ ...c, day: e.target.value as ArchitectPayoutSchedule["day"] }))}
                        data-testid="architect-settings-payout-day"
                        className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm"
                      >
                        <option value="1st">1st</option>
                        <option value="15th">15th</option>
                        <option value="Last day of month">Last day of month</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="payoutThreshold" className="mb-1.5 block text-sm font-medium text-slate-700">Minimum threshold</label>
                      <div className="flex">
                        <span className="inline-flex items-center rounded-l-xl border border-r-0 border-gray-200 bg-slate-50 px-3 text-sm font-medium text-slate-500">$</span>
                        <input
                          id="payoutThreshold"
                          value={(payoutSchedule.thresholdCents / 100).toFixed(2)}
                          onChange={(e) => {
                            const dollars = Number.parseFloat(e.target.value.replace(/[^0-9.]/g, ""));
                            setPayoutSchedule((c) => ({ ...c, thresholdCents: Number.isFinite(dollars) ? Math.round(dollars * 100) : 0 }));
                          }}
                          inputMode="decimal"
                          data-testid="architect-settings-payout-threshold"
                          className="w-full rounded-r-xl border border-gray-200 px-4 py-3 text-sm"
                        />
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-slate-400">Earnings below this amount roll over to the next payout period.</p>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                    <span className="text-sm text-slate-700">Next scheduled payout</span>
                    <span className="text-sm font-bold text-amber-700">{settings?.payouts.lastPayoutAt ? `Last paid ${formatDateTime(settings.payouts.lastPayoutAt)}` : "Pending first payout"}</span>
                  </div>
                  <button type="button" onClick={() => void handleSavePayoutSchedule()} disabled={saving} data-testid="architect-settings-save-payout-schedule" className="mt-5 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50">Save schedule</button>
                </div>
                <div className="border-t border-gray-100 pt-7">
                  <h3 className="mb-4 text-base font-semibold text-slate-900">Tax information</h3>
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="inline-flex items-center gap-1 rounded-full border border-green-200 bg-green-50 px-3 py-1.5 text-sm font-semibold text-green-700">W-9 on file ✓</span>
                      <span className="text-xs text-slate-400">Submitted profile verification</span>
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button type="button" onClick={() => showToast("Tax update requested")} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50">Update W-9</button>
                      <button type="button" onClick={() => showToast("Downloading tax form")} className="text-sm font-semibold text-amber-700 hover:text-amber-800">Download 1099-K →</button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-slate-400">CORE reports earnings for architects crossing annual reporting thresholds.</p>
                </div>
                <div className="border-t border-gray-100 pt-7">
                  <h3 className="mb-4 text-base font-semibold text-slate-900">Revenue split</h3>
                  <div className="rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-white p-5">
                  <div className="flex items-center gap-4">
                    <div className="text-center"><div className="text-2xl font-extrabold text-amber-600">{settings?.payouts.architectSharePercent ?? 70}%</div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">You</div></div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200"><div className="h-full bg-gradient-to-r from-amber-400 to-amber-600" style={{ width: `${settings?.payouts.architectSharePercent ?? 70}%` }} /></div>
                    <div className="text-center"><div className="text-2xl font-extrabold text-slate-400">{100 - (settings?.payouts.architectSharePercent ?? 70)}%</div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">CORE</div></div>
                  </div>
                    <p className="mt-4 text-sm text-slate-600">This applies to all agent sales and covers hosting, marketplace listing, payment processing, and customer support infrastructure.</p>
                    <Link href={ARCHITECT_PAYOUTS_PATH} className="mt-3 inline-block text-sm font-semibold text-amber-700 hover:text-amber-800">View full fee schedule →</Link>
                  </div>
                </div>
                <Link href={ARCHITECT_PAYOUTS_PATH} className="inline-block text-sm font-semibold text-amber-700 hover:text-amber-800" data-testid="architect-settings-open-payouts">Open full payouts page →</Link>
              </section>
            ) : null}

            {activeTab === "data" ? (
              <section className="space-y-8 rounded-2xl border border-gray-100 bg-white p-6 shadow-sm" data-testid="architect-settings-panel-data">
                <div>
                  <h2 className="text-lg font-bold text-slate-900">Data &amp; Privacy</h2>
                  <p className="mt-1 text-sm text-slate-500">Control your data, privacy preferences, and marketplace visibility.</p>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900">Data export</h3>
                  <p className="mt-1 text-sm text-slate-500">Download a copy of your account data, storefront, listing metadata, sales history, and payout records. Agent source code and conversation logs are not included.</p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button type="button" onClick={() => void handleExportData()} disabled={exportingData} className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-gray-50 disabled:opacity-50" data-testid="architect-settings-request-export">{exportingData ? "Preparing export…" : "Export data"}</button>
                    <span className="text-xs text-slate-400">Downloaded instantly as a ZIP file.</span>
                  </div>
                </div>
                {PRIVACY_GROUPS.map((group) => (
                  <div key={group.title} className="border-t border-gray-100 pt-7">
                    <h3 className="mb-4 text-base font-semibold text-slate-900">{group.title}</h3>
                    <div className="space-y-1">
                      {PRIVACY_TOGGLES.filter((item) => group.keys.includes(item.key)).map((item) => (
                        <div key={item.key} className="flex items-start justify-between gap-4 rounded-xl px-3 py-3 hover:bg-gray-50">
                          <div>
                            <p className="text-sm font-medium text-slate-800">{item.label}</p>
                            <p className="text-xs text-slate-500">{item.description}</p>
                          </div>
                          <Toggle checked={privacyPrefs[item.key] ?? false} onChange={(value) => setPrivacyPrefs((c) => ({ ...c, [item.key]: value }))} testId={`architect-settings-privacy-${item.key}`} />
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
                <div className="border-t border-gray-100 pt-7">
                  <h3 className="mb-2 text-base font-semibold text-slate-900">Data Processing Agreement</h3>
                  <p className="text-sm text-slate-500">As an architect processing buyer data through your agents, you are bound by the CORE DPA.</p>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <button type="button" onClick={() => showToast("Opening DPA")} className="text-sm font-semibold text-amber-700 hover:text-amber-800">View Data Processing Agreement →</button>
                    <button type="button" onClick={() => showToast("DPA download requested")} className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50">Download your executed DPA</button>
                  </div>
                </div>
                <div className="border-t border-gray-100 pt-6">
                  <button type="button" onClick={() => void handleSavePrivacy()} disabled={saving} data-testid="architect-settings-save-privacy" className="rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50">Save changes</button>
                </div>
              </section>
            ) : null}

            {activeTab === "danger" ? (
              <section className="rounded-2xl border-2 border-red-200 bg-red-50/50 p-6" data-testid="architect-settings-panel-danger">
                <h2 className="text-lg font-bold text-red-700">Danger Zone</h2>
                <p className="mt-1 text-sm text-red-600/80">These actions affect your published agents and buyer access.</p>
                <div className="mt-6 space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-red-100 bg-white p-5">
                    <div className="max-w-xl">
                      <p className="text-sm font-semibold text-slate-900">Pause all published agents</p>
                      <p className="mt-1 text-sm text-slate-500">Remove your live agents from the marketplace. You can make them live again at any time.</p>
                      {settings?.danger.allAgentsPaused ? <p className="mt-2 text-xs font-semibold text-amber-700">All agents are currently paused.</p> : null}
                    </div>
                    {settings?.danger.allAgentsPaused ? (
                      <button
                        type="button"
                        disabled={reactivatingAgents}
                        onClick={() => void executeReactivateAgents()}
                        className="shrink-0 rounded-xl border border-green-300 px-5 py-2.5 text-sm font-semibold text-green-700 hover:bg-green-50 disabled:opacity-50"
                        data-testid="architect-settings-reactivate-all-agents"
                      >
                        Make your agents live
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!settings?.danger.hasPausableAgents}
                        onClick={() => setPauseModalOpen(true)}
                        className="shrink-0 rounded-xl border border-amber-300 px-5 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50"
                        data-testid="architect-settings-pause-all-agents"
                      >
                        Pause all agents
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-red-100 bg-white p-5">
                    <div className="max-w-xl">
                      <p className="text-sm font-semibold text-slate-900">Permanently delete account</p>
                      <p className="mt-1 text-sm text-slate-500">Permanently delete your architect account, all agent source code, analytics data, storefront, and conversation history. This cannot be undone.</p>
                    </div>
                    <button type="button" onClick={() => setDeleteModalOpen(true)} className="shrink-0 rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-600" data-testid="architect-settings-open-delete">Delete my account</button>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
        </div>
      </main>

      {deleteModalOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" role="dialog" aria-modal="true" data-testid="architect-settings-delete-modal">
          <button type="button" className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" aria-label="Close modal" onClick={() => setDeleteModalOpen(false)} />
          <div className="relative w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
            <h2 className="text-lg font-bold text-slate-900">Delete your architect account?</h2>
            <p className="mt-2 text-sm text-slate-500">Type DELETE to confirm permanent deletion.</p>
            <input value={deleteConfirm} onChange={(e) => setDeleteConfirm(e.target.value)} className="mt-5 w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" placeholder="DELETE" data-testid="architect-settings-delete-confirm" />
            <div className="mt-6 flex justify-end gap-3">
              <button type="button" onClick={() => setDeleteModalOpen(false)} className="rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-700">Cancel</button>
              <button type="button" disabled={deleteConfirm !== "DELETE"} onClick={() => void executeDeleteAccount()} className="rounded-xl bg-red-500 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-40" data-testid="architect-settings-confirm-delete">Permanently delete</button>
            </div>
          </div>
        </div>
      ) : null}

      <PauseAgentsModal
        open={pauseModalOpen}
        pausing={pausingAgents}
        onClose={() => setPauseModalOpen(false)}
        onConfirm={() => void executePauseAgents()}
      />

      <RefundModal
        open={Boolean(refundModal)}
        title="Pay refunds before deleting account"
        agents={refundModal?.agents ?? []}
        totalCents={refundModal?.totalCents ?? 0}
        paying={payingRefund}
        onClose={() => setRefundModal(null)}
        onPay={() => void handlePayRefund()}
      />

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-[90] -translate-x-1/2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-2xl" data-testid="architect-settings-toast">{toast}</div>
      ) : null}
    </div>
  );
}
