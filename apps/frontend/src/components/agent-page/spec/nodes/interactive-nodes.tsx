"use client";

import { memo, useId, useRef, useState, type CSSProperties } from "react";
import { Check, ChevronDown, Loader2, Paperclip, Upload as UploadGlyph, X } from "lucide-react";
import type {
  ButtonNode,
  ChoiceNode,
  InputNode,
  SpecAlign,
  SpecSize,
  UploadNode
} from "@coreai/shared";
import { surfaceInk, type SpecSurface } from "../spec-theme";
import { cx, TEXT_ALIGN } from "../spec-tokens";
import { nodeShell } from "../node-shell";
import { channelOf, useSpecRun } from "../spec-run";

/**
 * The interactive half of the contract — the nodes a customer can touch.
 *
 * Every one of them obeys the same three rules:
 *
 *   1. **A wire makes it work; no wire makes it decoration.** An unwired
 *      button is a real, styled, focusable button that does nothing. It is
 *      never disabled and never throws — "impossible to break" includes the
 *      half-finished pages an architect is still writing.
 *   2. **It paints from the surface, never from the spec.** Same components on
 *      a white band and inside a dark hero; only `surface` differs.
 *   3. **It works with no provider mounted.** `useSpecRun()` returning null is
 *      the static-preview case, not an error.
 */

export type InteractiveNodeProps<T> = {
  node: T;
  surface: SpecSurface;
  align: SpecAlign;
};

// ---------------------------------------------------------------------------
// Shared field furniture.
// ---------------------------------------------------------------------------

const FIELD_SHELL =
  "w-full rounded-xl px-4 py-3 text-base leading-6 outline-none transition placeholder:opacity-70 focus:ring-4 motion-reduce:transition-none";

function fieldStyle(surface: SpecSurface): CSSProperties {
  const ink = surfaceInk(surface);
  return {
    background: ink.card,
    color: ink.ink,
    border: `1px solid ${ink.border}`,
    // The focus ring is the accent at low alpha — one brand cue, every field.
    // `--spec-accent-soft` is already surface-corrected by the theme.
    ["--tw-ring-color" as string]: "var(--spec-accent-soft)"
  };
}

function FieldLabel({
  htmlFor,
  children,
  surface
}: {
  htmlFor: string;
  children: string;
  surface: SpecSurface;
}) {
  const ink = surfaceInk(surface);
  return (
    <label
      htmlFor={htmlFor}
      className="mb-1.5 block text-sm font-medium"
      style={{ color: ink.ink }}
    >
      {children}
    </label>
  );
}

// ---------------------------------------------------------------------------
// button.
// ---------------------------------------------------------------------------

const BUTTON_SIZE: Record<SpecSize, string> = {
  sm: "px-4 py-2 text-sm",
  md: "px-6 py-3 text-base",
  lg: "px-8 py-4 text-lg"
};

const BUTTON_SHELL =
  "inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold tracking-tight transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed motion-reduce:transition-none";

function buttonPaint(
  variant: NonNullable<ButtonNode["variant"]>,
  surface: SpecSurface
): CSSProperties {
  const ink = surfaceInk(surface);
  const ring = { ["--tw-ring-color" as string]: "var(--spec-accent-soft)" };
  switch (variant) {
    case "secondary":
      return {
        background: ink.card,
        color: ink.ink,
        border: `1px solid ${ink.border}`,
        boxShadow: "var(--spec-shadow-sm)",
        ...ring
      };
    case "ghost":
      return {
        background: "transparent",
        color: ink.accentInk,
        border: "1px solid transparent",
        ...ring
      };
    case "primary":
    default:
      return {
        background: "var(--spec-accent)",
        color: "var(--spec-accent-contrast)",
        border: "1px solid var(--spec-accent)",
        boxShadow: "var(--spec-shadow)",
        ...ring
      };
  }
}

