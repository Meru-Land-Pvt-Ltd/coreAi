"use client";

import Image from "next/image";
import { useMemo, useState, type FormEvent } from "react";
import { downloadDpaPdf, requestSignedDpa } from "@/lib/dpa";
import { getAuthUser } from "@/lib/auth";

const SECTIONS = [
    {
        id: "definitions",
        title: "Definitions",
        content: [
            ["Data Controller", "The customer that determines why and how personal data is processed."],
            ["Data Processor", "Triven, which processes personal data on the documented instructions of the Data Controller."],
            ["Personal Data", "Information relating to an identified or identifiable person."],
            ["Processing", "Collecting, storing, using, transmitting, or deleting personal data."],
            ["Sub-processor", "A third party engaged by Triven to process personal data."],
            ["Data Subject", "The person whose personal data is processed."]
        ]
    },
    {
        id: "scope",
        title: "Scope of Processing",
        paragraphs: [
            "Triven processes the minimum data required to provide the AI agents and related services configured by the Data Controller.",
            "This may include caller phone numbers, call metadata, message content, appointment details, business configuration, and execution logs. Triven does not sell personal data."
        ]
    },
    {
        id: "categories",
        title: "Data Categories",
        paragraphs: ["Each data category is tied to a service purpose and a defined retention window."]
    },
    {
        id: "purposes",
        title: "Processing Purposes",
        bullets: [
            "Executing AI-agent workflows on behalf of the Data Controller.",
            "Delivering calls, messages, and appointment communications.",
            "Generating analytics and performance reports.",
            "Improving service quality using aggregated or anonymized data.",
            "Preventing fraud and maintaining platform security."
        ]
    },
    {
        id: "security",
        title: "Security Measures",
        bullets: [
            "Encryption in transit and at rest.",
            "Role-based access controls and least-privilege practices.",
            "Security monitoring, encrypted backups, and incident response procedures.",
            "Workforce confidentiality obligations and security training."
        ]
    },
    {
        id: "subprocessors",
        title: "Sub-processors",
        paragraphs: [
            "Triven uses vetted infrastructure, communications, payment, and AI providers. Each provider is contractually required to protect personal data consistently with this agreement."
        ]
    },
    {
        id: "rights",
        title: "Data Subject Rights",
        paragraphs: [
            "Triven will reasonably assist with requests for access, rectification, erasure, portability, restriction, and objection, taking into account the nature of processing and applicable law."
        ]
    },
    {
        id: "breach",
        title: "Data Breach Notification",
        paragraphs: [
            "Triven will notify the Data Controller without undue delay after becoming aware of a personal data breach and will provide available details about affected data, likely consequences, and remediation."
        ]
    },
    {
        id: "retention",
        title: "Data Retention & Deletion",
        bullets: [
            "Production personal data is targeted for deletion within 30 days after termination or a valid deletion request.",
            "Residual backup copies are targeted for deletion within 90 days.",
            "Data may be retained longer only when required by applicable law."
        ]
    },
    {
        id: "transfers",
        title: "International Transfers",
        paragraphs: [
            "Where personal data is transferred across borders, Triven uses a lawful transfer mechanism, including applicable Standard Contractual Clauses and supplementary safeguards."
        ]
    },
    {
        id: "audit",
        title: "Audit Rights",
        paragraphs: [
            "Triven will provide information reasonably necessary to demonstrate compliance and support one reasonable audit per calendar year with advance written notice, subject to confidentiality and security requirements."
        ]
    },
    {
        id: "term",
        title: "Term & Termination",
        paragraphs: [
            "This DPA remains effective while Triven processes personal data for the Data Controller. Confidentiality, security, deletion, and audit obligations survive termination where applicable."
        ]
    }
] as const;

const DATA_CATEGORIES = [
    ["Caller phone numbers", "Agent execution", "Up to 90 days"],
    ["SMS content", "Service delivery", "Up to 30 days"],
    ["Call metadata", "Analytics", "Up to 12 months"],
    ["Business configuration", "Service delivery", "Account lifetime"],
    ["Execution logs", "Reliability and debugging", "Up to 14 days"]
];

const SUBPROCESSORS = [
    ["Amazon Web Services", "Infrastructure hosting"],
    ["Twilio", "Communications delivery"],
    ["Stripe", "Payment processing"],
    ["OpenAI", "AI model inference"]
];

