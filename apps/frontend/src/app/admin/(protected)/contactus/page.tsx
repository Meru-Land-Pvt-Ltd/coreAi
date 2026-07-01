"use client";

import { useEffect, useMemo, useState } from "react";
import { getAdminContactSubmissions, type AdminContactSubmission } from "@/components/admin/features/api";

const PREVIEW_LENGTH = 320;

const SUBJECT_LABELS: Record<string, string> = {
  general: "General Inquiry",
  "business-support": "Business Support",
  "architect-support": "AI Architect Support",
  partnership: "Partnership",
  "bug-report": "Bug Report"
};

function subjectLabel(value: string) {
  return SUBJECT_LABELS[value] ?? value;
}

function MessageBlock({ text, submissionId }: { text: string; submissionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = text.length > PREVIEW_LENGTH;
  const visible = expanded || !isLong ? text : `${text.slice(0, PREVIEW_LENGTH).trimEnd()}…`;

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Message</div>
      <p
        data-testid={`admin-contact-submissions-message-${submissionId}`}
        className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]"
      >
        {visible}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          data-testid={`admin-contact-submissions-toggle-${submissionId}`}
          className="mt-2 text-xs font-semibold text-orange-600 transition hover:text-orange-700"
        >
          {expanded ? "Show less" : "Show full message"}
        </button>
      ) : null}
    </div>
  );
}

function SubmissionCard({ row }: { row: AdminContactSubmission }) {
  return (
    <article
      data-testid={`admin-contact-submissions-item-${row.id}`}
      className="rounded-2xl border border-orange-100 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span className="inline-flex rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">
          {subjectLabel(row.subject)}
        </span>
        <time
          className="text-xs font-medium text-slate-400"
          data-testid={`admin-contact-submissions-submitted-${row.id}`}
          dateTime={row.createdAt}
        >
          {new Date(row.createdAt).toLocaleString()}
        </time>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Name</div>
          <div className="mt-1 text-sm font-medium text-slate-800" data-testid={`admin-contact-submissions-name-${row.id}`}>
            {row.name}
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Email</div>
          <a
            href={`mailto:${row.email}`}
            className="mt-1 block break-all text-sm font-medium text-orange-700 hover:text-orange-800"
            data-testid={`admin-contact-submissions-email-${row.id}`}
          >
            {row.email}
          </a>
        </div>
      </div>

      <MessageBlock text={row.message} submissionId={row.id} />
    </article>
  );
}

export default function AdminContactUsPage() {
  const [rows, setRows] = useState<AdminContactSubmission[]>([]);
  const [search, setSearch] = useState("");
  const [subject, setSubject] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  async function load(searchValue: string, subjectValue: string) {
    setState("loading");
    const result = await getAdminContactSubmissions({
      search: searchValue,
      subject: subjectValue,
      limit: 100
    });

    if (result.success && result.data) {
      setRows(result.data.items);
      setState("ready");
      setMessage("");
    } else {
      setState("error");
      setMessage(result.error ?? "Could not load contact submissions.");
    }
  }

  useEffect(() => {
    void load("", "");
  }, []);

  const subjects = useMemo(
    () => Array.from(new Set(rows.map((row) => row.subject))).sort((a, b) => a.localeCompare(b)),
    [rows]
  );

  return (
    <div className="min-w-0">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Contact us</h1>
          <p className="mt-1 text-sm text-slate-500">Review messages submitted from the public contact form.</p>
        </div>
        {state === "ready" ? (
          <p className="text-sm font-medium text-slate-400" data-testid="admin-contact-submissions-count">
            {rows.length} {rows.length === 1 ? "message" : "messages"}
          </p>
        ) : null}
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(search.trim(), subject.trim());
        }}
        className="mb-6 flex flex-wrap gap-2"
      >
        <input
          data-testid="admin-contact-submissions-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, email, subject, or message"
          className="min-w-[220px] flex-1 rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400 sm:max-w-md"
        />
        <select
          data-testid="admin-contact-submissions-subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        >
          <option value="">All subjects</option>
          {subjects.map((item) => (
            <option key={item} value={item}>
              {subjectLabel(item)}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">
          Search
        </button>
      </form>

      {message ? (
        <p data-testid="admin-contact-submissions-message-banner" className="mb-3 text-sm font-semibold text-orange-700">
          {message}
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="space-y-4" data-testid="admin-contact-submissions-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl border border-orange-100 bg-white" />
          ))}
        </div>
      ) : state === "error" ? (
        <p data-testid="admin-contact-submissions-error" className="text-sm font-semibold text-red-600">
          Could not load contact submissions.
        </p>
      ) : rows.length === 0 ? (
        <div
          className="rounded-2xl border border-dashed border-orange-200 bg-white px-6 py-16 text-center"
          data-testid="admin-contact-submissions-empty"
        >
          <p className="text-sm font-semibold text-slate-700">No contact messages found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search or subject filter.</p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="admin-contact-submissions-list">
          {rows.map((row) => (
            <SubmissionCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
