"use client";

import { ChevronLeft, ChevronRight, MessageCircle, Phone } from "lucide-react";
import type { CrmContact, CrmPagination } from "./api";
import {
  contactInitials,
  displayOrDash,
  relativeTime,
  stagePillClasses,
  telHref,
  whatsappHref
} from "./crm-format";

/**
 * Customer table. Markup copied from the admin businesses table — this repo has
 * no shared Table component, and inventing one here would fork the look.
 *
 * Row click opens the drawer; every action button stops propagation so a "Call"
 * tap does not also open the panel behind it.
 */
export function CrmTable({
  contacts,
  pagination,
  loading,
  stale,
  onOpen,
  onEdit,
  onPageChange
}: {
  contacts: CrmContact[];
  pagination: CrmPagination | null;
  loading: boolean;
  stale?: boolean;
  onOpen: (contact: CrmContact) => void;
  onEdit: (contact: CrmContact) => void;
  onPageChange: (page: number) => void;
}) {
  if (loading) {
    return (
      <div
        data-testid="business-crm-loading"
        className="h-80 animate-pulse rounded-2xl border border-gray-100 bg-white"
      />
    );
  }

  const from = pagination && pagination.total > 0 ? (pagination.page - 1) * pagination.perPage + 1 : 0;
  const to = pagination ? Math.min(pagination.page * pagination.perPage, pagination.total) : 0;

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06)]">
      {stale ? (
        <p className="border-b border-amber-100 bg-amber-50 px-5 py-2.5 text-sm font-medium text-amber-700">
          Showing cached customers — your CRM is temporarily unavailable.
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table data-testid="business-crm-table" className="w-full min-w-[1080px] text-left text-sm">
          <thead>
            <tr className="select-none border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wider text-slate-400">
              <th className="px-5 py-3.5">Customer</th>
              <th className="px-5 py-3.5">Contact</th>
              <th className="px-5 py-3.5">Company</th>
              <th className="px-5 py-3.5">Stage</th>
              <th className="hidden px-5 py-3.5 md:table-cell">Owner</th>
              <th className="hidden px-5 py-3.5 md:table-cell">Last Interaction</th>
              <th className="hidden px-5 py-3.5 md:table-cell">AI Insight</th>
              <th className="px-5 py-3.5">Actions</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-50">
            {contacts.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-16 text-center" data-testid="business-crm-no-results">
                  <p className="font-bold text-slate-900">No customers found</p>
                  <p className="mt-1 text-sm text-slate-400">
                    Try a different search, or clear the filters.
                  </p>
                </td>
              </tr>
            ) : (
              contacts.map((contact) => {
                const tel = telHref(contact.phone);
                const whatsapp = whatsappHref(contact.phone);

                return (
                  <tr
                    key={contact.id}
                    data-testid={`business-crm-row-${contact.id}`}
                    onClick={() => onOpen(contact)}
                    className="cursor-pointer transition hover:bg-gray-50/70"
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-xs font-bold text-amber-600 ring-1 ring-amber-100">
                          {contactInitials(contact)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{contact.name}</p>
                          {contact.vip ? (
                            <span className="mt-0.5 inline-flex rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700 ring-1 ring-green-600/10">
                              VIP
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      <p className="text-sm text-slate-700">{displayOrDash(contact.phone)}</p>
                      {/* Consumer callers usually have no email — a dash, not an error. */}
                      <p className="font-mono text-xs text-slate-500">{displayOrDash(contact.email)}</p>
                    </td>

                    <td className="px-5 py-3.5 text-slate-700">{displayOrDash(contact.company)}</td>

                    <td className="px-5 py-3.5">
                      {contact.stage ? (
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${stagePillClasses(contact.stage)}`}
                        >
                          {contact.stage}
                        </span>
                      ) : (
                        <span className="text-slate-400">—</span>
                      )}
                    </td>

                    <td className="hidden px-5 py-3.5 text-slate-700 md:table-cell">
                      {displayOrDash(contact.owner)}
                    </td>

                    <td className="hidden px-5 py-3.5 text-slate-500 tabular-nums md:table-cell">
                      {relativeTime(contact.lastInteractionAt)}
                    </td>

                    <td className="hidden max-w-[220px] px-5 py-3.5 md:table-cell">
                      <p
                        className="truncate text-sm italic text-slate-600"
                        title={contact.insight ?? undefined}
                      >
                        {contact.insight?.trim() || "—"}
                      </p>
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          data-testid={`business-crm-open-${contact.id}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onOpen(contact);
                          }}
                          className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-gray-100"
                        >
                          Open
                        </button>

                        <button
                          type="button"
                          data-testid={`business-crm-edit-${contact.id}`}
                          onClick={(event) => {
                            event.stopPropagation();
                            onEdit(contact);
                          }}
                          className="rounded-lg px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-gray-100"
                        >
                          Edit
                        </button>

                        {tel ? (
                          <a
                            href={tel}
                            data-testid={`business-crm-call-${contact.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                          >
                            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
                            Call
                          </a>
                        ) : null}

                        {whatsapp ? (
                          <a
                            href={whatsapp}
                            target="_blank"
                            rel="noopener noreferrer"
                            data-testid={`business-crm-whatsapp-${contact.id}`}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold text-emerald-700 hover:bg-emerald-50"
                          >
                            <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            WhatsApp
                          </a>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-gray-100 px-5 py-4 sm:flex-row">
          <p className="text-sm text-slate-500 tabular-nums" data-testid="business-crm-pagination-info">
            Showing {from}–{to} of {pagination.total.toLocaleString()}
          </p>

          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagination.page <= 1}
              onClick={() => onPageChange(pagination.page - 1)}
              data-testid="business-crm-prev-page"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-slate-600 disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
              Prev
            </button>

            {pageWindow(pagination.page, pagination.totalPages).map((page) => (
              <button
                key={page}
                type="button"
                onClick={() => onPageChange(page)}
                data-testid={`business-crm-page-${page}`}
                className={`h-8 w-8 rounded-lg text-sm font-semibold ${
                  page === pagination.page
                    ? "bg-amber-500 text-white shadow-sm"
                    : "text-slate-600 hover:bg-gray-100"
                }`}
              >
                {page}
              </button>
            ))}

            <button
              type="button"
              disabled={pagination.page >= pagination.totalPages}
              onClick={() => onPageChange(pagination.page + 1)}
              data-testid="business-crm-next-page"
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-semibold text-slate-600 disabled:opacity-40"
            >
              Next
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** At most 5 page buttons, centred on the current page. */
function pageWindow(current: number, total: number): number[] {
  const size = Math.min(5, total);
  let start = Math.max(1, current - Math.floor(size / 2));
  if (start + size - 1 > total) start = Math.max(1, total - size + 1);
  return Array.from({ length: size }, (_, index) => start + index);
}
