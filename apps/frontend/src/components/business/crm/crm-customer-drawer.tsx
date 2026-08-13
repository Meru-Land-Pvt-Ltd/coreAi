"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CrmContact, CrmContactDetail, CrmContactUpdate } from "./api";
import { CrmEditContactForm } from "./crm-edit-contact-form";
import {
  displayOrDash,
  formatDate,
  formatMoney,
  relativeTime,
  stagePillClasses,
  telHref,
  whatsappHref
} from "./crm-format";

/**
 * Right-side customer drawer.
 *
 * This repo has no shared Drawer, and the admin modal is centred — the CRM
 * spec calls for a side sheet, so it is built here from the existing overlay
 * language (portal + slate overlay + white panel + gray-100 borders).
 */
export function CrmCustomerDrawer({
  contact,
  detail,
  loading,
  editing,
  saving,
  savingNote,
  onClose,
  onStartEdit,
  onCancelEdit,
  onSave,
  onAddNote,
  onBookAppointment
}: {
  contact: CrmContact;
  detail: CrmContactDetail | null;
  loading: boolean;
  editing: boolean;
  saving: boolean;
  savingNote: boolean;
  onClose: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (changes: CrmContactUpdate) => void;
  onAddNote: (body: string) => void;
  onBookAppointment: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteBody, setNoteBody] = useState("");

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  if (!mounted) return null;

  // The detail fetch is lazy; fall back to the row we already have so the
  // header never flashes empty.
  const view: CrmContact = detail ?? contact;
  const tel = telHref(view.phone);
  const whatsapp = whatsappHref(view.phone);

  return createPortal(
    <div className="fixed inset-0 z-[90]" data-testid="business-crm-drawer">
      <button
        type="button"
        aria-label="Close customer details"
        onClick={onClose}
        data-testid="business-crm-drawer-overlay"
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/45 backdrop-blur-[2px]"
      />

      <aside className="fixed inset-y-0 right-0 flex w-full max-w-lg flex-col overflow-hidden border-l border-gray-100 bg-white shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 py-5">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-extrabold tracking-tight text-slate-900">
              {view.name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {view.stage ? (
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${stagePillClasses(view.stage)}`}
                >
                  {view.stage}
                </span>
              ) : null}
              {view.vip ? (
                <span className="inline-flex rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-semibold text-green-700 ring-1 ring-green-600/10">
                  VIP
                </span>
              ) : null}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            data-testid="business-crm-drawer-close"
            aria-label="Close"
            className="rounded-lg p-1.5 text-slate-400 hover:bg-gray-100 hover:text-slate-700"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-bold text-slate-900">Customer Profile</h3>
              {!editing ? (
                <button
                  type="button"
                  onClick={onStartEdit}
                  data-testid="business-crm-edit-contact"
                  className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-gray-100"
                >
                  Edit
                </button>
              ) : null}
            </div>

            {editing ? (
              <div className="mt-4">
                <CrmEditContactForm
                  contact={view}
                  saving={saving}
                  onCancel={onCancelEdit}
                  onSave={onSave}
                />
              </div>
            ) : (
              <dl className="mt-3 space-y-2.5">
                <Row label="Phone" value={displayOrDash(view.phone)} />
                {/* Blank email/company is the normal case for consumer callers. */}
                <Row label="Email" value={displayOrDash(view.email)} />
                <Row label="Company" value={displayOrDash(view.company)} />
                <Row label="Owner" value={displayOrDash(view.owner)} />
                <Row label="VIP status" value={view.vip ? "VIP" : "Standard"} />
                <Row label="Customer since" value={formatDate(view.customerSince)} />
                <Row label="Preferred language" value={displayOrDash(view.preferredLanguage)} />
                <Row label="Last interaction" value={relativeTime(view.lastInteractionAt)} />
              </dl>
            )}
          </section>

          {loading ? (
            <div
              className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-gray-50"
              data-testid="business-crm-drawer-loading"
            />
          ) : (
            <>
              {detail?.aiSummary ? (
                <section data-testid="business-crm-ai-summary">
                  <h3 className="text-sm font-bold text-slate-900">AI Summary</h3>
                  <p className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-slate-700">
                    {detail.aiSummary}
                  </p>
                </section>
              ) : null}

              {detail?.deals.length ? (
                <section data-testid="business-crm-deals">
                  <h3 className="text-sm font-bold text-slate-900">Open Deals</h3>
                  <ul className="mt-2 space-y-2">
                    {detail.deals.map((deal) => (
                      <li key={deal.id} className="rounded-xl border border-gray-100 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                            {deal.name}
                          </p>
                          <p className="shrink-0 text-sm font-semibold text-slate-900 tabular-nums">
                            {formatMoney(deal.amount, deal.currency)}
                          </p>
                        </div>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {displayOrDash(deal.stage)}
                          {deal.closeDate ? ` · closes ${formatDate(deal.closeDate)}` : ""}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              <section data-testid="business-crm-timeline">
                <h3 className="text-sm font-bold text-slate-900">Recent Activity</h3>
                {detail?.activities.length ? (
                  <ul className="mt-3 space-y-3 border-l border-gray-100 pl-4">
                    {detail.activities.map((activity) => (
                      <li key={activity.id}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="inline-flex rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
                            {activity.type.replace(/_/g, " ")}
                          </span>
                          <span className="text-xs text-slate-400">
                            {relativeTime(activity.occurredAt)}
                          </span>
                        </div>
                        {activity.title ? (
                          <p className="mt-1 text-sm font-medium text-slate-800">{activity.title}</p>
                        ) : null}
                        {activity.body ? (
                          <p className="mt-0.5 text-sm text-slate-600">{activity.body}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-sm text-slate-400">No recorded activity yet.</p>
                )}
              </section>
            </>
          )}

          <section>
            <h3 className="text-sm font-bold text-slate-900">Quick Actions</h3>
            <div className="mt-3 space-y-2">
              {tel ? (
                <a
                  href={tel}
                  data-testid="business-crm-quick-call"
                  className="block w-full rounded-xl border-2 border-amber-500 py-3 text-center font-semibold text-amber-600 hover:bg-amber-500 hover:text-white"
                >
                  Call Customer
                </a>
              ) : null}

              {whatsapp ? (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-testid="business-crm-quick-whatsapp"
                  className="block w-full rounded-xl border border-gray-200 py-3 text-center text-slate-600 hover:border-amber-300 hover:text-amber-700"
                >
                  Send WhatsApp
                </a>
              ) : null}

              <button
                type="button"
                onClick={onBookAppointment}
                data-testid="business-crm-quick-book"
                className="w-full rounded-xl border border-gray-200 py-3 text-center text-slate-600 hover:border-amber-300 hover:text-amber-700"
              >
                Book Appointment
              </button>

              <button
                type="button"
                onClick={() => setNoteOpen((open) => !open)}
                data-testid="business-crm-quick-note"
                className="w-full rounded-xl border border-gray-200 py-3 text-center text-slate-600 hover:border-amber-300 hover:text-amber-700"
              >
                Add Note
              </button>

              {!editing ? (
                <button
                  type="button"
                  onClick={onStartEdit}
                  data-testid="business-crm-edit-details"
                  className="w-full rounded-xl border border-gray-200 py-3 text-center text-slate-600 hover:border-amber-300 hover:text-amber-700"
                >
                  Edit details
                </button>
              ) : null}
            </div>

            {noteOpen ? (
              <div className="mt-3 space-y-2">
                <textarea
                  value={noteBody}
                  onChange={(event) => setNoteBody(event.target.value)}
                  rows={3}
                  placeholder="What should the team know?"
                  data-testid="business-crm-note-input"
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100 focus:outline-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={savingNote || !noteBody.trim()}
                    onClick={() => {
                      onAddNote(noteBody.trim());
                      setNoteBody("");
                      setNoteOpen(false);
                    }}
                    data-testid="business-crm-save-note"
                    className="rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                  >
                    {savingNote ? "Saving…" : "Save note"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNoteOpen(false);
                      setNoteBody("");
                    }}
                    className="rounded-xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:border-gray-300"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </section>
        </div>
      </aside>
    </div>,
    document.body
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <dt className="shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-slate-900">{value}</dd>
    </div>
  );
}
