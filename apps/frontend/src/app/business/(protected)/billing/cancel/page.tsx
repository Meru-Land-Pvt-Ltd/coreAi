"use client";

import Link from "next/link";
import { BUSINESS_CHECKOUT_PATH, BUSINESS_MARKETPLACE_PATH } from "@/lib/routes";

export default function BillingCancelPage() {
    return (
        <main data-testid="business-billing-cancel" className="grid min-h-screen place-items-center bg-[#fffaf3] p-6">
            <div className="w-full max-w-md rounded-3xl border border-amber-100 bg-white p-8 text-center shadow-sm">
                <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-slate-200 text-slate-600">
                    <span className="text-2xl">↩</span>
                </div>
                <h1 className="mt-5 text-2xl font-black text-slate-950">Checkout canceled</h1>
                <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
                    No charge was made. You can restart checkout whenever you&apos;re ready to activate your AI Receptionist.
                </p>
                <div className="mt-6 flex flex-col gap-3">
                    <Link
                        data-testid="business-billing-cancel-retry"
                        href={BUSINESS_CHECKOUT_PATH}
                        className="inline-flex w-full items-center justify-center rounded-2xl bg-amber-500 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-amber-500/20 transition hover:-translate-y-0.5 hover:bg-amber-400"
                    >
                        Back to checkout
                    </Link>
                    <Link
                        data-testid="business-billing-cancel-marketplace"
                        href={BUSINESS_MARKETPLACE_PATH}
                        className="inline-flex w-full items-center justify-center rounded-2xl border border-amber-200 bg-white px-5 py-3 text-sm font-black text-slate-700 transition hover:border-amber-400 hover:text-amber-700"
                    >
                        Return to marketplace
                    </Link>
                </div>
            </div>
        </main>
    );
}
