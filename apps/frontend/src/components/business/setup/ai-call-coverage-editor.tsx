"use client";

import type { WorkflowTriggerKind } from "@coreai/shared";

export type AiCoverageKind = "always" | "business_hours" | "custom";

export type AnsweringDayRow = {
  day: string;
  open: string;
  close: string;
  closed: boolean;
};

export const ANSWERING_WEEK_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday"
] as const;

export function defaultAnsweringDays(): AnsweringDayRow[] {
  return ANSWERING_WEEK_DAYS.map((day) => ({
    day,
    open: "09:00",
    close: "18:00",
    closed: day === "Saturday" || day === "Sunday"
  }));
}

const getDynamicText = (triggerKind: WorkflowTriggerKind) => {
  if (triggerKind === "inbound_sms") {
    return {
      sectionTitle: "AI SMS Coverage",
      sectionDescription: "When the AI responds to texts.",
      badgeTitle: {
        always: "24/7",
        business_hours: "Using Business Hours",
        custom: "Custom AI SMS Schedule"
      },
      optionAlwaysTitle: "Respond to SMS 24/7",
      optionAlwaysDesc: "Nights, weekends, and holidays included.",
      optionBhTitle: "Respond during Business Hours",
      optionBhDesc: "Only while your business is open.",
      optionCustomTitle: "Use a custom response schedule",
      optionCustomDesc: "Set your own days and times.",
      alwaysNote: "The AI responds around the clock — and still tells texters when you're closed and when you reopen.",
      bhNoteHeading: "The AI responds during these Business Hours",
      bhNoteFooter: "Texts outside these hours get no AI response. If hours are unknown, the AI responds anyway.",
      customHeading: "Custom AI SMS Schedule",
      customSubheading: "Only controls when the AI responds to texts.",
      dayRowLabel: (day: string) => `AI responds on ${day}`,
      closedLabel: "Not responding",
      openStartAria: (day: string) => `${day} responding starts`,
      openEndAria: (day: string) => `${day} responding ends`
    };
  }
  if (triggerKind === "missed_call") {
    return {
      sectionTitle: "AI Text-back Coverage",
      sectionDescription: "When the AI sends text-backs.",
      badgeTitle: {
        always: "24/7",
        business_hours: "Using Business Hours",
        custom: "Custom AI Text-back Schedule"
      },
      optionAlwaysTitle: "Text back 24/7",
      optionAlwaysDesc: "Nights, weekends, and holidays included.",
      optionBhTitle: "Text back during Business Hours",
      optionBhDesc: "Only while your business is open.",
      optionCustomTitle: "Use a custom text-back schedule",
      optionCustomDesc: "Set your own days and times.",
      alwaysNote: "The AI texts back around the clock — and still tells callers when you're closed and when you reopen.",
      bhNoteHeading: "The AI sends text-backs during these Business Hours",
      bhNoteFooter: "Missed calls outside these hours get no text-back. If hours are unknown, the AI texts back anyway.",
      customHeading: "Custom AI Text-back Schedule",
      customSubheading: "Only controls when the AI sends text-backs.",
      dayRowLabel: (day: string) => `AI texts back on ${day}`,
      closedLabel: "Not texting back",
      openStartAria: (day: string) => `${day} text-back starts`,
      openEndAria: (day: string) => `${day} text-back ends`
    };
  }
  // Default to voice / general
  return {
    sectionTitle: "AI Call Coverage",
    sectionDescription: "When the AI answers calls.",
    badgeTitle: {
      always: "24/7",
      business_hours: "Using Business Hours",
      custom: "Custom AI Answering Schedule"
    },
    optionAlwaysTitle: "Answer calls 24/7",
    optionAlwaysDesc: "Nights, weekends, and holidays included.",
    optionBhTitle: "Answer during Business Hours",
    optionBhDesc: "Only while your business is open.",
    optionCustomTitle: "Use a custom answering schedule",
    optionCustomDesc: "Set your own days and times.",
    alwaysNote: "The AI answers around the clock — and still tells callers when you're closed and when you reopen.",
    bhNoteHeading: "The AI answers during these Business Hours",
    bhNoteFooter: "Calls outside these hours are not answered. If hours are unknown, the AI answers anyway.",
    customHeading: "Custom AI Answering Schedule",
    customSubheading: "Only controls when the AI picks up.",
    dayRowLabel: (day: string) => `AI answers on ${day}`,
    closedLabel: "Not answering",
    openStartAria: (day: string) => `${day} answering starts`,
    openEndAria: (day: string) => `${day} answering ends`
  };
};

