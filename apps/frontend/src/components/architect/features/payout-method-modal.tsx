"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import {
  getArchitectStripeDashboardLink,
  startArchitectStripeOnboarding
} from "@/components/architect/features/api";

type ExistingPayoutMethod = {
  country: "US" | "IN";
  accountHolderName: string;
} | null;

/**
 * Stripe-hosted payout method setup. Bank account and routing numbers are
 * collected by Stripe (hosted onboarding for the primary method, the Stripe
 * Express dashboard for backup accounts) — they never pass through Triven.
 */
export function ArchitectPayoutMethodModal({
  mode,
  payoutMethod,
  onClose,
  onSaved
}: {
  mode: "primary" | "backup";
  payoutMethod: ExistingPayoutMethod;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [country, setCountry] = useState<"US" | "IN">(payoutMethod?.country ?? "US");
  const [accountHolderName, setAccountHolderName] = useState(payoutMethod?.accountHolderName ?? "");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");

    setSaving(true);

    if (mode === "backup") {
      // Additional bank accounts are managed inside the Stripe Express
      // dashboard for the existing connected account.
      const result = await getArchitectStripeDashboardLink();
      if (result.success && result.data?.url) {
        window.open(result.data.url, "_blank", "noopener");
        await onSaved();
        setSaving(false);
        return;
      }
      setSaving(false);
      setError(result.error ?? "Could not open the Stripe payout dashboard. Add a primary payout method first.");
      return;
    }

    if (accountHolderName.trim().length < 2) {
      setSaving(false);
      setError("Enter the account holder name.");
      return;
    }

    const result = await startArchitectStripeOnboarding({
      country,
      accountHolderName: accountHolderName.trim()
    });
    if (result.success && result.data?.url) {
      window.location.assign(result.data.url);
      return;
    }

    setSaving(false);
    setError(result.error ?? "Could not open Stripe onboarding. Please try again.");
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" data-testid="architect-payouts-method-modal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{mode === "backup" ? "Add backup payout method" : "Add payout method"}</h3>
            <p className="mt-1 text-sm text-slate-500">Bank details are added securely on Stripe — Triven never sees your account number.</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600">×</button>
        </div>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          {mode === "primary" ? (
            <>
              <Field label="Bank country"><select value={country} onChange={(event) => setCountry(event.target.value as "US" | "IN")} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"><option value="US">United States</option><option value="IN">India</option></select></Field>
              <Field label="Account holder name" testId="architect-payouts-account-holder"><input value={accountHolderName} onChange={(event) => setAccountHolderName(event.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" required /></Field>
              <p className="text-xs leading-5 text-slate-500">You&apos;ll be redirected to Stripe to add your bank account and complete verification, then returned here.</p>
            </>
          ) : (
            <p className="text-sm leading-6 text-slate-600">
              Backup bank accounts are managed in your Stripe payout dashboard. We&apos;ll open it in a new tab —
              add the account there and it will appear here after the next sync.
            </p>
          )}
          {error ? <p className="text-sm text-red-600" data-testid="architect-payouts-method-error">{error}</p> : null}
          <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button type="submit" disabled={saving} data-testid="architect-payouts-save-method-button" className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Opening Stripe…" : mode === "backup" ? "Open Stripe dashboard" : "Continue with Stripe"}</button></div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return <label className="block" data-testid={testId}><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>{children}</label>;
}
