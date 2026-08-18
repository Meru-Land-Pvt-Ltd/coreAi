"use client";

import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Sparkles } from "lucide-react";

/**
 * Prompt Box block — a textarea plus an accent Generate button, following the
 * media template's composer patterns. The block owns its draft; the renderer
 * receives the trimmed prompt on submit and decides what actually runs
 * (style/model context is appended there, invisibly to the customer).
 */

/** The backend accepts prompts up to this length. */
const MAX_PROMPT_LENGTH = 4000;

/**
 * Touch keyboards have no Shift — Enter must insert a newline there and only
 * send on devices with a fine pointer (ChatGPT-style behavior).
 */
function isCoarsePointer(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

export function PromptComposerBlock({
  placeholder,
  accent,
  accentText,
  busy,
  onGenerate,
  onDraftChange
}: {
  placeholder: string;
  accent: string;
  accentText: string;
  busy: boolean;
  onGenerate: (prompt: string) => void;
  /** Mirrors the draft upward so Button blocks can run with the typed text. */
  onDraftChange?: (draft: string) => void;
}) {
  const [draft, setDraft] = useState("");

  function updateDraft(value: string) {
    setDraft(value);
    onDraftChange?.(value);
  }

  function submit() {
    const prompt = draft.trim();
    if (!prompt || busy) return;
    updateDraft("");
    onGenerate(prompt);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !isCoarsePointer()) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      data-testid="agent-block-prompt-composer"
      className="mt-6 rounded-2xl border border-gray-200 bg-white p-2 shadow-sm transition focus-within:border-amber-400 motion-reduce:transition-none"
    >
      <textarea
        rows={2}
        value={draft}
        maxLength={MAX_PROMPT_LENGTH}
        onChange={(event) => updateDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        aria-label={placeholder}
        data-testid="agent-block-prompt-input"
        className="w-full resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-relaxed text-slate-900 placeholder:text-slate-400 focus:outline-none"
      />
      <div className="flex items-center justify-end px-1 pb-1">
        <button
          type="submit"
          disabled={busy || !draft.trim()}
          data-testid="agent-block-generate"
          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none"
          style={{ backgroundColor: accent, color: accentText }}
        >
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          {busy ? "Creating…" : "Generate"}
        </button>
      </div>
    </form>
  );
}
