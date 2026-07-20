"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  saveBusinessPaymentMethod,
  startBusinessCardSetup
} from "@/components/business/features/api";

export function BusinessPaymentMethodModal({
  mode,
  onClose,
  onSaved
}: {
  mode: "primary" | "backup";
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [clientSecret, setClientSecret] = useState("");
  const [stripePromise, setStripePromise] = useState<ReturnType<typeof loadStripe> | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      const result = await startBusinessCardSetup();
      if (!active) return;
      if (!result.success || !result.data?.clientSecret || !result.data.publishableKey) {
        setError(result.error ?? "Card payments are not configured.");
        return;
      }
      setClientSecret(result.data.clientSecret);
      setStripePromise(loadStripe(result.data.publishableKey));
    })();
    return () => { active = false; };
  }, []);

  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center overflow-y-auto bg-slate-900/55 p-4 sm:items-center" role="dialog" aria-modal="true" data-testid="business-settings-card-modal">
      <div className="my-auto w-full max-w-lg rounded-2xl bg-white p-5 sm:p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">{mode === "backup" ? "Add backup payment method" : "Change payment method"}</h2>
            <p className="mt-1 text-sm text-slate-500">Enter your card number, expiry date, and security code.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close payment method dialog" className="rounded-lg p-1.5 text-xl leading-none text-slate-400 hover:bg-gray-100">×</button>
        </div>

        <div className="mt-6">
          {clientSecret && stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: {
                  theme: "stripe",
                  variables: { colorPrimary: "#f59e0b", borderRadius: "12px" }
                }
              }}
            >
              <CardSetupForm mode={mode} onClose={onClose} onSaved={onSaved} />
            </Elements>
          ) : error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
          ) : (
            <div className="space-y-3 animate-pulse"><div className="h-12 rounded-xl bg-gray-100" /><div className="h-12 rounded-xl bg-gray-100" /><div className="h-12 rounded-xl bg-gray-100" /></div>
          )}
        </div>
      </div>
    </div>
  );
}

function CardSetupForm({
  mode,
  onClose,
  onSaved
}: {
  mode: "primary" | "backup";
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!stripe || !elements || saving) return;
    setSaving(true);
    setError("");

    const result = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: window.location.href }
    });
    if (result.error) {
      setError(result.error.message ?? "Could not verify this card.");
      setSaving(false);
      return;
    }

    const paymentMethod = result.setupIntent?.payment_method;
    const paymentMethodId = typeof paymentMethod === "string" ? paymentMethod : paymentMethod?.id;
    if (!paymentMethodId) {
      setError("Stripe did not return a payment method.");
      setSaving(false);
      return;
    }

    const saved = await saveBusinessPaymentMethod(mode, paymentMethodId);
    if (!saved.success) {
      setError(saved.error ?? "Could not save this payment method.");
      setSaving(false);
      return;
    }
    await onSaved();
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl border border-gray-200 p-3 sm:p-4">
        <PaymentElement options={{ layout: "tabs", paymentMethodOrder: ["card"] }} />
      </div>
      <p className="text-xs text-slate-400">Card details are securely processed by Stripe and are not stored by Triven.</p>
      {error ? <p className="text-sm text-red-600" data-testid="business-settings-card-error">{error}</p> : null}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:gap-3">
        <button type="button" onClick={onClose} className="w-full sm:flex-1 rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 order-2 sm:order-1">Cancel</button>
        <button type="submit" disabled={!stripe || !elements || saving} className="w-full sm:flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50 order-1 sm:order-2" data-testid="business-settings-save-card">{saving ? "Saving…" : mode === "backup" ? "Add backup card" : "Save card"}</button>
      </div>
    </form>
  );
}
