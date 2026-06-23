"use client";

import { FormEvent, useEffect, useState } from "react";
import {
  ArchitectCard,
  ArchitectField,
  ArchitectPageHeader,
  ArchitectPrimaryButton,
  ArchitectStatusPill,
  ArchitectTextarea,
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

    if (result.success && result.data) {
      setProfile(result.data.profile);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadProfile();
  }, []);

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
    return <ArchitectCard>Loading profile...</ArchitectCard>;
  }

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Public Profile"
        title="Architect Profile"
        description="This information will be used for marketplace trust, project proposals, and business discovery."
      />

      {message ? (
        <div className="mb-5 rounded-[24px] border border-orange-100 bg-white px-5 py-4 text-sm font-black text-orange-700">
          {message}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[0.75fr_1.25fr]">
        <ArchitectCard title="Profile Status">
          <div className="space-y-4">
            <ArchitectStatusPill status={profile?.approvalStatus ?? "PENDING"} />

            <div>
              <p className="text-sm font-bold text-orange-700">Hourly Rate</p>
              <h3 className="mt-1 text-2xl font-black">{formatMoney(profile?.hourlyRateCents)}</h3>
            </div>

            <div>
              <p className="text-sm font-bold text-orange-700">Completed Jobs</p>
              <h3 className="mt-1 text-2xl font-black">{profile?.completedJobs ?? 0}</h3>
            </div>

            <div>
              <p className="text-sm font-bold text-orange-700">Rating</p>
              <h3 className="mt-1 text-2xl font-black">{profile?.rating ?? 0}/5</h3>
            </div>
          </div>
        </ArchitectCard>

        <ArchitectCard title="Edit Profile">
          <form onSubmit={handleSubmit} className="grid gap-4">
            <ArchitectField
              name="title"
              label="Professional Title"
              placeholder="AI Workflow Architect"
              defaultValue={profile?.title ?? ""}
              required
            />

            <ArchitectTextarea
              name="bio"
              label="Bio"
              placeholder="Tell businesses what kind of agents and automations you build."
              defaultValue={profile?.bio ?? ""}
              minLength={10}
              required
            />

            <ArchitectField
              name="portfolioUrl"
              label="Portfolio URL"
              placeholder="https://yourportfolio.com"
              defaultValue={profile?.portfolioUrl ?? ""}
            />

            <ArchitectField
              name="skills"
              label="Skills comma separated"
              placeholder="OpenAI, CRM, Gmail, Automation, Sales"
              defaultValue={profile?.skills.join(", ") ?? ""}
            />

            <ArchitectField
              name="hourlyRate"
              label="Hourly Rate in INR"
              placeholder="1500"
              type="number"
              min={0}
              defaultValue={
                profile?.hourlyRateCents ? String(profile.hourlyRateCents / 100) : ""
              }
            />

            <ArchitectPrimaryButton>Save Profile</ArchitectPrimaryButton>
          </form>
        </ArchitectCard>
      </div>
    </div>
  );
}