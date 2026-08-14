// [DISABLED] Front-desk feature page. The backend routes behind this page are
// currently disabled, so the page renders an inert placeholder instead of
// calling them. The full original implementation is preserved verbatim below,
// line-commented — strip the leading `// ` from that block to restore it.

export default function BusinessTeamAcceptPage() {
  return (
    <div className="p-8">
      <p className="text-sm text-slate-500" data-testid="business-team-accept-disabled">
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
// import { Suspense, useEffect, useState } from "react";
// import Link from "next/link";
// import { useRouter, useSearchParams } from "next/navigation";
// import { apiPost } from "@/lib/api";
// import { getAuthToken } from "@/lib/auth";
// import { BUSINESS_DASHBOARD_PATH, businessLoginPathWithNext } from "@/lib/routes";
//
// /**
//  * Team invite acceptance. Lives OUTSIDE the (protected) group on purpose: a
//  * freshly invited user may not have the BUSINESS role yet — accepting the
//  * invite is what grants it. We only require a signed-in session.
//  */
// function TeamAcceptInner() {
//   const router = useRouter();
//   const searchParams = useSearchParams();
//   const token = searchParams?.get("token") ?? "";
//
//   const [status, setStatus] = useState<"checking" | "accepting" | "success" | "error">("checking");
//   const [error, setError] = useState("");
//
//   useEffect(() => {
//     if (!token) {
//       setStatus("error");
//       setError("This invite link is missing its token. Ask for a fresh invite email.");
//       return;
//     }
//
//     if (!getAuthToken()) {
//       router.replace(businessLoginPathWithNext(`/business/team/accept?token=${encodeURIComponent(token)}`));
//       return;
//     }
//
//     let cancelled = false;
//     setStatus("accepting");
//     void apiPost<unknown>("/business/team/invites/accept", { token }).then((result) => {
//       if (cancelled) return;
//       if (result.success) {
//         setStatus("success");
//       } else {
//         setStatus("error");
//         setError(result.error ?? "Could not accept the invite.");
//       }
//     });
//
//     return () => {
//       cancelled = true;
//     };
//   }, [token, router]);
//
//   return (
//     <main className="flex min-h-screen items-center justify-center bg-gray-50 p-4" data-testid="team-accept-page">
//       <div className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-8 text-center shadow-sm">
//         {status === "checking" || status === "accepting" ? (
//           <div data-testid="team-accept-status">
//             <div className="mx-auto mb-4 h-10 w-10 animate-pulse rounded-full bg-amber-100" />
//             <p className="text-base font-bold text-slate-900">Accepting your invite…</p>
//             <p className="mt-1 text-sm text-slate-500">Hang tight, this only takes a moment.</p>
//           </div>
//         ) : status === "success" ? (
//           <div data-testid="team-accept-success">
//             <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-green-50 text-green-600">
//               <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
//                 <path strokeLinecap="round" strokeLinejoin="round" d="m5 13 4 4L19 7" />
//               </svg>
//             </div>
//             <p className="text-base font-bold text-slate-900">You&apos;re on the team</p>
//             <p className="mt-1 text-sm text-slate-500">
//               The invite was accepted and this workspace is now available to you.
//             </p>
//             <Link
//               href={BUSINESS_DASHBOARD_PATH}
//               className="mt-5 inline-flex items-center justify-center rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
//               data-testid="team-accept-dashboard-link"
//             >
//               Go to dashboard
//             </Link>
//           </div>
//         ) : (
//           <div data-testid="team-accept-error">
//             <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-red-50 text-red-500">
//               <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
//                 <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
//               </svg>
//             </div>
//             <p className="text-base font-bold text-slate-900">Could not accept the invite</p>
//             <p className="mt-1 text-sm text-slate-500" data-testid="team-accept-error-message">
//               {error}
//             </p>
//             <Link
//               href={BUSINESS_DASHBOARD_PATH}
//               className="mt-5 inline-flex items-center justify-center rounded-xl border border-gray-200 px-5 py-2.5 text-sm font-semibold text-slate-600 transition hover:border-amber-300 hover:text-amber-700"
//               data-testid="team-accept-dashboard-fallback-link"
//             >
//               Go to dashboard
//             </Link>
//           </div>
//         )}
//       </div>
//     </main>
//   );
// }
//
// export default function TeamAcceptPage() {
//   return (
//     <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
//       <TeamAcceptInner />
//     </Suspense>
//   );
// }