export const ButtonNodeView = memo(function ButtonNodeView({
  node,
  surface,
  align
}: InteractiveNodeProps<ButtonNode>) {
  const run = useSpecRun();
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const variant = node.variant ?? "primary";
  const paint = buttonPaint(variant, shell.surface);
  const className = cx(BUTTON_SHELL, BUTTON_SIZE[node.size ?? "md"], "w-full sm:w-auto", shell.className);

  const isAction = node.wire?.role === "action";
  const channel = channelOf(node.wire);
  const busy = isAction && run ? Boolean(run.pending[channel]) : false;
  const blocked = isAction && run ? run.limitReached : false;

  // A link button: an href with no action wire navigates, which is exactly
  // what a "Pricing" or "Book a call" button on a marketing page should do.
  if (!isAction && node.href) {
    return (
      <a
        {...shell.test}
        href={node.href}
        className={cx(className, "hover:opacity-90")}
        style={paint}
        data-spec-wired="href"
      >
        {node.label}
      </a>
    );
  }

  return (
    <button
      {...shell.test}
      type="button"
      // An unwired button is decoration: real, styled, focusable — and inert.
      // It is deliberately NOT disabled, so a page an architect is still
      // wiring never looks broken to them.
      onClick={isAction && run ? () => run.runAction({ channel, buttonLabel: node.label }) : undefined}
      disabled={busy || blocked}
      aria-busy={busy || undefined}
      data-spec-wired={isAction ? "action" : "none"}
      data-spec-channel={isAction ? channel : undefined}
      className={cx(className, busy || blocked ? "opacity-70" : "hover:opacity-90")}
      style={paint}
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
          Working on it…
        </>
      ) : (
        node.label
      )}
    </button>
  );
});

// ---------------------------------------------------------------------------
// input.
// ---------------------------------------------------------------------------

