"use client";

/**
 * THE BUSINESS'S SCREENS — one renderer, used by two people.
 *
 * A business opens this in production. An architect opens the SAME component
 * in their preview, in test mode. That is deliberate and it is the whole
 * point: an architect who signs off a preview has seen precisely what their
 * customer will see, not an approximation of it.
 *
 * Nothing here decides what appears. The arrangement — which questions, which
 * numbers, what wording, what order — is whatever Smart Designer composed from
 * the architect's nodes. This file only knows how to paint the block types the
 * spec can contain, and how to wire the real controls to the ids it used.
 */

import { useState } from "react";

export type SurfaceBlock = {
  id: string;
  type: string;
  text?: string;
  label?: string;
  value?: string;
  level?: number;
  variant?: string;
  placeholder?: string;
  multiline?: boolean;
  kind?: string;
  options?: string[];
  items?: string[];
  blocks?: SurfaceBlock[];
};

export type BuyerContractLite = {
  inputs: Array<{ key: string; label: string; help: string; kind: string; required: boolean }>;
  connections: Array<{ key: string; label: string; help: string; connector: string; optional: boolean }>;
  metrics: Array<{ key: string; label: string; help: string }>;
  verification: Array<{ channel: string; label: string; requirement: string }>;
  summary: string;
};

export type SurfaceSpec = { pages: Array<{ title?: string; blocks: SurfaceBlock[] }> } | null;

export type BuyerSurfaceProps = {
  spec: SurfaceSpec;
  contract: BuyerContractLite;
  /** Saved answers, so a form comes back filled rather than blank. */
  answers?: Record<string, unknown>;
  tables?: Record<string, Array<Record<string, string>>>;
  /** Production for the business; test for the architect's preview. */
  mode: "live" | "test";
  onAnswer?: (key: string, value: string) => void;
  onAction?: (key: string) => void;
  /** Connect an account (Google Calendar and friends). */
  onConnect?: (connector: string) => void;
  /** Whether each connector is already connected. */
  connected?: Record<string, boolean>;
  /**
   * Live state for a control the composer placed.
   *
   * The design says "there is a start/stop control here"; only the page knows
   * whether the list is running right now. Without this the button reads
   * "Start calling" while it is already calling, which is how someone presses
   * it twice.
   */
  actionState?: Record<string, { label?: string; danger?: boolean }>;
  emptyMessage?: string;
};

/** Native input type for a derived field kind. */
function inputTypeFor(kind: string | undefined): string {
  switch (kind) {
    case "phone":
      return "tel";
    case "email":
      return "email";
    case "url":
      return "url";
    case "number":
      return "number";
    // A business supplying their own API key must not have it sitting in
    // cleartext on a screen someone else may be standing next to.
    case "secret":
      return "password";
    case "date":
      return "date";
    case "time":
      return "time";
    default:
      return "text";
  }
}

