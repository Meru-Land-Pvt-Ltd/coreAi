"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  ArchitectCard,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectStatusPill,
  ArchitectTextarea,
  MiniProgress,
  csvToArray,
  formatMoney
} from "./architect-ui";
import { getArchitectProfile, saveArchitectProfile } from "../features/api";
import type { ArchitectProfile } from "../features/types";

export function ArchitectProfileView() {
  const [profile, setProfile] = useState<ArchitectProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  async function loadProfile() {
    const result = await getArchitectProfile();
    if (result.success && result.data) setProfile(result.data.profile);
    setLoading(false);
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  const completion = useMemo(() => {
    if (!profile) return 0;
    const items = [profile.title, profile.bio, profile.portfolioUrl, profile.skills.length > 0, profile.hourlyRateCents];
    return Math.round((items.filter(Boolean).length / items.length) * 100);
  }, [profile]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    const formData = new FormData(event.currentTarget);
    const hourlyRate = String(formData.get("hourlyRate") ?? "");

    const result = await saveArchitectProfile({
      title: String(formData.get("title") ?? ""),
      bio: String(formData.get("bio") ?? ""),
      portfolioUrl: String(formData.get("portfolioUrl") ?? ""),
      skills: csvToArray(String(formData.get("skills") ?? "")),
      hourlyRateCents: hourlyRate ? Number(hourlyRate) * 100 : undefined
    });

    if (!result.success) {
      setMessage(result.error ?? "Profile save failed");
      return;
    }

    setMessage("Profile saved successfully");
    await loadProfile();
  }

  if (loading) {
    return (
      <ArchitectCard>
        <p className="text-sm font-bold text-amber-700">Loading profile...</p>
      </ArchitectCard>
    );
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Public Profile"
        title="Architect Profile"
        description="Make your storefront feel trustworthy with a complete profile, clear positioning, and transparent pricing."
        actionLabel="Settings"
        actionHref="/architect/settings"
      />

      {message ? (
        <div className="mb-5 rounded-2xl border border-amber-100 bg-white px-5 py-4 text-sm font-black text-amber-700 shadow-sm">{message}</div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[360px_1fr]">
        <div className="space-y-5">
          <ArchitectCard title="Profile Status">
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-20 place-items-center rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-xl font-black text-white shadow-lg shadow-amber-500/25">A</div>
              <div>
                <ArchitectStatusPill status={profile?.approvalStatus ?? "PENDING"} />
                <p className="mt-3 text-sm font-semibold text-slate-500">Marketplace approval</p>
              </div>
            </div>

            <div className="mt-6">
              <MiniProgress value={completion} label="Profile completion" />
            </div>
          </ArchitectCard>

          <ArchitectCard title="Performance Snapshot">
            <div className="space-y-4">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm font-bold text-slate-500">Hourly Rate</p>
                <h3 className="mt-1 text-2xl font-black text-slate-950">{formatMoney(profile?.hourlyRateCents)}</h3>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-amber-50 p-4 ring-1 ring-amber-100">
                  <p className="text-sm font-bold text-amber-700">Jobs</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-950">{profile?.completedJobs ?? 0}</h3>
                </div>
                <div className="rounded-2xl bg-emerald-50 p-4 ring-1 ring-emerald-100">
                  <p className="text-sm font-bold text-emerald-700">Rating</p>
                  <h3 className="mt-1 text-2xl font-black text-slate-950">{profile?.rating ?? 0}/5</h3>
                </div>
              </div>
            </div>
          </ArchitectCard>
        </div>

        <ArchitectCard title="Edit Profile" description="These details power your public storefront and proposal credibility.">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <div className="grid gap-4 lg:grid-cols-2">
              <ArchitectField name="title" label="Professional Title" placeholder="AI Workflow Architect" defaultValue={profile?.title ?? ""} required />
              <ArchitectField name="hourlyRate" label="Hourly Rate in INR" placeholder="1500" type="number" min={0} defaultValue={profile?.hourlyRateCents ? String(profile.hourlyRateCents / 100) : ""} />
            </div>
            <ArchitectTextarea name="bio" label="Bio" placeholder="Tell businesses what kind of agents and automations you build." defaultValue={profile?.bio ?? ""} minLength={10} required />
            <ArchitectField name="portfolioUrl" label="Portfolio URL" placeholder="https://yourportfolio.com" defaultValue={profile?.portfolioUrl ?? ""} />
            <ArchitectField name="skills" label="Skills comma separated" placeholder="OpenAI, CRM, Gmail, Automation, Sales" defaultValue={profile?.skills.join(", ") ?? ""} />
            <div className="flex justify-end">
              <ArchitectPrimaryButton>Save Profile</ArchitectPrimaryButton>
            </div>
          </form>
        </ArchitectCard>
      </div>
    </div>
  );
}
