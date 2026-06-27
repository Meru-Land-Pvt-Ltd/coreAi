"use client";

import Link from "next/link";
import type { Route } from "next";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { businessSetupPath } from "@/lib/routes";

type BillingStatus = { active?: boolean; status?: string };

export default function BillingSuccessPage() {
    const [state, setState] = useState<"checking" | "active" | "pending">("checking");
    const searchParams = useSearchParams();
    const listingId = searchParams.get("listingId") ?? "";
    const setupHref = businessSetupPath(listingId || undefined) as Route;

    useEffect(() => {
        let active = true;

        async function check(attempt: number) {
            const result = await apiGet<BillingStatus>("/business/billing/status");
            if (!active) return;

            if (result.success && result.data?.active) {
                setState("active");
                return;
            }
            // Webhook may lag a moment after redirect — poll a few times.
            if (attempt < 5) {
                window.setTimeout(() => check(attempt + 1), 1500);
                return;
            }
            setState("pending");
        }

        void check(0);
        return () => {
            active = false;
        };
    }, []);

    return (
        <main data-testid="business-billing-success" className="grid min-h-screen place-items-center bg-[#fffaf3] p-6">
            <div className="w-full max-w-md rounded-3xl border border-amber-100 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500 text-white shadow-lg shadow-emerald-500/20">
                    <span className="text-2xl">✓</span>
                </div>
                <h1 className="mt-5 text-2xl font-black text-slate-950">Subscription confirmed</h1>
                <p data-testid="business-billing-success-status" className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    {state === "checking"
                        ? "Confirming your subscription..."
                        : state === "active"
                            ? "Your AI Receptionist plan is active. Let's finish setting up your agent."
                            : "Payment received. Your subscription is being activated — you can continue to setup."}
                </p>
                <Link
                    data-testid="business-billing-success-continue"
                    href={setupHref}
                    className="mt-6 inline-flex w-full items-center justify-center rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5 hover:bg-amber-400"
                >
                    Continue to setup
                </Link>
            </div>
        </main>
    );
}
