"use client";

import { useState } from "react";
import { CUSTOM_INSTRUCTION_SUGGESTIONS, DEFAULT_SILENCE } from "@coreai/shared";
import type { BuyerCustomFieldValue, BuyerSetupFieldDef } from "@/components/business/features/api";
import { BuyerSetupFieldControl } from "./buyer-setup-field";
import { FIELD, LABEL, SECTION_TITLE } from "./ui";
import { InfoTooltip } from "./InfoTooltip";

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
  silenceRepromptCount?: number;
  silenceMessage1?: string;
  silenceMessage2?: string;
  goodbyeMessage: string;
  setupFields: BuyerSetupFieldDef[];
  setupInstructions: string;
  customValues: BuyerCustomFieldValue[];
  onCustomInstructions: (v: string) => void;
  onSilenceCount?: (v: number) => void;
  onSilence1?: (v: string) => void;
  onSilence2?: (v: string) => void;
  onGoodbye: (v: string) => void;
  onCustomField: (key: string, label: string, value: string | string[] | boolean) => void;
}) {


  return (
    <div>
      {/* Agent-specific custom fields (architect-defined) come first — they
          are the details this template requires from the buyer. */}
      {setupFields.length > 0 ? (
        <div className="mb-7 border-b border-gray-100 pb-6" data-testid="business-setup-custom-fields">
          <h3 className={`${SECTION_TITLE} inline-flex items-center`}>
            Agent setup details
            <InfoTooltip content="Details this agent needs to answer callers accurately." />
          </h3>
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
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 inline-flex items-center">
          Custom instructions
          <InfoTooltip content="Tell the AI how to handle calls." />
        </h3>

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
          placeholder="e.g. Mention free parking behind the building. Direct detailed pricing questions to our website."
          className={`${FIELD} mt-3`}
        />
      </div>

      {/* Advanced behavior — goodbye message. */}
      {showVoice ? (
        <div className="mt-7 border-t border-gray-100 pt-6">
          <h4 className={`${SECTION_TITLE} inline-flex items-center mb-3`}>
            Advanced call behavior
            <InfoTooltip content="Goodbye message when ending calls." />
          </h4>

          <div data-testid="business-setup-silence">
            <div>
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
        </div>
      ) : null}
    </div>
  );
}
