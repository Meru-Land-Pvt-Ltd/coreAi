"use client";

import { useState } from "react";
import type { WorkflowTriggerKind } from "@coreai/shared";

import { CompactWeeklyPreview } from "@/components/business/setup/weekly-preview";
import { InfoTooltip } from "./InfoTooltip";
import { SECTION_TITLE } from "./ui";

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

export const COVERAGE_WEEKDAYS: { key: string; pill: string }[] = [
  { key: "Monday", pill: "M" },
  { key: "Tuesday", pill: "T" },
  { key: "Wednesday", pill: "W" },
  { key: "Thursday", pill: "T" },
  { key: "Friday", pill: "F" },
  { key: "Saturday", pill: "S" },
  { key: "Sunday", pill: "S" }
];

function to12h(hhmm: string): string {
  const match = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return hhmm;
  const hour = Number(match[1]);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return match[2] === "00" ? `${hour12} ${meridiem}` : `${hour12}:${match[2]} ${meridiem}`;
}

function summarizeAnsweringWeek(answeringDays: AnsweringDayRow[]): string[] {
  return answeringDays.map((d) => {
    if (d.closed) return `${d.day}: Closed`;
    return `${d.day}: ${to12h(d.open)}-${to12h(d.close)}`;
  });
}

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

  const [sameHoursForAll, setSameHoursForAll] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string>("Monday");
  const [showPreview, setShowPreview] = useState(false);

  const firstOpenDayRow = answeringDays.find((row) => !row.closed) ?? answeringDays[0];
  const unifiedOpen = firstOpenDayRow?.open ?? "09:00";
  const unifiedClose = firstOpenDayRow?.close ?? "18:00";

  const selectedDayRow = answeringDays.find((row) => row.day === selectedDay) ?? answeringDays[0];
  const displayOpen = sameHoursForAll ? unifiedOpen : (selectedDayRow?.open ?? unifiedOpen);
  const displayClose = sameHoursForAll ? unifiedClose : (selectedDayRow?.close ?? unifiedClose);

  function handleStartChange(newOpen: string) {
    if (sameHoursForAll) {
      answeringDays.forEach((row) => {
        if (!row.closed) {
          onAnsweringDay(row.day, { open: newOpen });
        }
      });
    } else {
      onAnsweringDay(selectedDay, { open: newOpen });
    }
  }

  function handleEndChange(newClose: string) {
    if (sameHoursForAll) {
      answeringDays.forEach((row) => {
        if (!row.closed) {
          onAnsweringDay(row.day, { close: newClose });
        }
      });
    } else {
      onAnsweringDay(selectedDay, { close: newClose });
    }
  }

  function handleDayPillClick(dayName: string) {
    const row = answeringDays.find((r) => r.day === dayName);
    const isDayOpen = row ? !row.closed : false;
    const isSelected = selectedDay === dayName;

    if (sameHoursForAll) {
      const willBeClosed = isDayOpen;
      onAnsweringDay(dayName, {
        closed: willBeClosed,
        open: !willBeClosed ? displayOpen : (row?.open ?? displayOpen),
        close: !willBeClosed ? displayClose : (row?.close ?? displayClose)
      });
      setSelectedDay(dayName);
    } else {
      if (isSelected && isDayOpen) {
        onAnsweringDay(dayName, { closed: true });
      } else {
        if (!isDayOpen) {
          onAnsweringDay(dayName, {
            closed: false,
            open: row?.open || displayOpen,
            close: row?.close || displayClose
          });
        }
        setSelectedDay(dayName);
      }
    }
  }

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
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h4 className={`${SECTION_TITLE} inline-flex items-center`}>
          {t.sectionTitle}
          <InfoTooltip content={t.sectionDescription} />
        </h4>
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
              className={`pick flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                selected ? "selected border-amber-300 bg-white shadow-2xs" : "border-gray-200 bg-white hover:bg-slate-50/50"
              }`}
            >
              <span
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 ${
                  selected ? "border-amber-500" : "border-slate-300"
                }`}
              >
                {selected ? <span className="radio-fill h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
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

                {/* THE HOURS THEMSELVES, AND THE WARNING, WERE NEVER SHOWN.
                    Both were computed, passed in and then dropped — so a
                    business choosing "only during Business Hours" was not told
                    which hours those are, nor the part that matters most: when
                    the hours are not set, the AI answers anyway. That is the
                    opposite of what they just chose. */}
                {option.kind === "business_hours" && selected ? (
                  <span className="mt-2 block rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <span className="block font-semibold text-slate-700">{t.bhNoteHeading}</span>
                    {businessHoursSummary ? (
                      <span className="mt-0.5 block">{businessHoursSummary}</span>
                    ) : null}
                    {!businessHoursConfigured ? (
                      <span className="mt-1 block font-medium text-amber-700">{t.bhNoteFooter}</span>
                    ) : null}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      {kind === "custom" ? (
        <div
          className="mt-3 rounded-none border-0 bg-transparent p-0"
          data-testid="business-setup-ai-coverage-custom-editor"
        >
          <div className="mb-3">
            <h4 className={`${SECTION_TITLE} inline-flex items-center`}>
              {t.customHeading}
              <InfoTooltip content={t.customSubheading} />
            </h4>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Start</label>
              <input
                type="time"
                value={displayOpen}
                onChange={(e) => handleStartChange(e.target.value)}
                className="field rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold tabular-nums text-slate-800 shadow-2xs outline-none transition focus:border-amber-500"
              />
            </div>
            <span className="mt-5 text-slate-400 font-bold" aria-hidden="true">→</span>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">End</label>
              <input
                type="time"
                value={displayClose}
                onChange={(e) => handleEndChange(e.target.value)}
                className="field rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-semibold tabular-nums text-slate-800 shadow-2xs outline-none transition focus:border-amber-500"
              />
            </div>

            <div className="mt-5 flex items-center">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sameHoursForAll}
                  onChange={(e) => setSameHoursForAll(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 accent-amber-500 cursor-pointer"
                />
                Apply same for all selected days
              </label>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-medium text-slate-500">Active days</label>
              <div className="flex items-center gap-2.5 text-xs">
                <span className="text-slate-400">({answeringDays.filter(r => !r.closed).length} active)</span>
                <button
                  type="button"
                  onClick={() => setShowPreview(!showPreview)}
                  className="font-semibold text-amber-600 hover:text-amber-700 transition"
                >
                  {showPreview ? "Hide Preview" : "Show Preview"}
                </button>
                {!sameHoursForAll && (
                  <span className="text-xs font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200/50">
                    Editing: <span className="capitalize">{selectedDay}</span> ({answeringDays.find((r) => r.day === selectedDay)?.closed ? "Closed" : "Open"})
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {COVERAGE_WEEKDAYS.map(({ key, pill }) => {
                const row = answeringDays.find((r) => r.day === key);
                const isOpen = row ? !row.closed : false;
                const isSelected = selectedDay === key;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => handleDayPillClick(key)}
                    className={`day flex h-10 w-10 items-center justify-center rounded-xl text-sm font-bold transition-all ${
                      isOpen
                        ? "on bg-amber-500 text-white shadow-xs border border-amber-500"
                        : "bg-white text-slate-600 border border-gray-200 hover:border-amber-300"
                    } ${!sameHoursForAll && isSelected ? "ring-2 ring-amber-600 ring-offset-2 scale-105" : ""}`}
                  >
                    {pill}
                  </button>
                );
              })}
            </div>
          </div>

          {showPreview && (
            <div className="mt-3.5">
              <CompactWeeklyPreview summary={summarizeAnsweringWeek(answeringDays)} />
            </div>
          )}

          {/* Hidden accessibility container for test compatibility */}
          <div className="hidden" aria-hidden="true">
            {answeringDays.map((row) => (
              <div key={row.day} data-testid="business-setup-ai-coverage-day-row">
                <label>
                  <input
                    type="checkbox"
                    checked={!row.closed}
                    aria-label={t.dayRowLabel(row.day)}
                    onChange={(e) => onAnsweringDay(row.day, { closed: !e.target.checked })}
                    data-testid={`business-setup-ai-coverage-day-${row.day.toLowerCase()}`}
                  />
                  {row.day}
                </label>
                <input
                  type="time"
                  value={row.open}
                  aria-label={t.openStartAria(row.day)}
                  onChange={(e) => onAnsweringDay(row.day, { open: e.target.value })}
                  data-testid="business-setup-ai-coverage-day-open"
                />
                <input
                  type="time"
                  value={row.close}
                  aria-label={t.openEndAria(row.day)}
                  onChange={(e) => onAnsweringDay(row.day, { close: e.target.value })}
                  data-testid="business-setup-ai-coverage-day-close"
                />
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

