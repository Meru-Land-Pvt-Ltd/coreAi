"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectTextarea,
  cn
} from "@/components/architect/ui/architect-ui";

type SettingsTab = "profile" | "storefront" | "security" | "notifications" | "developer" | "payouts" | "data";

const tabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "profile", label: "Profile" },
  { id: "storefront", label: "Public Storefront" },
  { id: "security", label: "Security" },
  { id: "notifications", label: "Notifications" },
  { id: "developer", label: "Developer Tools" },
  { id: "payouts", label: "Payouts" },
  { id: "data", label: "Data & Privacy" }
];

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button data-testid="architect-settings-toggle"
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        "relative h-6 w-11 rounded-full transition focus:outline-none focus:ring-4 focus:ring-amber-100",
        checked ? "bg-amber-500" : "bg-slate-200"
      )}
    >
      <span className="sr-only" data-testid="architect-ui-architect-settings-view-label-text">{label}</span>
      <span className={cn("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition", checked ? "left-5" : "left-0.5")} />
    </button>
  );
}

function SettingsRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="font-black text-slate-950" data-testid="architect-ui-architect-settings-view-title-text">{title}</p>
        <p className="mt-1 text-sm leading-6 text-slate-500" data-testid="architect-ui-architect-settings-view-description-text">{description}</p>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function ArchitectSettingsView() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");
  const [toast, setToast] = useState("");
  const [toggles, setToggles] = useState({
    marketplace: true,
    leads: true,
    reviews: true,
    security: true,
    api: false
  });

  const panelTitle = useMemo(() => tabs.find((tab) => tab.id === activeTab)?.label ?? "Settings", [activeTab]);

  function save(message = "Settings saved") {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Account"
        title="Settings"
        description="Manage profile details, storefront preferences, security, notifications, developer access, payouts, and data controls."
      />

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-2xl">{toast}</div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[240px_1fr]">
        <ArchitectCard className="h-fit lg:sticky lg:top-24">
          <div className="space-y-1" role="tablist" aria-label="Settings sections">
            {tabs.map((tab) => (
              <button data-testid="architect-settings-tab"
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full rounded-xl px-4 py-2.5 text-left text-sm font-bold transition",
                  activeTab === tab.id ? "bg-amber-50 text-amber-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </ArchitectCard>

        <div className="space-y-5">
          <ArchitectCard title={panelTitle} description="Reusable settings panel styled to match the provided architect-settings reference.">
            {activeTab === "profile" ? (
              <div className="space-y-5">
                <div className="flex items-center gap-5">
                  <button data-testid="architect-settings-profile-avatar" type="button" className="relative grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xl font-black text-white shadow-lg shadow-amber-500/25">
                    MT
                  </button>
                  <div>
                    <p className="font-black text-slate-950" data-testid="architect-ui-architect-settings-view-profile-photo-text">Profile photo</p>
                    <p className="mt-1 text-sm text-slate-500" data-testid="architect-ui-architect-settings-view-used-across-your-architect-account-text">Used across your architect account.</p>
                    <button data-testid="architect-settings-change-photo" type="button" className="mt-2 text-sm font-black text-amber-700">Change photo</button>
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <ArchitectField name="fullName" label="Full name" defaultValue="Marcus Thompson" />
                  <ArchitectField name="email" label="Email address" type="email" defaultValue="marcus@agentlabs.dev" />
                  <ArchitectField name="phone" label="Phone number" />
                  <ArchitectField name="location" label="Location" defaultValue="San Francisco, CA" />
                </div>
                <ArchitectPrimaryButton type="button" onClick={() => save("Profile saved")}>Save changes</ArchitectPrimaryButton>
              </div>
            ) : null}

            {activeTab === "storefront" ? (
              <div className="space-y-5">
                <ArchitectField name="storefrontName" label="Storefront name" defaultValue="AgentLabs by Marcus" />
                <ArchitectTextarea name="tagline" label="Tagline" defaultValue="Production-ready AI agents for lead capture, support, and operations." />
                <SettingsRow title="Public marketplace profile" description="Allow businesses to discover your architect storefront.">
                  <Toggle checked={toggles.marketplace} label="Public marketplace profile" onChange={() => setToggles((current) => ({ ...current, marketplace: !current.marketplace }))} />
                </SettingsRow>
                <ArchitectPrimaryButton type="button" onClick={() => save("Storefront saved")}>Save storefront</ArchitectPrimaryButton>
              </div>
            ) : null}

            {activeTab === "security" ? (
              <div className="space-y-4">
                <SettingsRow title="Two-factor authentication" description="Protect your account when publishing and receiving payouts.">
                  <Toggle checked={toggles.security} label="Two-factor authentication" onChange={() => setToggles((current) => ({ ...current, security: !current.security }))} />
                </SettingsRow>
                <SettingsRow title="Active session" description="Chrome on macOS · San Francisco · Current session">
                  <button data-testid="architect-settings-revoke-others-button" type="button" onClick={() => save("Other sessions revoked")} className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-black text-red-600">Revoke others</button>
                </SettingsRow>
                <SettingsRow title="Password" description="Last changed 38 days ago.">
                  <button data-testid="architect-settings-change-password-button" type="button" className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">Change password</button>
                </SettingsRow>
              </div>
            ) : null}

            {activeTab === "notifications" ? (
              <div className="space-y-4">
                <SettingsRow title="New buyer leads" description="Notify when a business starts setup for one of your agents.">
                  <Toggle checked={toggles.leads} label="New buyer leads" onChange={() => setToggles((current) => ({ ...current, leads: !current.leads }))} />
                </SettingsRow>
                <SettingsRow title="Reviews and ratings" description="Receive alerts when buyers leave marketplace feedback.">
                  <Toggle checked={toggles.reviews} label="Reviews and ratings" onChange={() => setToggles((current) => ({ ...current, reviews: !current.reviews }))} />
                </SettingsRow>
                <SettingsRow title="Weekly summary" description="A digest of installs, earnings, reviews, and errors.">
                  <ArchitectBadge tone="green">Enabled</ArchitectBadge>
                </SettingsRow>
              </div>
            ) : null}

            {activeTab === "developer" ? (
              <div className="space-y-4">
                <SettingsRow title="API access" description="Create test keys for custom connectors and workflow extensions.">
                  <Toggle checked={toggles.api} label="API access" onChange={() => setToggles((current) => ({ ...current, api: !current.api }))} />
                </SettingsRow>
                <div className="rounded-2xl bg-slate-950 p-4 font-mono text-xs text-slate-300">
                  <p data-testid="architect-ui-architect-settings-view-core-architect-sk-text">CORE_ARCHITECT_KEY=sk_test_••••••••••••</p>
                  <p className="mt-2 text-slate-500" data-testid="architect-ui-architect-settings-view-webhook-https-api-core-local-architect-hooks-text">Webhook: https://api.core.local/architect/hooks</p>
                </div>
                <ArchitectPrimaryButton type="button" onClick={() => save("Developer key rotated")}>Rotate key</ArchitectPrimaryButton>
              </div>
            ) : null}

            {activeTab === "payouts" ? (
              <div className="space-y-4">
                <ArchitectField name="legalName" label="Legal name" defaultValue="Marcus Thompson" />
                <ArchitectField name="bank" label="Default bank account" defaultValue="Chase ·•••• 9012" />
                <SettingsRow title="Auto payout" description="Automatically transfer available balances every month.">
                  <ArchitectBadge>Jul 1 schedule</ArchitectBadge>
                </SettingsRow>
                <ArchitectPrimaryButton type="button" onClick={() => save("Payout settings saved")}>Save payout settings</ArchitectPrimaryButton>
              </div>
            ) : null}

            {activeTab === "data" ? (
              <div className="space-y-4">
                <SettingsRow title="Export account data" description="Download storefront, listings, workflow metadata, and payout records.">
                  <button data-testid="architect-settings-export-button" type="button" onClick={() => save("Data export requested")} className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-black text-slate-700">Export</button>
                </SettingsRow>
                <SettingsRow title="Delete architect account" description="Permanently delete profile, listings, and account data after review.">
                  <button data-testid="architect-settings-request-deletion-button" type="button" className="rounded-xl border border-red-100 bg-red-50 px-4 py-2 text-sm font-black text-red-600">Request deletion</button>
                </SettingsRow>
              </div>
            ) : null}
          </ArchitectCard>
        </div>
      </div>
    </div>
  );
}
