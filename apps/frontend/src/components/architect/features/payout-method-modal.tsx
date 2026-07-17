"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  saveArchitectBackupPayoutMethod,
  saveArchitectPayoutMethod,
  verifyArchitectIfsc
} from "@/components/architect/features/api";

type ExistingPayoutMethod = {
  country: "US" | "IN";
  accountHolderName: string;
} | null;

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
  const [bankName, setBankName] = useState("");
  const [routingNumber, setRoutingNumber] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [routingStatus, setRoutingStatus] = useState<"idle" | "checking" | "valid" | "invalid">("idle");
  const [routingMessage, setRoutingMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function isValidAba(value: string) {
    if (!/^\d{9}$/.test(value)) return false;
    const digits = value.split("").map(Number);
    return (3 * (digits[0]! + digits[3]! + digits[6]!) + 7 * (digits[1]! + digits[4]! + digits[7]!) + digits[2]! + digits[5]! + digits[8]!) % 10 === 0;
  }

  async function validateRouting(value: string) {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      setRoutingStatus("idle");
      setRoutingMessage("");
      return;
    }
    if (country === "US") {
      const valid = isValidAba(normalized);
      setRoutingStatus(valid ? "valid" : "invalid");
      setRoutingMessage(valid ? "Valid ABA routing number format." : "Enter a valid 9-digit ABA routing number.");
      return;
    }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(normalized)) {
      setRoutingStatus("invalid");
      setRoutingMessage("Enter a valid IFSC code (e.g. HDFC0001234).");
      return;
    }
    setRoutingStatus("checking");
    setRoutingMessage("Verifying IFSC code…");
    const result = await verifyArchitectIfsc(normalized);
    if (result.success && result.data?.valid) {
      setRoutingStatus("valid");
      setRoutingMessage(`${result.data.bankName}${result.data.branch ? ` · ${result.data.branch}` : ""}`);
      if (!bankName.trim() && result.data.bankName) setBankName(result.data.bankName);
    } else {
      setRoutingStatus("invalid");
      setRoutingMessage(result.error ?? "IFSC code not found.");
    }
  }

  // Validate the routing number as the architect types (debounced) — the save
  // button unlocks without requiring a blur first.
  useEffect(() => {
    if (!routingNumber.trim()) {
      setRoutingStatus("idle");
      setRoutingMessage("");
      return;
    }

    const timer = window.setTimeout(() => {
      void validateRouting(routingNumber);
    }, 600);

    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- validateRouting reads current field state
  }, [routingNumber, country]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (routingStatus === "checking") {
      setError("Hold on — still verifying the routing details.");
      return;
    }
    if (routingStatus !== "valid") {
      setError(`Verify a valid ${country === "IN" ? "IFSC code" : "ABA routing number"} before saving.`);
      return;
    }
    if (accountNumber.length < 4) {
      setError("Enter a valid account number.");
      return;
    }
    if (accountNumber !== confirmAccountNumber) {
      setError("Account numbers do not match.");
      return;
    }
    setSaving(true);
    const body = {
      country,
      bankName: bankName.trim(),
      accountHolderName: accountHolderName.trim(),
      accountNumber,
      confirmAccountNumber,
      routingNumber: routingNumber.trim().toUpperCase()
    };
    const result = mode === "backup"
      ? await saveArchitectBackupPayoutMethod(body)
      : await saveArchitectPayoutMethod(body);
    if (result.success) await onSaved();
    else setError(result.error ?? "Could not save payout method. Please check the details and try again.");
    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl" data-testid="architect-payouts-method-modal">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{mode === "backup" ? "Add backup payout method" : "Add payout method"}</h3>
            <p className="mt-1 text-sm text-slate-500">Bank transfers are used for architect payouts.</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 transition hover:bg-gray-100 hover:text-slate-600">×</button>
        </div>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          <Field label="Bank country"><select value={country} disabled={mode === "backup" && Boolean(payoutMethod)} onChange={(event) => { setCountry(event.target.value as "US" | "IN"); setRoutingNumber(""); setRoutingStatus("idle"); setRoutingMessage(""); }} className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm text-slate-900 disabled:bg-slate-50"><option value="US">United States</option><option value="IN">India</option></select></Field>
          <Field label="Account holder name" testId="architect-payouts-account-holder"><input value={accountHolderName} onChange={(event) => setAccountHolderName(event.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" required /></Field>
          <Field label="Bank name" testId="architect-payouts-bank-name"><input value={bankName} onChange={(event) => setBankName(event.target.value)} className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm" required /></Field>
          <Field label={country === "IN" ? "IFSC code" : "ABA routing number"} testId="architect-payouts-routing-number"><input value={routingNumber} onChange={(event) => setRoutingNumber(country === "IN" ? event.target.value.toUpperCase() : event.target.value.replace(/\D/g, ""))} onBlur={() => void validateRouting(routingNumber)} maxLength={country === "IN" ? 11 : 9} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm uppercase" placeholder={country === "IN" ? "HDFC0001234" : "110000000"} required />{routingMessage ? <p className={`mt-1 text-xs ${routingStatus === "valid" ? "text-green-600" : routingStatus === "invalid" ? "text-red-600" : "text-slate-500"}`}>{routingMessage}</p> : null}</Field>
          <Field label="Account number" testId="architect-payouts-account-number"><input value={accountNumber} onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" inputMode="numeric" required /></Field>
          <Field label="Confirm account number" testId="architect-payouts-confirm-account-number"><input value={confirmAccountNumber} onChange={(event) => setConfirmAccountNumber(event.target.value.replace(/\D/g, ""))} className="w-full rounded-xl border border-gray-200 px-4 py-3 font-mono text-sm" inputMode="numeric" required /></Field>
          {error ? <p className="text-sm text-red-600" data-testid="architect-payouts-method-error">{error}</p> : null}
          <div className="flex gap-3 pt-2"><button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-600">Cancel</button><button type="submit" disabled={saving || routingStatus !== "valid"} data-testid="architect-payouts-save-method-button" className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : "Save payout method"}</button></div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, testId, children }: { label: string; testId?: string; children: ReactNode }) {
  return <label className="block" data-testid={testId}><span className="mb-1.5 block text-sm font-medium text-slate-700">{label}</span>{children}</label>;
}