export const InputNodeView = memo(function InputNodeView({
  node,
  surface,
  align
}: InteractiveNodeProps<InputNode>) {
  const run = useSpecRun();
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const reactId = useId();
  const fieldId = `spec-field-${node.id}-${reactId}`;

  const wired = node.wire?.role === "input";
  const value = wired && run ? run.values[node.id]?.value ?? "" : undefined;

  const common = {
    id: fieldId,
    placeholder: node.placeholder,
    "aria-label": node.label ?? node.placeholder ?? "Your message",
    className: FIELD_SHELL,
    style: fieldStyle(shell.surface),
    // Unwired fields stay uncontrolled — the customer can still type in them,
    // the page just never reads what they wrote.
    ...(wired && run
      ? {
          value,
          onChange: (event: { target: { value: string } }) =>
            run.setValue(node.id, { value: event.target.value })
        }
      : {})
  };

  return (
    <div
      {...shell.test}
      className={cx("w-full", TEXT_ALIGN.left, shell.className)}
      data-spec-wired={wired ? "input" : "none"}
    >
      {node.label ? (
        <FieldLabel htmlFor={fieldId} surface={shell.surface}>
          {node.label}
        </FieldLabel>
      ) : null}
      {node.multiline ? (
        <textarea rows={4} {...common} className={cx(FIELD_SHELL, "resize-y")} />
      ) : (
        <input type="text" {...common} />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// upload.
//
// NOTE for the integrator: `AgentPageRuntime` has no file channel — `runOnce`
// takes a prompt and nothing else. So this node attaches the file's NAME to
// the prompt as context and says exactly that in the UI ("Attached", not
// "Uploaded"). The bytes stay in the browser. Wiring real uploads needs a new
// runtime method; see the report.
// ---------------------------------------------------------------------------

export const UploadNodeView = memo(function UploadNodeView({
  node,
  surface,
  align
}: InteractiveNodeProps<UploadNode>) {
  const run = useSpecRun();
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(shell.surface);
  const reactId = useId();
  const fieldId = `spec-upload-${node.id}-${reactId}`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [localName, setLocalName] = useState<string | null>(null);

  const wired = node.wire?.role === "input";
  const stored = wired && run ? run.values[node.id] : undefined;
  const fileName = stored?.value ?? localName;

  function accept(file: File | undefined) {
    if (!file) return;
    setLocalName(file.name);
    if (wired && run) {
      run.setValue(node.id, { value: file.name, detail: humanSize(file.size) });
    }
  }

  function clear() {
    setLocalName(null);
    if (inputRef.current) inputRef.current.value = "";
    if (wired && run) run.setValue(node.id, null);
  }

  if (fileName) {
    return (
      <div
        {...shell.test}
        data-spec-wired={wired ? "input" : "none"}
        className={cx(
          "flex w-full items-center gap-3 rounded-2xl border px-4 py-3",
          shell.className
        )}
        style={{ background: ink.card, borderColor: ink.border, color: ink.ink }}
      >
        <Paperclip className="h-4 w-4 shrink-0" style={{ color: ink.accentInk }} aria-hidden />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{fileName}</span>
        {stored?.detail ? (
          <span className="shrink-0 text-xs" style={{ color: ink.subtle }}>
            {stored.detail}
          </span>
        ) : null}
        <button
          type="button"
          onClick={clear}
          data-testid={`spec-upload-clear-${node.id}`}
          aria-label={`Remove ${fileName}`}
          className="shrink-0 rounded-lg p-1 transition hover:opacity-70 motion-reduce:transition-none"
          style={{ color: ink.subtle }}
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <input
          ref={inputRef}
          id={fieldId}
          type="file"
          accept={node.accept}
          className="sr-only"
          onChange={(event) => accept(event.target.files?.[0])}
        />
      </div>
    );
  }

  return (
    <label
      {...shell.test}
      htmlFor={fieldId}
      data-spec-wired={wired ? "input" : "none"}
      className={cx(
        "flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border border-dashed px-5 py-8 text-center transition hover:opacity-90 motion-reduce:transition-none",
        shell.className
      )}
      style={{ background: ink.card, borderColor: ink.border, color: ink.muted }}
    >
      <UploadGlyph className="h-6 w-6" style={{ color: ink.accentInk }} aria-hidden />
      <span className="text-sm font-semibold" style={{ color: ink.ink }}>
        {node.label ?? "Add a file"}
      </span>
      <input
        ref={inputRef}
        id={fieldId}
        type="file"
        accept={node.accept}
        className="sr-only"
        onChange={(event) => accept(event.target.files?.[0])}
      />
    </label>
  );
});

/** A file size a person can read. Display only — never sent to the engine. */
function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// choice.
// ---------------------------------------------------------------------------

/** Up to this many options render as tappable pills; beyond it, a select. */
const PILL_CHOICE_LIMIT = 4;

export const ChoiceNodeView = memo(function ChoiceNodeView({
  node,
  surface,
  align
}: InteractiveNodeProps<ChoiceNode>) {
  const run = useSpecRun();
  const shell = nodeShell(node, surface, align, { skipCard: true });
  const ink = surfaceInk(shell.surface);
  const reactId = useId();
  const fieldId = `spec-choice-${node.id}-${reactId}`;

  const wired = node.wire?.role === "input";
  const [localValue, setLocalValue] = useState<string>("");
  const selected = wired && run ? run.values[node.id]?.value ?? "" : localValue;

  function pick(option: string) {
    setLocalValue(option);
    if (wired && run) run.setValue(node.id, { value: option });
  }

  const label = node.label;
  const wireAttr = wired ? "input" : "none";

  // A short list reads as pills — faster to tap on a phone than a select, and
  // it shows every option at once, which is what a product page wants.
  if (node.options.length > 0 && node.options.length <= PILL_CHOICE_LIMIT) {
    return (
      <div
        {...shell.test}
        data-spec-wired={wireAttr}
        className={cx("w-full text-left", shell.className)}
        role="group"
        aria-label={label ?? "Choose an option"}
      >
        {label ? (
          <span className="mb-1.5 block text-sm font-medium" style={{ color: ink.ink }}>
            {label}
          </span>
        ) : null}
        <div className="flex flex-wrap gap-2">
          {node.options.map((option, index) => {
            const active = option === selected;
            return (
              <button
                key={`${node.id}-${index}`}
                type="button"
                aria-pressed={active}
                data-testid={`spec-choice-option-${node.id}-${index}`}
                onClick={() => pick(option)}
                className="inline-flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-4 motion-reduce:transition-none"
                style={
                  active
                    ? {
                        background: "var(--spec-accent)",
                        color: "var(--spec-accent-contrast)",
                        borderColor: "var(--spec-accent)",
                        ["--tw-ring-color" as string]: "var(--spec-accent-soft)"
                      }
                    : {
                        background: ink.card,
                        color: ink.ink,
                        borderColor: ink.border,
                        ["--tw-ring-color" as string]: "var(--spec-accent-soft)"
                      }
                }
              >
                {active ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
                {option}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div
      {...shell.test}
      data-spec-wired={wireAttr}
      className={cx("w-full text-left", shell.className)}
    >
      {label ? (
        <FieldLabel htmlFor={fieldId} surface={shell.surface}>
          {label}
        </FieldLabel>
      ) : null}
      <div className="relative">
        <select
          id={fieldId}
          aria-label={label ?? "Choose an option"}
          value={selected}
          onChange={(event) => pick(event.target.value)}
          className={cx(FIELD_SHELL, "appearance-none pr-11")}
          style={fieldStyle(shell.surface)}
        >
          <option value="">Choose…</option>
          {node.options.map((option, index) => (
            <option key={`${node.id}-${index}`} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: ink.subtle }}
          aria-hidden
        />
      </div>
    </div>
  );
});
