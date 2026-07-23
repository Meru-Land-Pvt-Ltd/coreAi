"use client";

import { FIELD, LABEL } from "./ui";

/**
 * After-Hours & Emergency Routing section of the Configure step.
 *
 * Edits the reusable business-level afterHoursPolicy (stored on the installed
 * agent's configJson). Only contact methods with a real delivery path are
 * offered (SMS / EMAIL / NONE). This section never touches SMS marketing
 * consent — internal staff alerts are a separate, consent-exempt channel.
 */

export type AfterHoursPolicyFormValue = {
  enabled: boolean;
  emergencyScreeningEnabled: boolean;
  emergencyCategory: "DENTAL" | "MEDICAL" | "SERVICE" | "NONE";
  greeting: string;
  emergencyContactMethod: "SMS" | "EMAIL" | "NONE";
  emergencyContact: string;
  offerAppointmentBooking: boolean;
  preferEarliestAvailableSlot: boolean;
  allowUrgentCallbackRequest: boolean;
  lifeThreateningInstruction: string;
  includeCallbackInStaffAlert: boolean;
};

export const DEFAULT_AFTER_HOURS_POLICY_FORM: AfterHoursPolicyFormValue = {
  enabled: false,
  emergencyScreeningEnabled: false,
  emergencyCategory: "NONE",
  greeting: "",
  emergencyContactMethod: "NONE",
  emergencyContact: "",
  offerAppointmentBooking: true,
  preferEarliestAvailableSlot: true,
  allowUrgentCallbackRequest: true,
  lifeThreateningInstruction: "",
  includeCallbackInStaffAlert: true
};

const CATEGORY_OPTIONS = [
  { value: "NONE", label: "No emergency screening category" },
  { value: "DENTAL", label: "Dental emergencies" },
  { value: "MEDICAL", label: "Medical emergencies" },
  { value: "SERVICE", label: "Urgent service issues" }
] as const;

const CONTACT_METHOD_OPTIONS = [
  { value: "NONE", label: "None" },
  { value: "SMS", label: "SMS to the team phone" },
  { value: "EMAIL", label: "Email to the team inbox" }
] as const;

function Toggle({
  testId,
  label,
  helper,
  checked,
  onChange
}: {
  testId: string;
  label: string;
  helper?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-2">
      <input
        data-testid={testId}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
      />
      <span className="text-sm text-slate-700">
        <span className="font-medium">{label}</span>
        {helper ? <span className="mt-0.5 block text-xs text-slate-500">{helper}</span> : null}
      </span>
    </label>
  );
}

export function AfterHoursPolicySection({
  value,
  onChange
}: {
  value: AfterHoursPolicyFormValue;
  onChange: (value: AfterHoursPolicyFormValue) => void;
}) {
  const set = <K extends keyof AfterHoursPolicyFormValue>(key: K, next: AfterHoursPolicyFormValue[K]) =>
    onChange({ ...value, [key]: next });

  return (
    <div data-testid="business-setup-after-hours-section">
      <div
        className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"
        data-testid="business-setup-after-hours-warnings"
      >
        <p className="font-semibold">Important safety notes</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>This feature does not provide medical diagnosis.</li>
          <li>Emergency scripts should be reviewed by a licensed professional before production use.</li>
          <li>For immediate emergencies, the assistant directs callers to emergency services.</li>
        </ul>
      </div>

      <div className="space-y-4">
        <Toggle
          testId="business-setup-after-hours-enabled"
          label="Enable after-hours call routing"
          helper="When your business is closed, callers hear the after-hours greeting and are routed to booking, urgent follow-up, or emergency guidance."
          checked={value.enabled}
          onChange={(next) => set("enabled", next)}
        />

        {value.enabled ? (
          <>
            <Toggle
              testId="business-setup-after-hours-screening"
              label="Emergency screening"
              helper="Ask whether the call is an emergency and check for life-threatening warning signs before any booking."
              checked={value.emergencyScreeningEnabled}
              onChange={(next) => set("emergencyScreeningEnabled", next)}
            />

            <div>
              <span className={LABEL}>Emergency category</span>
              <select
                data-testid="business-setup-after-hours-category"
                value={value.emergencyCategory}
                onChange={(event) => set("emergencyCategory", event.target.value as AfterHoursPolicyFormValue["emergencyCategory"])}
                className={FIELD}
              >
                {CATEGORY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className={LABEL}>After-hours greeting (optional)</span>
              <textarea
                data-testid="business-setup-after-hours-greeting"
                value={value.greeting}
                onChange={(event) => set("greeting", event.target.value)}
                rows={3}
                maxLength={600}
                placeholder={`Leave blank for the recommended greeting: "Thank you for calling {{businessName}}. Our office is currently closed. I hope everything is okay. Are you calling about a dental emergency, or would you like help scheduling the next available appointment?"`}
                className={FIELD}
              />
            </div>

            <div>
              <span className={LABEL}>Emergency staff alert method</span>
              <select
                data-testid="business-setup-after-hours-contact-method"
                value={value.emergencyContactMethod}
                onChange={(event) => set("emergencyContactMethod", event.target.value as AfterHoursPolicyFormValue["emergencyContactMethod"])}
                className={FIELD}
              >
                {CONTACT_METHOD_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-slate-500">
                Internal team alerts only — separate from customer text-message consent.
              </span>
            </div>

            <div>
              <span className={LABEL}>Emergency contact (optional)</span>
              <input
                data-testid="business-setup-after-hours-contact"
                type="text"
                value={value.emergencyContact}
                onChange={(event) => set("emergencyContact", event.target.value)}
                maxLength={200}
                placeholder="Team phone or email for urgent alerts (defaults to your team phone)"
                className={FIELD}
              />
            </div>

            <Toggle
              testId="business-setup-after-hours-booking"
              label="Offer appointment booking after hours"
              helper="Non-emergency callers can book the next available appointment."
              checked={value.offerAppointmentBooking}
              onChange={(next) => set("offerAppointmentBooking", next)}
            />
            <Toggle
              testId="business-setup-after-hours-earliest-slot"
              label="Prefer earliest available slot for urgent requests"
              helper={`The assistant says "I'll check the earliest available appointment" — no special emergency slots are claimed.`}
              checked={value.preferEarliestAvailableSlot}
              onChange={(next) => set("preferEarliestAvailableSlot", next)}
            />
            <Toggle
              testId="business-setup-after-hours-callback"
              label="Allow urgent callback requests"
              helper="When no urgent appointment can be confirmed, the caller's details go to the team as an urgent request."
              checked={value.allowUrgentCallbackRequest}
              onChange={(next) => set("allowUrgentCallbackRequest", next)}
            />
            <Toggle
              testId="business-setup-after-hours-include-callback"
              label="Include the caller's callback number in staff alerts"
              helper="Turn off to keep phone numbers out of internal alert messages."
              checked={value.includeCallbackInStaffAlert}
              onChange={(next) => set("includeCallbackInStaffAlert", next)}
            />

            <div>
              <span className={LABEL}>Life-threatening instruction (optional)</span>
              <textarea
                data-testid="business-setup-after-hours-instruction"
                value={value.lifeThreateningInstruction}
                onChange={(event) => set("lifeThreateningInstruction", event.target.value)}
                rows={3}
                maxLength={600}
                placeholder={`Leave blank for the default: "This may require immediate medical attention. Please call 911 now or go to the nearest emergency department. Do not wait for a dental appointment. If you are unable to call safely, ask someone nearby to call for you."`}
                className={FIELD}
              />
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