export default function BusinessDPA() {
    const authUser = useMemo(() => getAuthUser(), []);
    const [downloading, setDownloading] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [downloadError, setDownloadError] = useState("");
    const [requestError, setRequestError] = useState("");
    const [submitted, setSubmitted] = useState(false);
    const [form, setForm] = useState({
        fullName: authUser?.fullName ?? "",
        company: "",
        email: authUser?.email ?? "",
        industry: "",
        requirements: ""
    });

    async function handleDownload() {
        setDownloading(true);
        setDownloadError("");
        const result = await downloadDpaPdf();
        setDownloading(false);
        if (!result.success) setDownloadError(result.error ?? "Could not download the DPA");
    }

    async function handleRequest(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        setRequesting(true);
        setRequestError("");
        const result = await requestSignedDpa(form);
        setRequesting(false);
        if (!result.success) {
            setRequestError(result.error ?? "Could not send your request");
            return;
        }
        setSubmitted(true);
    }

    return (
        <div className="min-h-screen bg-gray-50 text-slate-700 antialiased" data-testid="dpa-page">
            <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
                <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5 sm:px-8">
                    <a href="#top" className="inline-flex items-center gap-2.5" aria-label="Triven Data Processing Agreement">
                        <Image
                            src="/triven.ai word logo transparent bg.PNG"
                            alt="Triven logo"
                            width={36}
                            height={36}
                            priority
                            className="h-9 w-9 object-contain"
                        />
                        <span className="text-xl font-extrabold tracking-tight text-amber-500">Triven.ai</span>
                    </a>
                    <span className="hidden rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500 sm:inline-flex">
                        Legal &amp; Compliance
                    </span>
                </div>
            </header>

            <main id="top">
                <section className="relative overflow-hidden">
                    <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
                        <div className="absolute left-1/2 top-[-6rem] h-[24rem] w-[44rem] max-w-[90vw] -translate-x-1/2 rounded-full bg-amber-200/40 blur-[110px]" />
                        <div className="absolute right-[8%] top-24 h-56 w-56 rounded-full bg-amber-100/60 blur-[90px]" />
                    </div>
                    <div className="relative z-10 mx-auto max-w-4xl px-5 pb-12 pt-14 text-center sm:px-8 sm:pt-16">
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-amber-700">
                            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                                <path fillRule="evenodd" d="M10 1.6 3 4.3v4.4c0 4.1 2.8 7.9 7 9.7 4.2-1.8 7-5.6 7-9.7V4.3L10 1.6Zm3.4 6.7-4 4.3a.9.9 0 0 1-1.3 0L6 10.4a.9.9 0 1 1 1.3-1.2l1.4 1.5 3.4-3.6a.9.9 0 0 1 1.3 1.2Z" clipRule="evenodd" />
                            </svg>
                            Legal &amp; Compliance
                        </span>
                        <h1 className="mt-6 text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl">
                            Data Processing Agreement
                        </h1>
                        <p className="mx-auto mt-5 max-w-2xl text-lg leading-relaxed text-slate-600">
                            Review the agreement online or download the authoritative pre-signed PDF.
                        </p>

                        <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap items-center justify-center gap-2.5" aria-label="Document details">
                            {["Version 1.1", "Pre-signed PDF", "Effective July 2026"].map((badge) => (
                                <li key={badge} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 shadow-sm">
                                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                                    {badge}
                                </li>
                            ))}
                        </ul>

                        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
                            <button
                                type="button"
                                onClick={() => void handleDownload()}
                                disabled={downloading}
                                data-testid="dpa-download"
                                className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-semibold text-slate-950 shadow-[0_1px_2px_rgba(180,83,9,0.20),0_8px_20px_-6px_rgba(245,158,11,0.45)] transition hover:-translate-y-0.5 hover:bg-amber-400 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                            >
                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M10 3v10m0 0 3.5-3.5M10 13 6.5 9.5M4 16h12" />
                                </svg>
                                {downloading ? "Preparing PDF..." : "Download pre-signed PDF"}
                            </button>
                            <a href="#request" className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:text-slate-950 sm:w-auto">
                                Request Signed DPA
                                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                    <path d="M4 10h12M11 5l5 5-5 5" />
                                </svg>
                            </a>
                        </div>
                        {downloadError ? <p className="mt-4 text-sm font-medium text-red-600" role="alert">{downloadError}</p> : null}
                    </div>
                </section>

                <div className="mx-auto grid max-w-6xl items-start gap-10 px-4 pb-24 sm:px-6 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-14 lg:px-8">
                    <div className="min-w-0">
                        <details className="group mb-6 lg:hidden">
                            <summary className="flex cursor-pointer list-none items-center justify-between rounded-2xl border border-slate-200 bg-white px-5 py-4 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_-6px_rgba(15,23,42,0.10)]">
                                <span className="flex items-center gap-2.5">
                                    <svg className="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M4 6h12M4 10h12M4 14h7" /></svg>
                                    <span className="text-sm font-semibold text-slate-900">Table of Contents</span>
                                </span>
                                <svg className="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
                            </summary>
                            <ol className="mt-2 space-y-0.5 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
                                {SECTIONS.map((section, index) => <TocItem key={section.id} section={section} index={index} />)}
                            </ol>
                        </details>
                        <article className="rounded-3xl border border-slate-900/5 bg-white p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-8px_rgba(15,23,42,0.10),0_40px_80px_-32px_rgba(15,23,42,0.12)] sm:p-10 lg:p-14">
                            <div className="mb-12 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-left text-sm leading-relaxed text-amber-950">
                                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M10 8v5M10 5.5h.01" strokeLinecap="round" /></svg>
                                <p><strong>Agreement overview.</strong> The downloadable pre-signed Version 1.1 PDF is the authoritative Data Processing Agreement.</p>
                            </div>
                            <div className="space-y-14">
                                {SECTIONS.map((section, index) => (
                                    <section key={section.id} id={section.id} className="scroll-mt-28">
                                        <div className="border-l-4 border-amber-400 pl-4">
                                            <div className="text-xs font-bold uppercase tracking-widest text-amber-600">
                                                Section {String(index + 1).padStart(2, "0")}
                                            </div>
                                            <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">{section.title}</h2>
                                        </div>
                                        {"content" in section ? (
                                            <dl className="mt-6 divide-y divide-slate-100 rounded-2xl bg-slate-50/60 px-5">
                                                {section.content.map(([term, definition]) => (
                                                    <div key={term} className="grid gap-1 py-4 sm:grid-cols-[10rem_1fr] sm:gap-6">
                                                        <dt className="font-semibold text-slate-900">{term}</dt>
                                                        <dd className="leading-relaxed">{definition}</dd>
                                                    </div>
                                                ))}
                                            </dl>
                                        ) : null}
                                        {"paragraphs" in section ? section.paragraphs.map((paragraph) => (
                                            <p key={paragraph} className="mt-5 leading-relaxed">{paragraph}</p>
                                        )) : null}
                                        {"bullets" in section ? (
                                            <ul className="mt-6 space-y-3">
                                                {section.bullets.map((bullet) => (
                                                    <li key={bullet} className="flex gap-3 leading-relaxed">
                                                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />{bullet}
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                        {section.id === "categories" ? <DpaTable headings={["Data type", "Purpose", "Retention"]} rows={DATA_CATEGORIES} /> : null}
                                        {section.id === "subprocessors" ? <DpaTable headings={["Sub-processor", "Purpose"]} rows={SUBPROCESSORS} /> : null}
                                    </section>
                                ))}
                            </div>
                        </article>

                        <section id="request" className="mt-10 scroll-mt-28 rounded-2xl border border-amber-100 bg-amber-50 p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_-6px_rgba(15,23,42,0.10)] sm:p-8 lg:p-10">
                            {submitted ? (
                                <div className="py-6 text-center" data-testid="dpa-request-success">
                                    <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-green-100 text-2xl text-green-700">✓</div>
                                    <h2 className="mt-5 text-2xl font-bold text-slate-900">Request received</h2>
                                    <p className="mt-2 text-slate-600">We’ll contact you about your signed DPA within 2 business days.</p>
                                </div>
                            ) : (
                                <>
                                    <h2 className="text-2xl font-bold text-slate-900">Request a Signed DPA</h2>
                                    <p className="mt-2 text-slate-600">Provide your organization details and our support team will follow up.</p>
                                    <form onSubmit={handleRequest} className="mt-7 space-y-5" data-testid="dpa-request-form">
                                        <div className="grid gap-5 sm:grid-cols-2">
                                            <DpaInput label="Full name" value={form.fullName} required onChange={(value) => setForm((current) => ({ ...current, fullName: value }))} />
                                            <DpaInput label="Company name" value={form.company} required onChange={(value) => setForm((current) => ({ ...current, company: value }))} />
                                            <DpaInput label="Email address" type="email" value={form.email} required onChange={(value) => setForm((current) => ({ ...current, email: value }))} />
                                            <label className="text-sm font-semibold text-slate-800">Industry
                                                <select value={form.industry} onChange={(event) => setForm((current) => ({ ...current, industry: event.target.value }))} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal text-slate-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100">
                                                    <option value="">Select industry</option><option>Dental</option><option>Medical</option><option>Legal</option><option>HVAC</option><option>Other</option>
                                                </select>
                                            </label>
                                        </div>
                                        <label className="block text-sm font-semibold text-slate-800">Specific requirements <span className="font-normal text-slate-400">(optional)</span>
                                            <textarea value={form.requirements} onChange={(event) => setForm((current) => ({ ...current, requirements: event.target.value }))} rows={4} className="mt-2 w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal text-slate-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100" />
                                        </label>
                                        <button type="submit" disabled={requesting} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-5 py-3.5 text-sm font-semibold text-white shadow-[0_1px_2px_rgba(180,83,9,0.20),0_8px_20px_-6px_rgba(245,158,11,0.45)] transition hover:-translate-y-0.5 hover:bg-amber-600 disabled:opacity-50 sm:w-auto" data-testid="dpa-request-submit">
                                            {requesting ? "Sending request…" : "Request DPA"}
                                            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 10h12M11 5l5 5-5 5" /></svg>
                                        </button>
                                    </form>
                                    {requestError ? <p className="mt-4 text-sm font-medium text-red-600" role="alert">{requestError}</p> : null}
                                    <p className="mt-6 text-sm text-slate-500">Questions? <a href="mailto:support@triven.ai" className="font-semibold text-amber-700 hover:underline">support@triven.ai</a></p>
                                </>
                            )}
                        </section>
                    </div>

                    <aside className="hidden lg:block">
                        <nav className="sticky top-28" aria-label="DPA table of contents">
                            <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-slate-400">
                                <span className="h-px w-5 bg-slate-200" />On this page
                            </div>
                            <ol className="space-y-0.5 text-sm">
                                {SECTIONS.map((section, index) => <TocItem key={section.id} section={section} index={index} />)}
                            </ol>
                        </nav>
                    </aside>
                </div>

                <footer className="border-t border-slate-900/5 bg-white">
                    <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
                        <div className="flex items-center gap-3">
                            <Image src="/triven.ai word logo transparent bg.PNG" alt="Triven logo" width={28} height={28} className="h-7 w-7 object-contain" />
                            <span className="font-extrabold tracking-tight text-amber-500">Triven.ai</span>
                            <span className="hidden h-4 w-px bg-slate-200 sm:block" />
                            <span className="text-sm text-slate-400">© 2026 Triven AI Agent Platform</span>
                        </div>
                        <a href="mailto:support@triven.ai" className="text-sm font-medium text-slate-500 transition hover:text-slate-900">support@triven.ai</a>
                    </div>
                </footer>
            </main>
        </div>
    );
}

function DpaTable({ headings, rows }: { headings: readonly string[]; rows: readonly (readonly string[])[] }) {
    return <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200"><table className="w-full min-w-[34rem] text-sm"><thead><tr className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">{headings.map((heading) => <th key={heading} className="px-5 py-3.5">{heading}</th>)}</tr></thead><tbody className="divide-y divide-gray-100">{rows.map((row) => <tr key={row[0]}>{row.map((cell, index) => <td key={cell} className={`px-5 py-3.5 ${index === 0 ? "font-medium text-slate-900" : "text-slate-600"}`}>{cell}</td>)}</tr>)}</tbody></table></div>;
}

function DpaInput({ label, value, onChange, type = "text", required = false }: { label: string; value: string; onChange: (value: string) => void; type?: string; required?: boolean }) {
    return <label className="text-sm font-semibold text-slate-800">{label}{required ? <span className="text-amber-600"> *</span> : null}<input type={type} value={value} onChange={(event) => onChange(event.target.value)} required={required} className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 font-normal text-slate-900 shadow-sm focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-100" /></label>;
}

function TocItem({ section, index }: { section: (typeof SECTIONS)[number]; index: number }) {
    return (
        <li>
            <a href={`#${section.id}`} className="group flex items-center gap-3 rounded-lg px-2.5 py-2 text-slate-500 transition hover:bg-amber-50 hover:text-slate-900">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-[11px] font-bold tabular-nums text-slate-400 transition group-hover:border-amber-300 group-hover:text-amber-700">{index + 1}</span>
                <span className="leading-snug">{section.title}</span>
            </a>
        </li>
    );
}