export function BuyerSurface({
  spec,
  contract,
  answers = {},
  tables = {},
  mode,
  onAnswer,
  onAction,
  onConnect,
  connected = {},
  actionState = {},
  emptyMessage = "This screen hasn't been designed yet."
}: BuyerSurfaceProps) {
  const [local, setLocal] = useState<Record<string, string>>({});
  const blocks = spec?.pages?.[0]?.blocks ?? [];

  const valueOf = (key: string): string => {
    if (key in local) return local[key];
    const saved = answers[key];
    return saved === undefined || saved === null ? "" : String(saved);
  };

  const setValue = (key: string, value: string) => {
    setLocal((current) => ({ ...current, [key]: value }));
    onAnswer?.(key, value);
  };

  const helpFor = (id: string): string =>
    contract.inputs.find((input) => input.key === id)?.help ??
    contract.metrics.find((metric) => metric.key === id || id.endsWith(metric.key))?.help ??
    contract.connections.find((connection) => connection.key === id)?.help ??
    "";

  const renderBlock = (block: SurfaceBlock): React.ReactNode => {
    switch (block.type) {
      case "heading":
        return (
          <h2
            key={block.id}
            data-testid={`surface-heading-${block.id}`}
            className={
              block.level === 1
                ? "mt-2 text-2xl font-bold text-slate-900"
                : "mt-8 text-sm font-bold uppercase tracking-wider text-slate-400"
            }
          >
            {block.text}
          </h2>
        );

      case "text":
        return (
          <p key={block.id} className="mt-1 text-sm leading-6 text-slate-500">
            {block.text}
          </p>
        );

      case "stat":
        return (
          <div
            key={block.id}
            data-testid={`surface-stat-${block.id}`}
            className="rounded-2xl border border-gray-200 bg-white p-5"
          >
            <div className="text-3xl font-bold tabular-nums text-amber-600">{block.value}</div>
            <div className="mt-1 text-sm font-medium text-slate-600">{block.label}</div>
            {helpFor(block.id) ? (
              <div className="mt-0.5 text-[11px] leading-4 text-slate-400">{helpFor(block.id)}</div>
            ) : null}
          </div>
        );

      case "input": {
        const isConnection = contract.connections.some((connection) => connection.key === block.id);
        if (isConnection) return null;
        return (
          <div key={block.id} data-testid={`surface-field-${block.id}`} className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-slate-800" htmlFor={`field-${block.id}`}>
              {block.label}
            </label>
            {block.multiline || block.kind === "longtext" ? (
              <textarea
                id={`field-${block.id}`}
                value={valueOf(block.id)}
                onChange={(event) => setValue(block.id, event.target.value)}
                placeholder={block.placeholder}
                data-testid={`surface-input-${block.id}`}
                className="h-28 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
              />
            ) : (
              <input
                id={`field-${block.id}`}
                type={inputTypeFor(block.kind)}
                value={valueOf(block.id)}
                onChange={(event) => setValue(block.id, event.target.value)}
                placeholder={block.placeholder}
                data-testid={`surface-input-${block.id}`}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40"
              />
            )}
            {helpFor(block.id) ? <p className="mt-1 text-[11px] text-slate-400">{helpFor(block.id)}</p> : null}
          </div>
        );
      }

      case "choice":
        return (
          <div key={block.id} data-testid={`surface-field-${block.id}`} className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-slate-800">{block.label}</label>
            <select
              value={valueOf(block.id)}
              onChange={(event) => setValue(block.id, event.target.value)}
              data-testid={`surface-input-${block.id}`}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-amber-300"
            >
              <option value="">Choose…</option>
              {(block.options ?? []).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        );

      case "upload":
        return (
          <div key={block.id} data-testid={`surface-upload-${block.id}`} className="mt-4 rounded-2xl border border-gray-200 bg-white p-5">
            <label className="text-sm font-semibold text-slate-800">{block.label}</label>
            {helpFor(block.id) ? <p className="mt-1 text-[11px] text-slate-400">{helpFor(block.id)}</p> : null}
            <textarea
              value={valueOf(block.id)}
              onChange={(event) => setValue(block.id, event.target.value)}
              placeholder={"Priya, +15551234567\nSam, +15559876543"}
              data-testid={`surface-upload-input-${block.id}`}
              className="mt-3 h-32 w-full resize-y rounded-lg border border-gray-200 px-3 py-2 font-mono text-xs outline-none focus:border-amber-300"
            />
            <button
              type="button"
              onClick={() => onAction?.(block.id)}
              data-testid={`surface-upload-submit-${block.id}`}
              className="mt-3 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-amber-500/25 transition hover:-translate-y-0.5 hover:bg-amber-600"
            >
              Add them
            </button>
          </div>
        );

      case "button": {
        const connection = contract.connections.find((entry) => entry.key === block.id);
        if (connection) {
          const isConnected = connected[connection.connector] === true;
          return (
            <div
              key={block.id}
              data-testid={`surface-connect-${block.id}`}
              className="mt-4 flex items-center justify-between gap-4 rounded-2xl border border-gray-200 bg-white p-5"
            >
              <div>
                <div className="text-sm font-semibold text-slate-800">{block.label}</div>
                <p className="mt-1 text-[11px] text-slate-400">{connection.help}</p>
              </div>
              <button
                type="button"
                onClick={() => onConnect?.(connection.connector)}
                disabled={isConnected}
                data-testid={`surface-connect-button-${block.id}`}
                className={`rounded-lg px-4 py-2 text-sm font-semibold transition ${
                  isConnected
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-amber-500 text-white shadow-lg shadow-amber-500/25 hover:-translate-y-0.5 hover:bg-amber-600"
                }`}
              >
                {isConnected ? "Connected" : "Connect"}
              </button>
            </div>
          );
        }
        const state = actionState[block.id];
        return (
          <button
            key={block.id}
            type="button"
            onClick={() => onAction?.(block.id)}
            data-testid={`surface-action-${block.id}`}
            className={`mt-4 w-full rounded-xl py-2.5 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 ${
              state?.danger
                ? // Stopping stays red on purpose. It is the one control where
                  // the brand colour would be wrong: a stop button that looks
                  // like every other button gets pressed by mistake, and on a
                  // dialler that means calls nobody meant to make.
                  "bg-rose-600 shadow-rose-600/25 hover:bg-rose-500"
                : "bg-amber-500 shadow-amber-500/25 hover:bg-amber-600"
            }`}
          >
            {state?.label ?? block.label}
          </button>
        );
      }

      case "result": {
        const rows = tables[block.id] ?? [];
        const columns = rows[0] ? Object.keys(rows[0]) : [];
        return (
          <div
            key={block.id}
            data-testid={`surface-table-${block.id}`}
            className="mt-4 overflow-x-auto rounded-2xl border border-gray-200 bg-white"
          >
            {rows.length === 0 ? (
              <p className="p-5 text-sm text-slate-400">Nothing here yet.</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-[11px] uppercase tracking-wider text-slate-400">
                    {columns.map((column) => (
                      <th key={column} className="px-4 py-3 font-semibold">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index} className="border-b border-gray-50 last:border-0">
                      {columns.map((column) => (
                        <td key={column} className="px-4 py-3 text-slate-700">
                          {row[column]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      }

      case "list":
        return (
          <ul key={block.id} className="mt-3 space-y-1 text-sm text-slate-600">
            {(block.items ?? []).map((item, index) => (
              <li key={index}>• {item}</li>
            ))}
          </ul>
        );

      case "divider":
        return <hr key={block.id} className="my-6 border-gray-100" />;

      default:
        return null;
    }
  };

  // Stat blocks pack into a grid; everything else runs full width. The composer
  // owns the ORDER — this only decides how a run of numbers sits together.
  const grouped: React.ReactNode[] = [];
  let statRun: SurfaceBlock[] = [];
  const flushStats = () => {
    if (statRun.length === 0) return;
    grouped.push(
      <div key={`stats-${statRun[0].id}`} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {statRun.map(renderBlock)}
      </div>
    );
    statRun = [];
  };
  for (const block of blocks) {
    if (block.type === "stat") statRun.push(block);
    else {
      flushStats();
      grouped.push(<div key={block.id}>{renderBlock(block)}</div>);
    }
  }
  flushStats();

  return (
    <div data-testid={`buyer-surface-${mode}`}>
      {mode === "test" && contract.verification.length > 0 ? (
        <div
          className="mb-4 rounded-xl border border-sky-200 bg-sky-50 p-4"
          data-testid="surface-test-limits"
        >
          <p className="text-sm font-semibold text-sky-900">This is a test, so it can only reach you</p>
          <ul className="mt-1 space-y-0.5 text-[12px] leading-5 text-sky-800">
            {contract.verification.map((entry) => (
              <li key={entry.channel} data-testid={`surface-test-limit-${entry.channel}`}>
                • {entry.requirement}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {blocks.length === 0 ? (
        <p className="py-8 text-sm text-slate-500" data-testid="surface-empty">
          {emptyMessage}
        </p>
      ) : (
        grouped
      )}
    </div>
  );
}
