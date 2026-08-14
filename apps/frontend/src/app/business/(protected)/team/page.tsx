// [DISABLED] Front-desk feature page. The backend routes behind this page are
// currently disabled, so the page renders an inert placeholder instead of
// calling them. The full original implementation is preserved verbatim below,
// line-commented — strip the leading `// ` from that block to restore it.

export default function BusinessTeamPage() {
  return (
    <div className="p-8">
      <p className="text-sm text-slate-500" data-testid="business-team-disabled">
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
// import { apiGet, apiPatch, apiPost } from "@/lib/api";
// import { BusinessPageHeader } from "@/components/business/business-page-header";
// import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
// import {
//   ConfirmDialog,
//   EmptyState,
//   ErrorState,
//   INPUT_CLASS,
//   LoadingRows,
//   Pill,
//   PRIMARY_BUTTON_CLASS,
//   SECONDARY_BUTTON_CLASS,
//   SectionCard,
//   formatDateTime,
//   formatRelativeTime,
//   humanizeToken,
//   type PillTone
// } from "@/components/business/features/frontdesk/ui";
//
// type TeamMember = {
//   id: string;
//   userId: string | null;
//   displayName: string;
//   email: string | null;
//   phone: string | null;
//   role: string;
//   department: string | null;
//   active: boolean;
//   handoffEligible: boolean;
//   presence: string;
//   priority: number;
//   lastActiveAt: string | null;
//   createdAt: string;
// };
//
// type TeamInvite = {
//   id: string;
//   email: string;
//   role: string;
//   expiresAt: string;
//   createdAt: string;
// };
//
// type TeamResponse = {
//   members: TeamMember[];
//   invites: TeamInvite[];
//   viewerRole: string;
// };
//
// type ActivityEntry = {
//   id: string;
//   action: string;
//   actorUserId: string | null;
//   actorLabel: string | null;
//   targetType: string | null;
//   targetId: string | null;
//   detailJson: unknown;
//   createdAt: string;
// };
//
// const BUSINESS_ROLES = ["OWNER", "ADMIN", "MANAGER", "RECEPTIONIST", "SALES", "SUPPORT", "VIEWER"] as const;
// const INVITE_ROLES = BUSINESS_ROLES.filter((role) => role !== "OWNER");
// const PRESENCES = ["AVAILABLE", "BUSY", "OFFLINE"] as const;
//
// function presenceTone(presence: string): PillTone {
//   if (presence === "AVAILABLE") return "green";
//   if (presence === "BUSY") return "amber";
//   return "slate";
// }
//
// type NewMemberForm = {
//   displayName: string;
//   role: string;
//   email: string;
//   phone: string;
//   department: string;
// };
//
// const EMPTY_MEMBER: NewMemberForm = { displayName: "", role: "RECEPTIONIST", email: "", phone: "", department: "" };
//
// export default function BusinessTeamPage() {
//   const [members, setMembers] = useState<TeamMember[]>([]);
//   const [invites, setInvites] = useState<TeamInvite[]>([]);
//   const [viewerRole, setViewerRole] = useState("");
//   const [pageState, setPageState] = useState<"loading" | "ready" | "error">("loading");
//   const [pageError, setPageError] = useState("");
//   const [actionError, setActionError] = useState("");
//
//   const [newMember, setNewMember] = useState<NewMemberForm>(EMPTY_MEMBER);
//   const [addingMember, setAddingMember] = useState(false);
//
//   const [inviteEmail, setInviteEmail] = useState("");
//   const [inviteRole, setInviteRole] = useState("RECEPTIONIST");
//   const [inviting, setInviting] = useState(false);
//
//   const [myPresence, setMyPresence] = useState("");
//   const [presenceBusy, setPresenceBusy] = useState(false);
//
//   const [transferTargetId, setTransferTargetId] = useState("");
//   const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);
//   const [transferBusy, setTransferBusy] = useState(false);
//   const [transferError, setTransferError] = useState("");
//
//   const [activityOpen, setActivityOpen] = useState(false);
//   const [activity, setActivity] = useState<ActivityEntry[]>([]);
//   const [activityState, setActivityState] = useState<"idle" | "loading" | "ready" | "error">("idle");
//
//   const loadTeam = useCallback(async () => {
//     setPageState("loading");
//     setPageError("");
//     const result = await apiGet<TeamResponse>("/business/team");
//     if (result.success && result.data) {
//       setMembers(result.data.members ?? []);
//       setInvites(result.data.invites ?? []);
//       setViewerRole(result.data.viewerRole ?? "");
//       setPageState("ready");
//     } else {
//       setPageError(result.error ?? "Could not load your team.");
//       setPageState("error");
//     }
//   }, []);
//
//   useEffect(() => {
//     void loadTeam();
//   }, [loadTeam]);
//
//   async function patchMember(memberId: string, patch: Record<string, unknown>) {
//     setActionError("");
//     const result = await apiPatch<{ member: TeamMember }>(`/business/team/members/${memberId}`, patch);
//     if (!result.success) {
//       setActionError(result.error ?? "Could not update the team member.");
//       return;
//     }
//     await loadTeam();
//   }
//
//   async function addMember() {
//     if (!newMember.displayName.trim()) return;
//     setAddingMember(true);
//     setActionError("");
//     const result = await apiPost<{ member: TeamMember }>("/business/team/members", {
//       displayName: newMember.displayName.trim(),
//       role: newMember.role,
//       email: newMember.email.trim() || null,
//       phone: newMember.phone.trim() || null,
//       department: newMember.department.trim() || null
//     });
//     setAddingMember(false);
//     if (!result.success) {
//       setActionError(result.error ?? "Could not add the team member.");
//       return;
//     }
//     setNewMember(EMPTY_MEMBER);
//     await loadTeam();
//   }
//
//   async function sendInvite() {
//     if (!inviteEmail.trim()) return;
//     setInviting(true);
//     setActionError("");
//     const result = await apiPost<unknown>("/business/team/invites", {
//       email: inviteEmail.trim(),
//       role: inviteRole
//     });
//     setInviting(false);
//     if (!result.success) {
//       setActionError(result.error ?? "Could not send the invite.");
//       return;
//     }
//     setInviteEmail("");
//     await loadTeam();
//   }
//
//   async function revokeInvite(inviteId: string) {
//     setActionError("");
//     const result = await apiPost<unknown>(`/business/team/invites/${inviteId}/revoke`, {});
//     if (!result.success) {
//       setActionError(result.error ?? "Could not revoke the invite.");
//       return;
//     }
//     await loadTeam();
//   }
//
//   async function setPresence(presence: string) {
//     setPresenceBusy(true);
//     setActionError("");
//     const result = await apiPatch<{ presence: string }>("/business/team/presence", { presence });
//     setPresenceBusy(false);
//     if (!result.success) {
//       setActionError(result.error ?? "Could not update your presence.");
//       return;
//     }
//     setMyPresence(presence);
//     await loadTeam();
//   }
//
//   async function transferOwnership() {
//     if (!transferTargetId) return;
//     setTransferBusy(true);
//     setTransferError("");
//     const result = await apiPost<unknown>("/business/team/ownership-transfer", { toMemberId: transferTargetId });
//     setTransferBusy(false);
//     if (!result.success) {
//       setTransferError(result.error ?? "Could not transfer ownership.");
//       return;
//     }
//     setTransferConfirmOpen(false);
//     setTransferTargetId("");
//     await loadTeam();
//   }
//
//   async function toggleActivity() {
//     const next = !activityOpen;
//     setActivityOpen(next);
//     if (next && activityState === "idle") {
//       setActivityState("loading");
//       const result = await apiGet<{ entries: ActivityEntry[] }>("/business/team/activity");
//       if (result.success && result.data) {
//         setActivity(result.data.entries ?? []);
//         setActivityState("ready");
//       } else {
//         setActivityState("error");
//       }
//     }
//   }
//
//   const transferTarget = members.find((member) => member.id === transferTargetId);
//
//   return (
//     <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="team-page">
//       <BusinessPageHeader
//         className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
//         title="Team"
//         description="Who can take handoffs, manage the AI, and see reports."
//         actions={(
//           <div className="flex items-center gap-1 rounded-xl bg-gray-50 p-1" aria-label="My presence">
//             {PRESENCES.map((presence) => (
//               <button
//                 key={presence}
//                 type="button"
//                 onClick={() => void setPresence(presence)}
//                 disabled={presenceBusy}
//                 data-testid={`team-presence-${presence.toLowerCase()}`}
//                 className={`rounded-lg px-3 py-1.5 text-sm transition-colors ${
//                   myPresence === presence
//                     ? "bg-amber-50 font-semibold text-amber-700"
//                     : "font-medium text-slate-500 hover:text-slate-700"
//                 }`}
//               >
//                 {humanizeToken(presence)}
//               </button>
//             ))}
//           </div>
//         )}
//       />
//
//       <FrontDeskNav />
//
//       {actionError ? (
//         <p className="mb-4 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600" data-testid="team-action-error">
//           {actionError}
//         </p>
//       ) : null}
//
//       {pageState === "loading" ? (
//         <SectionCard>
//           <LoadingRows rows={4} testId="team-loading" />
//         </SectionCard>
//       ) : pageState === "error" ? (
//         <SectionCard>
//           <ErrorState message={pageError} onRetry={() => void loadTeam()} testId="team-error" />
//         </SectionCard>
//       ) : (
//         <div className="space-y-4 sm:space-y-6">
//           <SectionCard title="Members" subtitle={`You are signed in as ${humanizeToken(viewerRole) || "a member"}.`} testId="team-members-card">
//             {members.length === 0 ? (
//               <EmptyState title="No team members yet" hint="Add teammates below so calls can be handed to them." testId="team-members-empty" />
//             ) : (
//               <div className="overflow-x-auto">
//                 <table className="w-full min-w-[860px] text-left text-sm" data-testid="team-members-table">
//                   <thead>
//                     <tr className="border-b border-gray-100 text-xs font-semibold uppercase tracking-wide text-slate-400">
//                       <th className="px-4 py-3 sm:px-6">Name</th>
//                       <th className="px-3 py-3">Role</th>
//                       <th className="px-3 py-3">Phone</th>
//                       <th className="px-3 py-3">Department</th>
//                       <th className="px-3 py-3">Handoffs</th>
//                       <th className="px-3 py-3">Presence</th>
//                       <th className="px-3 py-3">Priority</th>
//                       <th className="px-3 py-3">Active</th>
//                       <th className="px-3 py-3">Last active</th>
//                     </tr>
//                   </thead>
//                   <tbody className="divide-y divide-gray-50">
//                     {members.map((member) => (
//                       <tr key={member.id} data-testid={`team-member-row-${member.id}`}>
//                         <td className="px-4 py-3 sm:px-6">
//                           <p className="font-semibold text-slate-900">{member.displayName}</p>
//                           {member.email ? <p className="text-xs text-slate-400">{member.email}</p> : null}
//                         </td>
//                         <td className="px-3 py-3">
//                           {member.role === "OWNER" ? (
//                             <Pill tone="amber">Owner</Pill>
//                           ) : (
//                             <select
//                               value={member.role}
//                               onChange={(event) => void patchMember(member.id, { role: event.target.value })}
//                               className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
//                               data-testid={`team-role-select-${member.id}`}
//                             >
//                               {INVITE_ROLES.map((role) => (
//                                 <option key={role} value={role}>
//                                   {humanizeToken(role)}
//                                 </option>
//                               ))}
//                             </select>
//                           )}
//                         </td>
//                         <td className="px-3 py-3 text-slate-600">{member.phone || "—"}</td>
//                         <td className="px-3 py-3 text-slate-600">{member.department || "—"}</td>
//                         <td className="px-3 py-3">
//                           <input
//                             type="checkbox"
//                             checked={member.handoffEligible}
//                             onChange={(event) => void patchMember(member.id, { handoffEligible: event.target.checked })}
//                             className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400"
//                             data-testid={`team-handoff-toggle-${member.id}`}
//                             aria-label={`Handoff eligible for ${member.displayName}`}
//                           />
//                         </td>
//                         <td className="px-3 py-3">
//                           <Pill tone={presenceTone(member.presence)} testId={`team-presence-pill-${member.id}`}>
//                             {humanizeToken(member.presence)}
//                           </Pill>
//                         </td>
//                         <td className="px-3 py-3">
//                           <input
//                             type="number"
//                             min={1}
//                             defaultValue={member.priority}
//                             onBlur={(event) => {
//                               const value = Number(event.target.value);
//                               if (Number.isFinite(value) && value !== member.priority) {
//                                 void patchMember(member.id, { priority: value });
//                               }
//                             }}
//                             className="w-16 rounded-lg border border-gray-200 bg-white px-2 py-1 text-sm text-slate-700 focus:border-amber-400 focus:outline-none"
//                             data-testid={`team-priority-input-${member.id}`}
//                             aria-label={`Handoff priority for ${member.displayName}`}
//                           />
//                         </td>
//                         <td className="px-3 py-3">
//                           <input
//                             type="checkbox"
//                             checked={member.active}
//                             disabled={member.role === "OWNER"}
//                             onChange={(event) => void patchMember(member.id, { active: event.target.checked })}
//                             className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 disabled:opacity-40"
//                             data-testid={`team-active-toggle-${member.id}`}
//                             aria-label={`Active for ${member.displayName}`}
//                           />
//                         </td>
//                         <td className="px-3 py-3 text-xs text-slate-400">
//                           {member.lastActiveAt ? formatRelativeTime(member.lastActiveAt) : "Never"}
//                         </td>
//                       </tr>
//                     ))}
//                   </tbody>
//                 </table>
//               </div>
//             )}
//
//             <div className="border-t border-gray-100 px-4 py-4 sm:px-6">
//               <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Add a member</p>
//               <form
//                 className="grid grid-cols-1 gap-2 sm:grid-cols-6"
//                 data-testid="team-add-member-form"
//                 onSubmit={(event) => {
//                   event.preventDefault();
//                   void addMember();
//                 }}
//               >
//                 <input
//                   type="text"
//                   placeholder="Full name"
//                   value={newMember.displayName}
//                   onChange={(event) => setNewMember((prev) => ({ ...prev, displayName: event.target.value }))}
//                   className={INPUT_CLASS}
//                   data-testid="team-add-name-input"
//                 />
//                 <select
//                   value={newMember.role}
//                   onChange={(event) => setNewMember((prev) => ({ ...prev, role: event.target.value }))}
//                   className={INPUT_CLASS}
//                   data-testid="team-add-role-select"
//                 >
//                   {INVITE_ROLES.map((role) => (
//                     <option key={role} value={role}>
//                       {humanizeToken(role)}
//                     </option>
//                   ))}
//                 </select>
//                 <input
//                   type="email"
//                   placeholder="Email (optional)"
//                   value={newMember.email}
//                   onChange={(event) => setNewMember((prev) => ({ ...prev, email: event.target.value }))}
//                   className={INPUT_CLASS}
//                   data-testid="team-add-email-input"
//                 />
//                 <input
//                   type="tel"
//                   placeholder="Phone (optional)"
//                   value={newMember.phone}
//                   onChange={(event) => setNewMember((prev) => ({ ...prev, phone: event.target.value }))}
//                   className={INPUT_CLASS}
//                   data-testid="team-add-phone-input"
//                 />
//                 <input
//                   type="text"
//                   placeholder="Department (optional)"
//                   value={newMember.department}
//                   onChange={(event) => setNewMember((prev) => ({ ...prev, department: event.target.value }))}
//                   className={INPUT_CLASS}
//                   data-testid="team-add-department-input"
//                 />
//                 <button
//                   type="submit"
//                   disabled={addingMember || !newMember.displayName.trim()}
//                   className={PRIMARY_BUTTON_CLASS}
//                   data-testid="team-add-member-button"
//                 >
//                   {addingMember ? "Adding…" : "Add member"}
//                 </button>
//               </form>
//             </div>
//           </SectionCard>
//
//           <SectionCard title="Invites" subtitle="Invited teammates sign in with their email and join this workspace." testId="team-invites-card">
//             <div className="px-4 py-4 sm:px-6">
//               <form
//                 className="flex flex-wrap gap-2"
//                 data-testid="team-invite-form"
//                 onSubmit={(event) => {
//                   event.preventDefault();
//                   void sendInvite();
//                 }}
//               >
//                 <input
//                   type="email"
//                   placeholder="teammate@business.com"
//                   value={inviteEmail}
//                   onChange={(event) => setInviteEmail(event.target.value)}
//                   className={`${INPUT_CLASS} max-w-xs`}
//                   data-testid="team-invite-email-input"
//                 />
//                 <select
//                   value={inviteRole}
//                   onChange={(event) => setInviteRole(event.target.value)}
//                   className={`${INPUT_CLASS} w-auto`}
//                   data-testid="team-invite-role-select"
//                 >
//                   {INVITE_ROLES.map((role) => (
//                     <option key={role} value={role}>
//                       {humanizeToken(role)}
//                     </option>
//                   ))}
//                 </select>
//                 <button
//                   type="submit"
//                   disabled={inviting || !inviteEmail.trim()}
//                   className={PRIMARY_BUTTON_CLASS}
//                   data-testid="team-invite-button"
//                 >
//                   {inviting ? "Sending…" : "Send invite"}
//                 </button>
//               </form>
//             </div>
//
//             {invites.length > 0 ? (
//               <div className="divide-y divide-gray-50 border-t border-gray-100" data-testid="team-invites-list">
//                 {invites.map((invite) => (
//                   <div key={invite.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 sm:px-6" data-testid={`team-invite-row-${invite.id}`}>
//                     <div className="min-w-0">
//                       <p className="truncate text-sm font-semibold text-slate-900">{invite.email}</p>
//                       <p className="text-xs text-slate-400">
//                         {humanizeToken(invite.role)} · expires {formatDateTime(invite.expiresAt)}
//                       </p>
//                     </div>
//                     <button
//                       type="button"
//                       onClick={() => void revokeInvite(invite.id)}
//                       className={SECONDARY_BUTTON_CLASS}
//                       data-testid={`team-invite-revoke-button-${invite.id}`}
//                     >
//                       Revoke
//                     </button>
//                   </div>
//                 ))}
//               </div>
//             ) : null}
//           </SectionCard>
//
//           {viewerRole === "OWNER" ? (
//             <SectionCard
//               title="Transfer ownership"
//               subtitle="The new owner gets full control of this workspace. You become an admin."
//               testId="team-transfer-card"
//             >
//               <div className="flex flex-wrap items-center gap-2 px-4 py-4 sm:px-6">
//                 <select
//                   value={transferTargetId}
//                   onChange={(event) => setTransferTargetId(event.target.value)}
//                   className={`${INPUT_CLASS} max-w-xs`}
//                   data-testid="team-transfer-select"
//                 >
//                   <option value="">Select a member…</option>
//                   {members
//                     .filter((member) => member.role !== "OWNER" && member.active)
//                     .map((member) => (
//                       <option key={member.id} value={member.id}>
//                         {member.displayName}
//                       </option>
//                     ))}
//                 </select>
//                 <button
//                   type="button"
//                   onClick={() => setTransferConfirmOpen(true)}
//                   disabled={!transferTargetId}
//                   className={SECONDARY_BUTTON_CLASS}
//                   data-testid="team-transfer-button"
//                 >
//                   Transfer ownership
//                 </button>
//               </div>
//             </SectionCard>
//           ) : null}
//
//           <SectionCard
//             title="Activity log"
//             actions={(
//               <button type="button" onClick={() => void toggleActivity()} className={SECONDARY_BUTTON_CLASS} data-testid="team-activity-toggle">
//                 {activityOpen ? "Hide" : "Show"}
//               </button>
//             )}
//             testId="team-activity-card"
//           >
//             {!activityOpen ? (
//               <div className="px-4 py-4 sm:px-6">
//                 <p className="text-sm text-slate-400">Role changes, invites, merges, and reviews are recorded here.</p>
//               </div>
//             ) : activityState === "loading" ? (
//               <LoadingRows rows={3} testId="team-activity-loading" />
//             ) : activityState === "error" ? (
//               <ErrorState message="Could not load the activity log." testId="team-activity-error" />
//             ) : activity.length === 0 ? (
//               <EmptyState title="No activity recorded yet" testId="team-activity-empty" />
//             ) : (
//               <div className="max-h-96 divide-y divide-gray-50 overflow-y-auto" data-testid="team-activity-list">
//                 {activity.map((entry) => (
//                   <div key={entry.id} className="px-4 py-3 sm:px-6" data-testid={`team-activity-entry-${entry.id}`}>
//                     <p className="text-sm text-slate-700">
//                       <span className="font-semibold">{entry.actorLabel || "System"}</span>{" "}
//                       {humanizeToken(entry.action).toLowerCase()}
//                       {entry.targetType ? <span className="text-slate-400"> · {entry.targetType}</span> : null}
//                     </p>
//                     <p className="mt-0.5 text-xs text-slate-400">{formatDateTime(entry.createdAt)}</p>
//                   </div>
//                 ))}
//               </div>
//             )}
//           </SectionCard>
//         </div>
//       )}
//
//       {transferConfirmOpen && transferTarget ? (
//         <ConfirmDialog
//           title="Transfer ownership"
//           message={
//             <span>
//               Make <strong>{transferTarget.displayName}</strong> the owner of this workspace? You will lose owner
//               access immediately.
//             </span>
//           }
//           confirmLabel="Transfer"
//           danger
//           busy={transferBusy}
//           error={transferError}
//           onConfirm={() => void transferOwnership()}
//           onCancel={() => setTransferConfirmOpen(false)}
//           testId="team-transfer-confirm"
//         />
//       ) : null}
//     </main>
//   );
// }
