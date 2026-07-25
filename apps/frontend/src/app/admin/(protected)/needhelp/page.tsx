"use client";

import { useEffect, useState } from "react";
import {
  fetchAdminSupportIssueBlobUrl,
  getAdminSupportIssues,
  updateAdminSupportIssueStatus,
  type AdminSupportIssue,
  type AdminSupportIssueStatus
} from "@/components/admin/features/api";

const PREVIEW_LENGTH = 320;

const STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "", label: "All statuses" },
  { value: "OPEN", label: "Open" },
  { value: "RESOLVED", label: "Resolved" }
];

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(totalSeconds: number | null): string {
  if (!totalSeconds || totalSeconds <= 0) return "";
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function IssueBlock({ text, issueId }: { text: string; issueId: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();

  if (!trimmed) {
    return (
      <div className="mt-4">
        <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Issue</div>
        <p className="mt-1.5 text-sm italic text-slate-400" data-testid={`admin-support-issue-empty-${issueId}`}>
          No written description — see the attachment(s) below.
        </p>
      </div>
    );
  }

  const isLong = trimmed.length > PREVIEW_LENGTH;
  const visible = expanded || !isLong ? trimmed : `${trimmed.slice(0, PREVIEW_LENGTH).trimEnd()}…`;

  return (
    <div className="mt-4">
      <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Issue</div>
      <p
        data-testid={`admin-support-issue-text-${issueId}`}
        className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600 [overflow-wrap:anywhere]"
      >
        {visible}
      </p>
      {isLong ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          data-testid={`admin-support-issue-toggle-${issueId}`}
          className="mt-2 text-xs font-semibold text-amber-600 transition hover:text-amber-700"
        >
          {expanded ? "Show less" : "Show full issue"}
        </button>
      ) : null}
    </div>
  );
}

function Attachments({ row }: { row: AdminSupportIssue }) {
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState(false);
  const [downloadingDoc, setDownloadingDoc] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");

  useEffect(() => {
    return () => {
      if (voiceUrl) URL.revokeObjectURL(voiceUrl);
    };
  }, [voiceUrl]);

  const hasDocument = Boolean(row.documentName);
  const hasVoice = Boolean(row.voiceName || row.voiceSizeBytes);

  if (!hasDocument && !hasVoice) return null;

  async function handleDownloadDocument() {
    setAttachmentError("");
    setDownloadingDoc(true);
    const url = await fetchAdminSupportIssueBlobUrl(row.id, "document");
    setDownloadingDoc(false);
    if (!url) {
      setAttachmentError("Could not load the document.");
      return;
    }
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = row.documentName ?? "document";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Give the browser a beat to start the download before releasing the URL.
    window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function handleLoadVoice() {
    setAttachmentError("");
    setLoadingVoice(true);
    const url = await fetchAdminSupportIssueBlobUrl(row.id, "voice");
    setLoadingVoice(false);
    if (!url) {
      setAttachmentError("Could not load the voice message.");
      return;
    }
    setVoiceUrl(url);
  }

  return (
    <div className="mt-4 border-t border-gray-100 pt-4" data-testid={`admin-support-issue-attachments-${row.id}`}>
      <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Attachments</div>
      <div className="mt-2 flex flex-col gap-3">
        {hasDocument ? (
          <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-slate-800">{row.documentName}</p>
              <p className="text-xs text-slate-400">
                Document{formatBytes(row.documentSizeBytes) ? ` · ${formatBytes(row.documentSizeBytes)}` : ""}
              </p>
            </div>
            <button
              type="button"
              data-testid={`admin-support-issue-document-${row.id}`}
              onClick={handleDownloadDocument}
              disabled={downloadingDoc}
              className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-amber-600 disabled:opacity-60"
            >
              {downloadingDoc ? "Loading…" : "Download"}
            </button>
          </div>
        ) : null}

        {hasVoice ? (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium text-slate-800">
                Voice message
                {formatDuration(row.voiceDurationSec) ? ` · ${formatDuration(row.voiceDurationSec)}` : ""}
                {formatBytes(row.voiceSizeBytes) ? ` · ${formatBytes(row.voiceSizeBytes)}` : ""}
              </p>
              {!voiceUrl ? (
                <button
                  type="button"
                  data-testid={`admin-support-issue-voice-load-${row.id}`}
                  onClick={handleLoadVoice}
                  disabled={loadingVoice}
                  className="shrink-0 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-slate-700 disabled:opacity-60"
                >
                  {loadingVoice ? "Loading…" : "Load audio"}
                </button>
              ) : null}
            </div>
            {voiceUrl ? (
              <audio
                data-testid={`admin-support-issue-voice-player-${row.id}`}
                controls
                autoPlay
                src={voiceUrl}
                className="mt-3 w-full"
              />
            ) : null}
          </div>
        ) : null}

        {attachmentError ? (
          <p className="text-xs font-semibold text-red-600" data-testid={`admin-support-issue-attachment-error-${row.id}`}>
            {attachmentError}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function IssueCard({ row }: { row: AdminSupportIssue }) {
  const [status, setStatus] = useState(row.status);
  const [updating, setUpdating] = useState(false);
  const isResolved = status === "RESOLVED";

  async function toggleStatus() {
    const next: AdminSupportIssueStatus = isResolved ? "OPEN" : "RESOLVED";
    setUpdating(true);
    const result = await updateAdminSupportIssueStatus(row.id, next);
    setUpdating(false);
    if (result.success && result.data) {
      setStatus(result.data.issue.status);
    }
  }

  return (
    <article
      data-testid={`admin-support-issue-item-${row.id}`}
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <span
          data-testid={`admin-support-issue-status-${row.id}`}
          className={`inline-flex rounded-full px-3 py-1 text-xs font-bold ${
            isResolved ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {isResolved ? "Resolved" : "Open"}
        </span>
        <time
          className="text-xs font-medium text-slate-400"
          data-testid={`admin-support-issue-submitted-${row.id}`}
          dateTime={row.createdAt}
        >
          {new Date(row.createdAt).toLocaleString()}
        </time>
      </div>

      {row.name || row.email ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Name</div>
            <div className="mt-1 text-sm font-medium text-slate-800" data-testid={`admin-support-issue-name-${row.id}`}>
              {row.name || "—"}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-normal text-slate-400">Email</div>
            {row.email ? (
              <a
                href={`mailto:${row.email}`}
                className="mt-1 block break-all text-sm font-medium text-amber-700 hover:text-slate-700"
                data-testid={`admin-support-issue-email-${row.id}`}
              >
                {row.email}
              </a>
            ) : (
              <div className="mt-1 text-sm font-medium text-slate-400">—</div>
            )}
          </div>
        </div>
      ) : null}

      <IssueBlock text={row.issue} issueId={row.id} />

      <Attachments row={row} />

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          data-testid={`admin-support-issue-toggle-status-${row.id}`}
          onClick={toggleStatus}
          disabled={updating}
          className={`rounded-lg border px-4 py-2 text-xs font-bold transition disabled:opacity-60 ${
            isResolved
              ? "border-gray-200 text-slate-600 hover:bg-gray-50"
              : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          }`}
        >
          {updating ? "Saving…" : isResolved ? "Reopen" : "Mark resolved"}
        </button>
      </div>
    </article>
  );
}

export default function AdminNeedHelpPage() {
  const [rows, setRows] = useState<AdminSupportIssue[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  async function load(searchValue: string, statusValue: string) {
    setState("loading");
    const result = await getAdminSupportIssues({
      search: searchValue,
      status: statusValue,
      limit: 100
    });

    if (result.success && result.data) {
      setRows(result.data.items);
      setState("ready");
      setMessage("");
    } else {
      setState("error");
      setMessage(result.error ?? "Could not load help requests.");
    }
  }

  useEffect(() => {
    void load("", "");
  }, []);

  return (
    <div className="min-w-0">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-normal text-slate-900">Need help</h1>
          <p className="mt-1 text-sm text-slate-500">
            Review "Need Help" requests submitted from the landing page — issue text, documents, and voice messages.
          </p>
        </div>
        {state === "ready" ? (
          <p className="text-sm font-medium text-slate-400" data-testid="admin-support-issues-count">
            {rows.length} {rows.length === 1 ? "request" : "requests"}
          </p>
        ) : null}
      </header>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void load(search.trim(), status.trim());
        }}
        className="mb-6 flex flex-wrap gap-2"
      >
        <input
          data-testid="admin-support-issues-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search by name, email, or issue"
          className="min-w-[220px] flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400 sm:max-w-md"
        />
        <select
          data-testid="admin-support-issues-status"
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm outline-none focus:border-amber-400"
        >
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-bold text-white">
          Search
        </button>
      </form>

      {message ? (
        <p data-testid="admin-support-issues-message-banner" className="mb-3 text-sm font-semibold text-amber-700">
          {message}
        </p>
      ) : null}

      {state === "loading" ? (
        <div className="space-y-4" data-testid="admin-support-issues-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-lg border border-gray-200 bg-white" />
          ))}
        </div>
      ) : state === "error" ? (
        <p data-testid="admin-support-issues-error" className="text-sm font-semibold text-red-600">
          Could not load help requests.
        </p>
      ) : rows.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-gray-200 bg-white px-6 py-16 text-center"
          data-testid="admin-support-issues-empty"
        >
          <p className="text-sm font-semibold text-slate-700">No help requests found</p>
          <p className="mt-1 text-sm text-slate-500">Try a different search or status filter.</p>
        </div>
      ) : (
        <div className="space-y-4" data-testid="admin-support-issues-list">
          {rows.map((row) => (
            <IssueCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}