export function AiCallCoverageEditor({
  kind,
  onKind,
  answeringDays,
  onAnsweringDay,
  businessHoursSummary,
  businessHoursConfigured,
  triggerKind = "voice"
}: {
  kind: AiCoverageKind;
  onKind: (kind: AiCoverageKind) => void;
  answeringDays: AnsweringDayRow[];
  onAnsweringDay: (day: string, patch: Partial<AnsweringDayRow>) => void;
  businessHoursSummary: string[] | null;
  businessHoursConfigured: boolean;
  triggerKind?: WorkflowTriggerKind;
}) {
  const t = getDynamicText(triggerKind);
  const options: { kind: AiCoverageKind; title: string; description: string }[] = [
    {
      kind: "always",
      title: t.optionAlwaysTitle,
      description: t.optionAlwaysDesc
    },
    {
      kind: "business_hours",
      title: t.optionBhTitle,
      description: t.optionBhDesc
    },
    {
      kind: "custom",
      title: t.optionCustomTitle,
      description: t.optionCustomDesc
    }
  ];

  return (
    <div data-testid="business-setup-ai-coverage">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900">{t.sectionTitle}</h4>
          <p className="mt-0.5 text-xs text-slate-500">{t.sectionDescription}</p>
        </div>
        <span
          className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600"
          data-testid="business-setup-ai-coverage-source"
        >
          {t.badgeTitle[kind]}
        </span>
      </div>

      <div className="mt-3 space-y-2" role="radiogroup" aria-label="AI call coverage">
        {options.map((option) => {
          const selected = kind === option.kind;
          return (
            <button
              key={option.kind}
              type="button"
              role="radio"
              aria-checked={selected}
              data-testid={`business-setup-ai-coverage-${option.kind}`}
              onClick={() => onKind(option.kind)}
              className={`pick flex w-full items-start gap-3 rounded-xl border p-3.5 text-left ${
                selected ? "selected" : "border-gray-200 bg-white"
              }`}
            >
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  selected ? "border-amber-500" : "border-slate-300"
                }`}
              >
                {selected ? <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-800">{option.title}</span>
                  {option.kind === "always" ? (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      Recommended
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
              </span>
            </button>
          );
        })}
      </div>

      {kind === "always" ? (
        <p className="mt-3 rounded-xl bg-slate-50 px-4 py-3 text-xs text-slate-600" data-testid="business-setup-ai-coverage-always-note">
          {t.alwaysNote}
        </p>
      ) : null}

      {kind === "business_hours" ? (
        <div
          className="mt-3 rounded-xl border border-gray-100 bg-slate-50 px-4 py-3"
          data-testid="business-setup-ai-coverage-bh-summary"
        >
          {businessHoursConfigured && businessHoursSummary ? (
            <>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                {t.bhNoteHeading}
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-slate-600">
                {businessHoursSummary.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-slate-400">
                {t.bhNoteFooter}
              </p>
            </>
          ) : (
            <p className="text-xs font-semibold text-amber-700">
              {triggerKind === "inbound_sms"
                ? "Business Hours are not set yet — the AI responds to all texts until they are."
                : triggerKind === "missed_call"
                  ? "Business Hours are not set yet — the AI texts back all missed calls until they are."
                  : "Business Hours are not set yet — the AI answers all calls until they are."}
            </p>
          )}
        </div>
      ) : null}

      {kind === "custom" ? (
        <div
          className="mt-3 rounded-xl border border-gray-100 bg-slate-50 p-4"
          data-testid="business-setup-ai-coverage-custom-editor"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            {t.customHeading}
          </p>
          <p className="mt-0.5 text-xs text-slate-400">
            {t.customSubheading}
          </p>
          <div className="mt-3 overflow-hidden rounded-xl border border-gray-100 bg-white">
            {answeringDays.map((row) => (
              <div
                key={row.day}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-gray-100 px-3.5 py-2.5 last:border-b-0"
                data-testid="business-setup-ai-coverage-day-row"
              >
                <label className="flex w-28 shrink-0 items-center gap-2.5 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={!row.closed}
                    aria-label={t.dayRowLabel(row.day)}
                    onChange={(e) => onAnsweringDay(row.day, { closed: !e.target.checked })}
                    data-testid={`business-setup-ai-coverage-day-${row.day.toLowerCase()}`}
                    className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
                  />
                  {row.day}
                </label>
                {row.closed ? (
                  <span className="text-sm text-slate-400">{t.closedLabel}</span>
                ) : (
                  <>
                    <input
                      type="time"
                      value={row.open}
                      aria-label={t.openStartAria(row.day)}
                      onChange={(e) => onAnsweringDay(row.day, { open: e.target.value })}
                      data-testid="business-setup-ai-coverage-day-open"
                      className="field rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium tabular-nums text-slate-700 outline-none"
                    />
                    <span className="text-xs text-slate-400" aria-hidden="true">
                      –
                    </span>
                    <input
                      type="time"
                      value={row.close}
                      aria-label={t.openEndAria(row.day)}
                      onChange={(e) => onAnsweringDay(row.day, { close: e.target.value })}
                      data-testid="business-setup-ai-coverage-day-close"
                      className="field rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-sm font-medium tabular-nums text-slate-700 outline-none"
                    />
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
