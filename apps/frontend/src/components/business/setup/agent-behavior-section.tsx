"use client";

import { useState } from "react";
import { CUSTOM_INSTRUCTION_SUGGESTIONS, DEFAULT_SILENCE } from "@coreai/shared";
import type { BuyerCustomFieldValue, BuyerSetupFieldDef } from "@/components/business/features/api";
import { BuyerSetupFieldControl } from "./buyer-setup-field";
import { FIELD, LABEL } from "./ui";

/**
 * Agent Behavior section of the Configure step: how the agent handles
 * conversations. Basics (custom instructions, architect-defined fields) sit
 * on top; silence/re-prompt/goodbye handling lives in a clearly-labeled
 * "Advanced behavior" area so it never mixes with business information.
 */

export function AgentBehaviorSection({
  showVoice,
  customInstructions,
  silenceRepromptCount,
  silenceMessage1,
  silenceMessage2,
  goodbyeMessage,
  setupFields,
  setupInstructions,
  customValues,
  onCustomInstructions,
  onSilenceCount,
  onSilence1,
  onSilence2,
  onGoodbye,
  onCustomField
}: {
  showVoice: boolean;
  customInstructions: string;
  silenceRepromptCount: number;
  silenceMessage1: string;
  silenceMessage2: string;
  goodbyeMessage: string;
  setupFields: BuyerSetupFieldDef[];
  setupInstructions: string;
  customValues: BuyerCustomFieldValue[];
  onCustomInstructions: (v: string) => void;
  onSilenceCount: (v: number) => void;
  onSilence1: (v: string) => void;
  onSilence2: (v: string) => void;
  onGoodbye: (v: string) => void;
  onCustomField: (key: string, label: string, value: string | string[] | boolean) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div>
      {/* Agent-specific custom fields (architect-defined) come first — they
          are the details this template requires from the buyer. */}
      {setupFields.length > 0 ? (
        <div className="mb-7 border-b border-gray-100 pb-6" data-testid="business-setup-custom-fields">
          <h3 className="text-sm font-bold text-slate-900">Agent setup details</h3>
          <p className="mt-0.5 text-xs text-slate-500">
            Details this agent needs to answer callers accurately.
          </p>
          {setupInstructions ? (
            <p
              className="mt-3 rounded-xl border border-amber-100 bg-amber-50/60 px-3.5 py-2.5 text-sm text-amber-900/90"
              data-testid="business-setup-buyer-instructions"
            >
              {setupInstructions}
            </p>
          ) : null}
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            {setupFields.map((field) => (
              <BuyerSetupFieldControl
                key={field.key}
                field={field}
                value={customValues.find((item) => item.key === field.key)?.value}
                onChange={(value) => onCustomField(field.key, field.label, value)}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div data-testid="business-setup-instructions">
        <h3 className="text-sm font-bold text-slate-900">Custom instructions</h3>
        <p className="mt-0.5 text-sm text-slate-500">
          Tell the AI how to handle calls.
        </p>

        <div className="mt-3 flex flex-wrap gap-2" data-testid="business-setup-instruction-chips">
          {CUSTOM_INSTRUCTION_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              data-testid={`business-setup-instruction-chip-${suggestion.toLowerCase().replace(/[^a-z]+/g, "-")}`}
              onClick={() => {
                if (customInstructions.includes(suggestion)) return;
                const trimmed = customInstructions.trim();
                onCustomInstructions(trimmed ? `${trimmed}\n- ${suggestion}` : `- ${suggestion}`);
              }}
              className="btn rounded-full border border-gray-200 px-3 py-1 text-xs font-semibold text-slate-600 hover:border-amber-300 hover:bg-amber-50"
            >
              + {suggestion}
            </button>
          ))}
        </div>

        <textarea
          data-testid="business-setup-input-instructions"
          value={customInstructions}
          onChange={(e) => onCustomInstructions(e.target.value)}
          rows={6}
          placeholder="e.g. Always greet by business name. Confirm date and time before booking."
          className={`${FIELD} mt-3`}
        />
      </div>

      {/* Advanced behavior — silence handling, re-prompts, goodbye. */}
      {showVoice ? (
        <div className="mt-7 border-t border-gray-100 pt-6">
          <button
            type="button"
            onClick={() => setAdvancedOpen((current) => !current)}
            aria-expanded={advancedOpen}
            data-testid="business-setup-advanced-toggle"
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span>
              <span className="block text-sm font-bold text-slate-900">Advanced call behavior</span>
              <span className="mt-0.5 block text-xs text-slate-500">
                Silence handling and ending the call.
              </span>
            </span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {advancedOpen ? (
            <div className="mt-4" data-testid="business-setup-silence">
              <p className="text-sm text-slate-500">
                If the caller goes quiet, the AI re-prompts warmly, then ends the call politely.
              </p>

              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={LABEL} htmlFor="silence-count">
                    Re-prompt attempts
                  </label>
                  <select
                    data-testid="business-setup-input-silence-count"
                    id="silence-count"
                    value={String(silenceRepromptCount)}
                    onChange={(e) => onSilenceCount(Number(e.target.value))}
                    className={FIELD}
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="3">3</option>
                  </select>
                </div>
              </div>

              <div className="mt-4">
                <label className={LABEL} htmlFor="silence-1">
                  1st silence re-prompt
                </label>
                <input
                  data-testid="business-setup-input-silence1"
                  id="silence-1"
                  value={silenceMessage1}
                  onChange={(e) => onSilence1(e.target.value)}
                  placeholder={DEFAULT_SILENCE.reprompt1}
                  className={FIELD}
                />
              </div>

              <div className="mt-4">
                <label className={LABEL} htmlFor="silence-2">
                  2nd silence re-prompt
                </label>
                <input
                  data-testid="business-setup-input-silence2"
                  id="silence-2"
                  value={silenceMessage2}
                  onChange={(e) => onSilence2(e.target.value)}
                  placeholder={DEFAULT_SILENCE.reprompt2}
                  className={FIELD}
                />
              </div>

              <div className="mt-4">
                <label className={LABEL} htmlFor="goodbye">
                  Goodbye message
                </label>
                <input
                  data-testid="business-setup-input-goodbye"
                  id="goodbye"
                  value={goodbyeMessage}
                  onChange={(e) => onGoodbye(e.target.value)}
                  placeholder={DEFAULT_SILENCE.goodbye}
                  className={FIELD}
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
