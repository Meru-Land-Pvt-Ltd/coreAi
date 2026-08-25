"use client";

/**
 * SEND EMAIL'S CEILING — the cannon guard.
 *
 * A Loop wired into the email hand could send a mail per item, per round.
 * Twenty-five in one run is already a campaign, not a notification — and a
 * refused mail is recoverable where a sent campaign is not.
 */

import { useCallback, useEffect, useState } from "react";
import {
  addMailDomain,
  getEmailLimits,
  getMailDomains,
  removeMailDomain,
  saveEmailLimits,
  setDefaultMailDomain,
  type MailDomain
} from "@/components/admin/features/api";

export function EmailLimitsPanel() {
  const [maxPerRun, setMaxPerRun] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let alive = true;
    void getEmailLimits().then((response) => {
      if (!alive) return;
      if (response.success && response.data) setMaxPerRun(response.data.maxPerRun);
      else setProblem("This setting could not be loaded. Refresh the page to try again.");
    });
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: number) => {
    setMaxPerRun(next);
    setSaving(true);
    setProblem(null);
    setSaved(false);
    const response = await saveEmailLimits(next);
    setSaving(false);
    if (response.success && response.data) {
      setMaxPerRun(response.data.maxPerRun);
      setSaved(true);
      return;
    }
    setProblem(response.error ?? "That could not be saved. Try again.");
  }, []);

  if (maxPerRun === null) {
    return <p className="text-sm text-slate-500">{problem ?? "Loading…"}</p>;
  }

  return (
    <div data-testid="email-limits-panel">
      <p className="mb-1 text-sm font-semibold text-slate-900">Limits</p>
      <div className="flex items-start justify-between gap-6 py-4">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900">Most emails in one run</p>
          <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
            Past this, the run says so in a sentence and stops sending. A refused mail is
            recoverable; a sent campaign is not.
          </p>
        </div>
        <select
          className="h-9 shrink-0 rounded-lg border border-gray-200 bg-white px-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
          data-testid="email-max-per-run"
          value={String(maxPerRun)}
          onChange={(event) => void save(Number(event.target.value))}
          disabled={saving}
        >
          {[5, 10, 25, 50, 100, 200].map((count) => (
            <option key={count} value={count}>
              {count} emails
            </option>
          ))}
        </select>
      </div>
      {problem ? (
        <p className="text-[12px] text-red-600">{problem}</p>
      ) : saved ? (
        <p className="text-[12px] text-emerald-700" data-testid="email-limits-saved">
          Saved. Every run obeys this within a minute.
        </p>
      ) : null}

      <MailDomainsSection />
    </div>
  );
}

/**
 * MAIL DOMAINS — the spare-domain pool.
 *
 * The founder's rule: the main domain never carries agent mail. One spammy
 * agent could blacklist triven.ai and kill everything — login mails included.
 * So: type a domain you bought, paste three lines at your domain provider,
 * and when the chip says Verified, all agent mail quietly moves onto it.
 */
function MailDomainsSection() {
  const [domains, setDomains] = useState<MailDomain[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await getMailDomains();
    if (response.success && response.data) setDomains(response.data.domains);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function add() {
    const domain = draft.trim();
    if (!domain || busy) return;
    setBusy(true);
    setNote(null);
    const response = await addMailDomain(domain);
    setBusy(false);
    if (response.success) {
      setDraft("");
      void refresh();
    } else {
      setNote(response.error ?? "That could not be added. Try again.");
    }
  }

  return (
    <div className="mt-6 border-t border-gray-100 pt-5" data-testid="mail-domains-section">
      <p className="text-sm font-semibold text-slate-900">Mail domains</p>
      <p className="mt-0.5 text-[12px] leading-5 text-slate-500">
        Agent mail should leave from a spare domain you bought — never the main one. Add a domain,
        paste three lines at your domain provider, and when it says Verified, all agent mail moves
        onto it by itself.
      </p>

      <div className="mt-3 flex gap-2">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="trivenmail.com"
          data-testid="mail-domain-input"
          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-amber-400"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={busy || !draft.trim()}
          data-testid="mail-domain-add"
          className="shrink-0 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          Add
        </button>
      </div>
      {note ? <p className="mt-2 text-[12px] text-red-600">{note}</p> : null}

      <div className="mt-4 space-y-4">
        {domains.map((entry) => (
          <div key={entry.domain} className="rounded-xl border border-gray-200 p-4" data-testid={`mail-domain-${entry.domain}`}>
            <div className="flex items-center justify-between gap-3">
              <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{entry.domain}</p>
              <div className="flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    entry.status === "verified"
                      ? "bg-emerald-50 text-emerald-700"
                      : entry.status === "failed"
                        ? "bg-red-50 text-red-700"
                        : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {entry.status === "verified" ? "Verified" : entry.status === "failed" ? "DNS failed — check the lines" : "Waiting for DNS"}
                </span>
                {entry.isDefault ? (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600">Default</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void setDefaultMailDomain(entry.domain).then(refresh)}
                    className="text-[11px] font-semibold text-amber-700 hover:underline"
                  >
                    Make default
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void removeMailDomain(entry.domain).then(refresh)}
                  aria-label={`Remove ${entry.domain}`}
                  className="text-[11px] font-semibold text-slate-400 hover:text-red-600"
                >
                  Remove
                </button>
              </div>
            </div>

            {entry.status !== "verified" ? (
              <div className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                  Paste these 3 lines at your domain provider
                </p>
                <div className="mt-2 space-y-1.5">
                  {entry.dnsRecords.map((record) => (
                    <div key={record.name} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                      <span className="shrink-0 rounded bg-slate-200 px-1.5 text-[10px] font-bold text-slate-600">CNAME</span>
                      <code className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{record.name}</code>
                      <span className="text-slate-300">→</span>
                      <code className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{record.value}</code>
                      <button
                        type="button"
                        onClick={() => void navigator.clipboard.writeText(`${record.name} CNAME ${record.value}`)}
                        className="shrink-0 text-[11px] font-semibold text-amber-700 hover:underline"
                      >
                        Copy
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => void refresh()}
                  className="mt-2 text-[12px] font-semibold text-amber-700 hover:underline"
                  data-testid="mail-domain-refresh"
                >
                  I added them — check now
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
