"use client";

import { useState, type FormEvent } from "react";
import type { CrmContact, CrmContactUpdate } from "./api";

/**
 * Inline edit form for the drawer's Customer Profile section.
 *
 * Only phone is required. Email and company are legitimately blank for the
 * consumer callers this product serves, so the form never demands them, and a
 * field the buyer clears is sent as an explicit null (which clears it in the
 * CRM) rather than being silently dropped.
 */

const STAGE_OPTIONS = [
  "New",
  "Lead",
  "Open",
  "In Progress",
  "Appointment Booked",
  "Customer",
  "Unqualified"
];

const inputClasses =
  "w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none";
const labelClasses = "mb-1.5 block text-sm font-semibold text-slate-700";

export function CrmEditContactForm({
  contact,
  saving,
  onCancel,
  onSave
}: {
  contact: CrmContact;
  saving: boolean;
  onCancel: () => void;
  onSave: (changes: CrmContactUpdate) => void;
}) {
  const [firstName, setFirstName] = useState(contact.firstName ?? "");
  const [lastName, setLastName] = useState(contact.lastName ?? "");
  const [phone, setPhone] = useState(contact.phone ?? "");
  const [email, setEmail] = useState(contact.email ?? "");
  const [company, setCompany] = useState(contact.company ?? "");
  const [language, setLanguage] = useState(contact.preferredLanguage ?? "");
  const [stage, setStage] = useState(contact.stage ?? "");
  const [vip, setVip] = useState(contact.vip);
  const [error, setError] = useState("");

  function handleSubmit(event: FormEvent) {
    event.preventDefault();

    const trimmedPhone = phone.trim();
    if (!trimmedPhone) {
      setError("Phone is required — it is how the AI recognises this caller.");
      return;
    }
    setError("");

    // Diff against the original so an untouched field is never transmitted;
    // a cleared field becomes null, which clears it in the CRM.
    const changes: CrmContactUpdate = {};
    const diffText = (
      key: keyof CrmContactUpdate,
      next: string,
      original: string | null
    ) => {
      const value = next.trim();
      const before = original?.trim() ?? "";
      if (value === before) return;
      (changes as Record<string, unknown>)[key] = value ? value : null;
    };

    diffText("firstName", firstName, contact.firstName);
    diffText("lastName", lastName, contact.lastName);
    diffText("email", email, contact.email);
    diffText("company", company, contact.company);
    diffText("preferredLanguage", language, contact.preferredLanguage);
    diffText("stage", stage, contact.stage);

    if (trimmedPhone !== (contact.phone ?? "").trim()) changes.phone = trimmedPhone;
    if (vip !== contact.vip) changes.vip = vip;

    if (Object.keys(changes).length === 0) {
      onCancel();
      return;
    }

    onSave(changes);
  }

  return (
    <form onSubmit={handleSubmit} data-testid="business-crm-edit-form" className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClasses} htmlFor="crm-first-name">
            First name
          </label>
          <input
            id="crm-first-name"
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            data-testid="business-crm-field-first-name"
            className={inputClasses}
            placeholder="Optional"
          />
        </div>

        <div>
          <label className={labelClasses} htmlFor="crm-last-name">
            Last name
          </label>
          <input
            id="crm-last-name"
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            data-testid="business-crm-field-last-name"
            className={inputClasses}
            placeholder="Optional"
          />
        </div>
      </div>

      <div>
        <label className={labelClasses} htmlFor="crm-phone">
          Phone <span className="font-normal text-slate-400">(required)</span>
        </label>
        <input
          id="crm-phone"
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          data-testid="business-crm-field-phone"
          className={inputClasses}
          placeholder="+1 555 123 4567"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClasses} htmlFor="crm-email">
            Email <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="crm-email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            data-testid="business-crm-field-email"
            className={inputClasses}
            placeholder="Leave blank if unknown"
          />
        </div>

        <div>
          <label className={labelClasses} htmlFor="crm-company">
            Company <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="crm-company"
            value={company}
            onChange={(event) => setCompany(event.target.value)}
            data-testid="business-crm-field-company"
            className={inputClasses}
            placeholder="Leave blank for individuals"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={labelClasses} htmlFor="crm-language">
            Preferred language
          </label>
          <input
            id="crm-language"
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            data-testid="business-crm-field-language"
            className={inputClasses}
            placeholder="Optional"
          />
        </div>

        <div>
          <label className={labelClasses} htmlFor="crm-stage">
            Stage
          </label>
          <select
            id="crm-stage"
            value={stage}
            onChange={(event) => setStage(event.target.value)}
            data-testid="business-crm-field-stage"
            className={inputClasses}
          >
            <option value="">Not set</option>
            {STAGE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
            {stage && !STAGE_OPTIONS.includes(stage) ? <option value={stage}>{stage}</option> : null}
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2.5 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          checked={vip}
          onChange={(event) => setVip(event.target.checked)}
          data-testid="business-crm-field-vip"
          className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
        />
        VIP customer
      </label>

      {error ? (
        <p
          className="rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700"
          data-testid="business-crm-edit-error"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row">
        <button
          type="submit"
          disabled={saving}
          data-testid="business-crm-save-contact"
          className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          data-testid="business-crm-cancel-edit"
          className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-gray-300"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
