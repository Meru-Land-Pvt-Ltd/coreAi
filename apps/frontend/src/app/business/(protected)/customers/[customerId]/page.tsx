// [DISABLED] Front-desk feature page. The backend routes behind this page are
// currently disabled, so the page renders an inert placeholder instead of
// calling them. The full original implementation is preserved verbatim below,
// line-commented — strip the leading `// ` from that block to restore it.

export default function BusinessCustomerDetailPage() {
  return (
    <div className="p-8">
      <p className="text-sm text-slate-500" data-testid="business-customer-detail-disabled">
        This feature is currently disabled.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// [DISABLED] ORIGINAL IMPLEMENTATION BELOW
// ---------------------------------------------------------------------------
// "use client";
//
// import { useCallback, useEffect, useState } from "react";
// import { useParams, useRouter } from "next/navigation";
// import type { Route } from "next";
// import { apiDelete, apiGet, apiPost } from "@/lib/api";
// import { BusinessPageHeader } from "@/components/business/business-page-header";
// import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
// import {
//   ConfirmDialog,
//   EmptyState,
//   ErrorState,
//   LoadingRows,
//   Pill,
//   PRIMARY_BUTTON_CLASS,
//   SECONDARY_BUTTON_CLASS,
//   DANGER_BUTTON_CLASS,
//   SectionCard,
//   formatDateTime,
//   humanizeToken,
//   type PillTone
// } from "@/components/business/features/frontdesk/ui";
//
// type CustomerIdentity = {
//   id: string;
//   kind: string;
//   value: string;
//   confidence: string;
//   source?: string | null;
// };
//
// type CustomerProfile = {
//   id: string;
//   displayName: string | null;
//   primaryPhone: string | null;
//   primaryEmail: string | null;
//   status: string;
//   mergedIntoId: string | null;
//   notes: string | null;
//   firstSeenAt: string;
//   lastSeenAt: string | null;
//   identities: CustomerIdentity[];
// };
//
// type TimelineEvent = {
//   type: "CALL" | "CONVERSATION" | "APPOINTMENT" | "LEAD" | "HANDOFF" | "EMAIL" | string;
//   at: string;
//   title: string;
//   meta: Record<string, unknown>;
// };
//
// /** Backend returns { customer, events }; `timeline` kept as a fallback alias. */
// type CustomerDetailResponse = {
//   customer: CustomerProfile;
//   events?: TimelineEvent[];
//   timeline?: TimelineEvent[];
// };
//
// type CustomerOption = {
//   id: string;
//   displayName: string | null;
//   primaryPhone: string | null;
//   primaryEmail: string | null;
// };
//
// const EVENT_TONES: Record<string, PillTone> = {
//   CALL: "amber",
//   CONVERSATION: "blue",
//   APPOINTMENT: "green",
//   LEAD: "slate",
//   HANDOFF: "red",
//   EMAIL: "slate"
// };
//
// function TimelineIcon({ type }: { type: string }) {
//   const shared = "h-4 w-4";
//   switch (type) {
//     case "CALL":
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <path strokeLinecap="round" strokeLinejoin="round" d="M3 5c0 8.837 7.163 16 16 16l2-4-4.5-2-2 2a12.05 12.05 0 0 1-7.5-7.5l2-2L7 3 3 5z" />
//         </svg>
//       );
//     case "CONVERSATION":
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <path strokeLinecap="round" strokeLinejoin="round" d="M8 10h8M8 14h5M21 12a9 9 0 1 1-4-7.5L21 4l-.7 3.4A8.96 8.96 0 0 1 21 12z" />
//         </svg>
//       );
//     case "APPOINTMENT":
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <rect x="3" y="5" width="18" height="16" rx="2" />
//           <path strokeLinecap="round" d="M8 3v4M16 3v4M3 10h18" />
//         </svg>
//       );
//     case "LEAD":
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <circle cx="9" cy="8" r="3.5" />
//           <path strokeLinecap="round" d="M2.5 20a6.5 6.5 0 0 1 13 0M18 8v6M15 11h6" />
//         </svg>
//       );
//     case "HANDOFF":
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <path strokeLinecap="round" strokeLinejoin="round" d="M4 7h13m0 0-3-3m3 3-3 3M20 17H7m0 0 3-3m-3 3 3 3" />
//         </svg>
//       );
//     case "EMAIL":
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <rect x="3" y="5" width="18" height="14" rx="2" />
//           <path strokeLinecap="round" strokeLinejoin="round" d="m3 7 9 6 9-6" />
//         </svg>
//       );
//     default:
//       return (
//         <svg viewBox="0 0 24 24" className={shared} fill="none" stroke="currentColor" strokeWidth="2">
//           <circle cx="12" cy="12" r="9" />
//         </svg>
//       );
//   }
// }
//
// function metaSummary(meta: Record<string, unknown>): string {
//   return Object.entries(meta)
//     .filter(([, value]) => typeof value === "string" || typeof value === "number")
//     .slice(0, 4)
//     .map(([key, value]) => `${key}: ${String(value)}`)
//     .join(" · ");
// }
//
// export default function BusinessCustomerProfilePage() {
//   const params = useParams<{ customerId: string }>();
//   const router = useRouter();
//   const customerId = params?.customerId ?? "";
//
//   const [customer, setCustomer] = useState<CustomerProfile | null>(null);
//   const [events, setEvents] = useState<TimelineEvent[]>([]);
//   const [pageState, setPageState] = useState<"loading" | "ready" | "error">("loading");
//   const [pageError, setPageError] = useState("");
//
//   const [mergeOptions, setMergeOptions] = useState<CustomerOption[]>([]);
//   const [mergeTargetId, setMergeTargetId] = useState("");
//   const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
//   const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
//   const [actionBusy, setActionBusy] = useState(false);
//   const [actionError, setActionError] = useState("");
//
//   const loadProfile = useCallback(async () => {
//     if (!customerId) return;
//     setPageState("loading");
//     setPageError("");
//     const result = await apiGet<CustomerDetailResponse>(`/business/customers/${customerId}`);
//     if (result.success && result.data?.customer) {
//       setCustomer(result.data.customer);
//       setEvents(result.data.events ?? result.data.timeline ?? []);
//       setPageState("ready");
//     } else {
//       setPageError(result.error ?? "Could not load the customer.");
//       setPageState("error");
//     }
//   }, [customerId]);
//
//   useEffect(() => {
//     void loadProfile();
//   }, [loadProfile]);
//
//   useEffect(() => {
//     let active = true;
//     async function loadOptions() {
//       const result = await apiGet<{ customers: CustomerOption[] }>("/business/customers?limit=100");
//       if (!active) return;
//       if (result.success && result.data) {
//         setMergeOptions((result.data.customers ?? []).filter((option) => option.id !== customerId));
//       }
//     }
//     void loadOptions();
//     return () => {
//       active = false;
//     };
//   }, [customerId]);
//
//   async function exportCustomer() {
//     setActionBusy(true);
//     setActionError("");
//     const result = await apiGet<Record<string, unknown>>(`/business/customers/${customerId}/export`);
//     setActionBusy(false);
//     if (!result.success || !result.data) {
//       setActionError(result.error ?? "Could not export the customer data.");
//       return;
//     }
//     const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
//     const url = URL.createObjectURL(blob);
//     const anchor = document.createElement("a");
//     anchor.href = url;
//     anchor.download = `customer-${customerId}.json`;
//     document.body.appendChild(anchor);
//     anchor.click();
//     anchor.remove();
//     URL.revokeObjectURL(url);
//   }
//
//   async function mergeCustomer() {
//     if (!mergeTargetId) return;
//     setActionBusy(true);
//     setActionError("");
//     const result = await apiPost<unknown>(`/business/customers/${customerId}/merge`, {
//       mergedCustomerId: mergeTargetId
//     });
//     setActionBusy(false);
//     if (!result.success) {
//       setActionError(result.error ?? "Could not merge the customers.");
//       return;
//     }
//     setMergeConfirmOpen(false);
//     setMergeTargetId("");
//     await loadProfile();
//   }
//
//   async function deleteCustomer() {
//     setActionBusy(true);
//     setActionError("");
//     const result = await apiDelete<unknown>(`/business/customers/${customerId}`);
//     setActionBusy(false);
//     if (!result.success) {
//       setActionError(result.error ?? "Could not delete the customer.");
//       return;
//     }
//     router.push("/business/customers" as Route);
//   }
//
//   const mergeTargetLabel =
//     mergeOptions.find((option) => option.id === mergeTargetId)?.displayName ??
//     mergeOptions.find((option) => option.id === mergeTargetId)?.primaryPhone ??
//     mergeTargetId;
//
//   return (
//     <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="customer-profile-page">
//       <BusinessPageHeader
//         className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
//         title={customer?.displayName || customer?.primaryPhone || "Customer"}
//         description="Unified profile and history across calls, texts, bookings, and email."
//         actions={(
//           <>
//             <button
//               type="button"
//               onClick={() => void exportCustomer()}
//               disabled={actionBusy}
//               className={SECONDARY_BUTTON_CLASS}
//               data-testid="customer-export-button"
//             >
//               Export JSON
//             </button>
//             <button
//               type="button"
//               onClick={() => setDeleteConfirmOpen(true)}
//               disabled={actionBusy}
//               className={DANGER_BUTTON_CLASS}
//               data-testid="customer-delete-button"
//             >
//               Delete
//             </button>
//           </>
//         )}
//       />
//
//       <FrontDeskNav />
//
//       {pageState === "loading" ? (
//         <SectionCard>
//           <LoadingRows rows={4} testId="customer-profile-loading" />
//         </SectionCard>
//       ) : pageState === "error" ? (
//         <SectionCard>
//           <ErrorState message={pageError} onRetry={() => void loadProfile()} testId="customer-profile-error" />
//         </SectionCard>
//       ) : customer ? (
//         <div className="grid min-w-0 grid-cols-1 gap-4 sm:gap-6 xl:grid-cols-3">
//           <div className="min-w-0 space-y-4 sm:space-y-6 xl:col-span-1">
//             <SectionCard title="Profile" testId="customer-profile-card">
//               <div className="space-y-3 px-4 py-4 sm:px-6">
//                 <ProfileRow label="Name" value={customer.displayName || "—"} />
//                 <ProfileRow label="Phone" value={customer.primaryPhone || "—"} />
//                 <ProfileRow label="Email" value={customer.primaryEmail || "—"} />
//                 <ProfileRow label="Status" value={humanizeToken(customer.status)} />
//                 <ProfileRow label="First seen" value={formatDateTime(customer.firstSeenAt)} />
//                 <ProfileRow label="Last seen" value={formatDateTime(customer.lastSeenAt)} />
//                 {customer.notes ? <ProfileRow label="Notes" value={customer.notes} /> : null}
//               </div>
//               <div className="border-t border-gray-100 px-4 py-4 sm:px-6" data-testid="customer-profile-identities">
//                 <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Identities</p>
//                 {customer.identities.length === 0 ? (
//                   <p className="text-sm text-slate-400">No linked identities.</p>
//                 ) : (
//                   <div className="flex flex-wrap gap-1.5">
//                     {customer.identities.map((identity) => (
//                       <Pill
//                         key={identity.id}
//                         tone={identity.confidence === "STRONG" ? "green" : "slate"}
//                         title={`${identity.confidence}${identity.source ? ` · ${identity.source}` : ""}`}
//                         testId={`customer-identity-${identity.id}`}
//                       >
//                         {humanizeToken(identity.kind)}: {identity.value}
//                       </Pill>
//                     ))}
//                   </div>
//                 )}
//               </div>
//             </SectionCard>
//
//             <SectionCard
//               title="Merge duplicate"
//               subtitle="This profile stays; the selected profile's history moves onto it."
//               testId="customer-merge-card"
//             >
//               <div className="space-y-3 px-4 py-4 sm:px-6">
//                 <select
//                   value={mergeTargetId}
//                   onChange={(event) => setMergeTargetId(event.target.value)}
//                   className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
//                   data-testid="customer-merge-select"
//                 >
//                   <option value="">Select a customer to merge in…</option>
//                   {mergeOptions.map((option) => (
//                     <option key={option.id} value={option.id}>
//                       {option.displayName || option.primaryPhone || option.primaryEmail || option.id}
//                     </option>
//                   ))}
//                 </select>
//                 <button
//                   type="button"
//                   onClick={() => setMergeConfirmOpen(true)}
//                   disabled={!mergeTargetId || actionBusy}
//                   className={PRIMARY_BUTTON_CLASS}
//                   data-testid="customer-merge-button"
//                 >
//                   Merge into this profile
//                 </button>
//                 {actionError ? (
//                   <p className="text-sm font-semibold text-red-600" data-testid="customer-action-error">
//                     {actionError}
//                   </p>
//                 ) : null}
//               </div>
//             </SectionCard>
//           </div>
//
//           <div className="min-w-0 xl:col-span-2">
//             <SectionCard title="Timeline" subtitle="Newest first, across every channel." testId="customer-timeline-card">
//               {events.length === 0 ? (
//                 <EmptyState
//                   title="No activity yet"
//                   hint="Calls, conversations, bookings, and emails will appear here."
//                   testId="customer-timeline-empty"
//                 />
//               ) : (
//                 <div className="max-h-[70vh] divide-y divide-gray-50 overflow-y-auto" data-testid="customer-profile-timeline">
//                   {events.map((event, index) => (
//                     <div key={`${event.type}-${event.at}-${index}`} className="flex items-start gap-3 px-4 py-4 sm:px-6" data-testid={`customer-timeline-item-${index}`}>
//                       <span
//                         className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
//                           event.type === "CALL"
//                             ? "bg-amber-50 text-amber-600"
//                             : event.type === "APPOINTMENT"
//                               ? "bg-green-50 text-green-600"
//                               : event.type === "HANDOFF"
//                                 ? "bg-red-50 text-red-500"
//                                 : event.type === "CONVERSATION"
//                                   ? "bg-blue-50 text-blue-600"
//                                   : "bg-slate-100 text-slate-500"
//                         }`}
//                       >
//                         <TimelineIcon type={event.type} />
//                       </span>
//                       <div className="min-w-0 flex-1">
//                         <div className="flex flex-wrap items-center gap-2">
//                           <p className="text-sm font-semibold text-slate-900">{event.title}</p>
//                           <Pill tone={EVENT_TONES[event.type] ?? "slate"}>{humanizeToken(event.type)}</Pill>
//                         </div>
//                         <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(event.at)}</p>
//                         {metaSummary(event.meta) ? (
//                           <p className="mt-1 truncate text-xs text-slate-500">{metaSummary(event.meta)}</p>
//                         ) : null}
//                       </div>
//                     </div>
//                   ))}
//                 </div>
//               )}
//             </SectionCard>
//           </div>
//         </div>
//       ) : null}
//
//       {mergeConfirmOpen ? (
//         <ConfirmDialog
//           title="Merge customers"
//           message={
//             <span>
//               Merge <strong>{mergeTargetLabel}</strong> into this profile? All of their calls, conversations,
//               appointments, and identities move here. This keeps the current profile.
//             </span>
//           }
//           confirmLabel="Merge"
//           busy={actionBusy}
//           error={actionError}
//           onConfirm={() => void mergeCustomer()}
//           onCancel={() => setMergeConfirmOpen(false)}
//           testId="customer-merge-confirm"
//         />
//       ) : null}
//
//       {deleteConfirmOpen ? (
//         <ConfirmDialog
//           title="Delete customer"
//           message="This permanently deletes the customer profile and unlinks their history. This cannot be undone."
//           confirmLabel="Delete"
//           danger
//           busy={actionBusy}
//           error={actionError}
//           onConfirm={() => void deleteCustomer()}
//           onCancel={() => setDeleteConfirmOpen(false)}
//           testId="customer-delete-confirm"
//         />
//       ) : null}
//     </main>
//   );
// }
//
// function ProfileRow({ label, value }: { label: string; value: string }) {
//   return (
//     <div className="flex justify-between gap-4 text-sm">
//       <span className="shrink-0 text-slate-500">{label}</span>
//       <span className="min-w-0 break-words text-right font-semibold text-slate-900">{value}</span>
//     </div>
//   );
// }
