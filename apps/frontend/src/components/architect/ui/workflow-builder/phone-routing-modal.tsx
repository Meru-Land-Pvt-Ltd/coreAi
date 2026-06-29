"use client";

import { useEffect, useState } from "react";
import {
  getPhoneRoutingStatus,
  setupPhoneRouting,
  testPhoneRouting,
  updatePhoneRoutingMode,
  type ForwardingInstructions,
  type PhoneRoutingTestResult
} from "@/components/architect/features/api";

const MODE_OPTIONS: { value: string; label: string }[] = [
  { value: "AI_FIRST", label: "AI answers all calls" },
  { value: "NO_ANSWER", label: "AI answers only missed / no-answer calls" },
  { value: "BUSY", label: "AI answers when the line is busy" },
  { value: "AFTER_HOURS", label: "AI answers after business hours" },
  { value: "UNREACHABLE", label: "AI answers when the phone is unreachable" }
];

/**
 * Generic phone-routing setup (works for any business vertical). Customers keep
 * calling the business's existing number; with forwarding, missed/unanswered/etc.
 * calls go to the assigned CoreAI number and are answered by the AI receptionist.
 */
export function PhoneRoutingModal({
  open,
  onClose,
  workflowId
}: {
  open: boolean;
  onClose: () => void;
  workflowId?: string;
}) {
  const [publicNumber, setPublicNumber] = useState("");
  const [mode, setMode] = useState("NO_ANSWER");
  const [assignedNumber, setAssignedNumber] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<ForwardingInstructions | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [testFrom, setTestFrom] = useState("+916396039675");
  const [testResult, setTestResult] = useState<PhoneRoutingTestResult | null>(null);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    let active = true;
    void (async () => {
      const result = await getPhoneRoutingStatus();
      if (!active || !result.success || !result.data) return;
      const status = result.data;
      if (status.publicBusinessNumber) setPublicNumber(status.publicBusinessNumber);
      if (status.mode) setMode(status.mode);
      setAssignedNumber(status.assignedCoreAiNumber);
      setInstructions(status.forwardingInstructions ?? null);
    })();
    return () => {
      active = false;
    };
  }, [open]);

  if (!open) return null;

  // Switch mode locally; if routing is already set up, persist + refresh
  // the forwarding instructions live via PATCH.
  async function changeMode(value: string) {
    setMode(value);
    if (!assignedNumber) return;
    const result = await updatePhoneRoutingMode(value);
    if (result.success && result.data) setInstructions(result.data.forwardingInstructions);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    const result = await setupPhoneRouting({ publicBusinessNumber: publicNumber, mode, workflowId });
    setSaving(false);
    if (!result.success || !result.data) {
      setMessage(result.error ?? "Could not save phone routing");
      return;
    }
    setAssignedNumber(result.data.assignedCoreAiNumber);
    setInstructions(result.data.forwardingInstructions);
    setMessage("Phone routing saved");
  }

  async function runTest() {
    if (!assignedNumber) return;
    setTesting(true);
    setTestResult(null);
    const result = await testPhoneRouting({ called: assignedNumber, from: testFrom });
    setTesting(false);
    if (result.success && result.data) setTestResult(result.data);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" data-testid="phone-routing-modal" onClick={onClose}>
      <div
        className="max-h-[85vh] w-[min(94vw,640px)] overflow-y-auto rounded-2xl border border-gray-200 bg-white p-5 shadow-xl scroll-thin"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-black text-slate-900" data-testid="phone-routing-title">Phone setup &amp; call forwarding</h3>
            <p className="mt-1 text-xs text-slate-500">
              Your customers can keep calling your existing number. If you enable call forwarding, missed/unanswered calls are forwarded to the CoreAI number and answered by your AI receptionist.
            </p>
          </div>
          <button type="button" onClick={onClose} data-testid="phone-routing-close" className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600" aria-label="Close">✕</button>
        </div>

        {/* Step 1 */}
        <section className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Step 1 · Your existing number</p>
          <label className="mt-1 block text-sm text-slate-700">Your current clinic/business phone number</label>
          <input
            data-testid="phone-routing-public-number"
            value={publicNumber}
            onChange={(event) => setPublicNumber(event.target.value)}
            placeholder="+918882877457"
            className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 font-mono text-sm text-slate-800 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-400/40"
          />
        </section>

        {/* Step 2 */}
        <section className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Step 2 · How should the AI answer?</p>
          <div className="mt-1 space-y-1.5">
            {MODE_OPTIONS.map((option) => (
              <label key={option.value} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-700 hover:border-violet-300" data-testid={`phone-routing-mode-${option.value}`}>
                <input type="radio" name="routing-mode" value={option.value} checked={mode === option.value} onChange={() => void changeMode(option.value)} />
                {option.label}
              </label>
            ))}
          </div>
        </section>

        {/* Step 3 */}
        <section className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Step 3 · Your CoreAI AI forwarding number</p>
          <div className="mt-1 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 font-mono text-sm font-bold text-violet-700" data-testid="phone-routing-assigned-number">
            {assignedNumber ?? "Assigned when you save"}
          </div>
        </section>

        {/* Step 4 */}
        {instructions ? (
          <section className="mt-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Step 4 · Forwarding instructions</p>
            <p className="mt-1 text-sm font-semibold text-slate-800" data-testid="phone-routing-instructions-headline">{instructions.headline}</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-slate-600">
              {instructions.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
            <p className="mt-2 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] text-amber-700">{instructions.note}</p>
          </section>
        ) : null}

        {/* Step 5 */}
        <section className="mt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Step 5 · Test call</p>
          <p className="mt-1 text-xs text-slate-600">
            Call <span className="font-mono font-semibold text-slate-800">{assignedNumber ?? "your assigned number"}</span> directly to test, or configure forwarding and call your public number.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              data-testid="phone-routing-test-from"
              value={testFrom}
              onChange={(event) => setTestFrom(event.target.value)}
              placeholder="Caller number"
              className="w-44 rounded-lg border border-gray-200 px-3 py-1.5 font-mono text-xs text-slate-800 outline-none focus:border-violet-300"
            />
            <button
              type="button"
              onClick={runTest}
              disabled={testing || !assignedNumber}
              data-testid="phone-routing-test-run"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-violet-300 disabled:opacity-60"
            >
              {testing ? "Resolving…" : "Simulate lookup"}
            </button>
          </div>
          {testResult ? (
            <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs" data-testid="phone-routing-test-result">
              {testResult.resolved ? (
                <p className="text-green-700">
                  Resolved → <span className="font-semibold">{testResult.businessName}</span> · workflow {testResult.workflowId} · assistant {testResult.vapiAssistantId ?? "—"} · mode {testResult.mode}
                </p>
              ) : (
                <p className="text-amber-700">{testResult.message}</p>
              )}
            </div>
          ) : null}
        </section>

        <div className="mt-5 flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-400" data-testid="phone-routing-message">{message}</span>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">Close</button>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              data-testid="phone-routing-save"
              className="rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white transition hover:bg-violet-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save routing"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
