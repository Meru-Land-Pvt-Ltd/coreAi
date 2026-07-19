"use client";

import type { ReactNode } from "react";
import { isBuyerAnswerEmpty, validateBuyerSetupAnswers } from "@coreai/shared";
import type { BuyerSetupFieldDef } from "@/components/business/features/api";
import { FIELD, LABEL } from "./ui";

/** Wide controls that should span both grid columns. */
const FULL_WIDTH_FIELD_TYPES = new Set(["textarea", "multiselect"]);

const HTML_INPUT_TYPE_BY_FIELD_TYPE: Record<string, string> = {
  phone: "tel",
  email: "email",
  url: "url",
  number: "number",
  date: "date",
  time: "time"
};

export function BuyerSetupFieldControl({
  field,
  value,
  onChange
}: {
  field: BuyerSetupFieldDef;
  value: string | string[] | boolean | undefined;
  onChange: (value: string | string[] | boolean) => void;
}) {
  const inputId = `custom-field-${field.key}`;
  const testId = `business-setup-custom-field-${field.key}`;
  const options = (field.options ?? []).filter((option) => option.trim());

  const inlineIssue =
    value !== undefined && !isBuyerAnswerEmpty(value)
      ? validateBuyerSetupAnswers([field], [{ key: field.key, label: field.label, value }], {
          requireMissing: false
        })[0]
      : undefined;

  const textValue = typeof value === "string" ? value : "";
  const selectedOptions = Array.isArray(value)
    ? value
    : typeof value === "string" && value
      ? value.split(",").map((item) => item.trim()).filter(Boolean)
      : [];
  const booleanValue = value === true || (typeof value === "string" && /^(yes|true)$/i.test(value));

  let control: ReactNode;

  if (field.type === "textarea") {
    control = (
      <textarea
        data-testid={testId}
        id={inputId}
        value={textValue}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className={FIELD}
      />
    );
  } else if (field.type === "select") {
    control = (
      <select
        data-testid={testId}
        id={inputId}
        value={textValue}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      >
        <option value="">{field.placeholder || "Select an option…"}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  } else if (field.type === "multiselect") {
    control = (
      <div data-testid={testId} className="mt-1 flex flex-wrap gap-2">
        {options.map((option, optionIndex) => {
          const checked = selectedOptions.includes(option);
          return (
            <label
              key={option}
              className={`pick flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                checked ? "selected border-amber-400" : "border-gray-200"
              }`}
            >
              <input
                type="checkbox"
                data-testid={`${testId}-option-${optionIndex}`}
                checked={checked}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...selectedOptions, option]
                      : selectedOptions.filter((item) => item !== option)
                  )
                }
                className="h-3.5 w-3.5 accent-amber-500"
              />
              <span className="font-medium text-slate-700">{option}</span>
            </label>
          );
        })}
      </div>
    );
  } else if (field.type === "boolean") {
    control = (
      <label className="mt-1 flex cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700">
        <input
          type="checkbox"
          data-testid={testId}
          id={inputId}
          checked={booleanValue}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4 accent-amber-500"
        />
        Yes
      </label>
    );
  } else {
    control = (
      <input
        data-testid={testId}
        id={inputId}
        type={HTML_INPUT_TYPE_BY_FIELD_TYPE[field.type] ?? "text"}
        value={textValue}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    );
  }

  return (
    <div className={FULL_WIDTH_FIELD_TYPES.has(field.type) ? "sm:col-span-2" : undefined}>
      <label className={LABEL} htmlFor={inputId}>
        {field.label} {field.required ? "" : "optional"}
      </label>
      {control}
      {field.helper ? <p className="mt-1 text-xs text-slate-400">{field.helper}</p> : null}
      {inlineIssue ? (
        <p className="mt-1 text-xs text-red-500" data-testid={`business-setup-custom-field-error-${field.key}`}>
          {inlineIssue.message}
        </p>
      ) : null}
    </div>
  );
}
