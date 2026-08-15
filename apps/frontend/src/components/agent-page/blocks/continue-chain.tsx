"use client";

import { ArrowRight } from "lucide-react";

/**
 * Continue Button block — appears after a successful run (the renderer gates
 * that); tapping it re-runs the agent with a "continue from the previous
 * result" prompt on the same session.
 */

export function ContinueChainBlock({
  label,
  busy,
  accent,
  accentText,
  onContinue
}: {
  label: string;
  busy: boolean;
  accent: string;
  accentText: string;
  onContinue: () => void;
}) {
  return (
    <div className="mt-6 flex justify-center" data-testid="agent-block-continue-chain">
      <button
        type="button"
        disabled={busy}
        data-testid="agent-block-continue"
        onClick={onContinue}
        className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
        style={{ backgroundColor: accent, color: accentText }}
      >
        {label}
        <ArrowRight className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
