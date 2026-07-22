"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  deleteBusinessKnowledgeFile,
  getBusinessKnowledgeFiles,
  reprocessBusinessKnowledgeFile,
  syncBusinessKnowledge,
  uploadBusinessKnowledgeFiles,
  type BusinessFaq,
  type KnowledgeFileSummary,
  type KnowledgeLiveSync
} from "@/components/business/features/api";


const KNOWLEDGE_MAX_FILE_BYTES = 10 * 1024 * 1024; // matches backend MAX_FILE_BYTES
const KNOWLEDGE_ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];

function formatKnowledgeFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function knowledgeStatusPill(file: Pick<KnowledgeFileSummary, "status" | "ready">): {
  label: string;
  pill: string;
} {
  if (file.ready) return { label: "Ready", pill: "bg-green-100 text-green-700" };
  if (file.status === "PROCESSED") return { label: "Needs repair", pill: "bg-amber-100 text-amber-700" };
  if (file.status === "REUPLOAD_REQUIRED")
    return { label: "Re-upload required", pill: "bg-rose-100 text-rose-700" };
  if (file.status === "FAILED") return { label: "Failed", pill: "bg-rose-100 text-rose-700" };
  return { label: "Processing", pill: "bg-amber-100 text-amber-700" };
}

export function DocumentUploadSection({
  listingId,
  installedAgentId,
  onSummaryChange,
  onKnowledgeChanged,
  hoursSuggestionReady = false,
  onReviewHours
}: {
  listingId?: string;
  installedAgentId?: string | null;
  onSummaryChange?: (summary: { files: number; ready: number }) => void;
  onKnowledgeChanged?: () => void;
  hoursSuggestionReady?: boolean;
  onReviewHours?: () => void;
}) {
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFileSummary[]>([]);
  const [pendingUploads, setPendingUploads] = useState<{ key: string; name: string; size: number }[]>([]);
  const [uploadError, setUploadError] = useState("");
  const [busyFileIds, setBusyFileIds] = useState<string[]>([]);
  const [liveSyncWarning, setLiveSyncWarning] = useState<string | null>(null);
  const [liveSyncOk, setLiveSyncOk] = useState(false);
  const [syncRetrying, setSyncRetrying] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function applyLiveSync(sync: KnowledgeLiveSync | undefined) {
    if (!sync) return;
    if (!sync.attempted) {
      setLiveSyncWarning(null);
      setLiveSyncOk(false);
      return;
    }
    if (sync.ok) {
      setLiveSyncWarning(null);
      setLiveSyncOk(true);
    } else {
      setLiveSyncOk(false);
      setLiveSyncWarning(sync.error ?? "");
    }
  }

  async function handleSyncRetry() {
    setSyncRetrying(true);
    setLiveSyncOk(false);
    const res = await syncBusinessKnowledge();
    setSyncRetrying(false);
    if (res.success && res.data) {
      applyLiveSync(res.data.liveSync);
    } else {
      setLiveSyncWarning(res.error ?? "Live agent sync failed. Please try again.");
    }
  }

  const refreshKnowledgeFiles = useCallback(async () => {
    const res = await getBusinessKnowledgeFiles();
    if (res.success && res.data) setKnowledgeFiles(res.data.files);
  }, []);

  useEffect(() => {
    void refreshKnowledgeFiles();
  }, [refreshKnowledgeFiles]);

  useEffect(() => {
    onSummaryChange?.({
      files: knowledgeFiles.length,
      ready: knowledgeFiles.filter((file) => file.ready).length
    });
  }, [knowledgeFiles, onSummaryChange]);

  async function uploadPickedFiles(picked: File[]) {
    if (picked.length === 0) return;

    const rejected: string[] = [];
    const accepted: File[] = [];
    for (const file of picked) {
      const dot = file.name.lastIndexOf(".");
      const ext = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
      if (!KNOWLEDGE_ALLOWED_EXTENSIONS.includes(ext)) {
        rejected.push(`${file.name} is not a supported type (use PDF, DOCX, or TXT)`);
      } else if (file.size > KNOWLEDGE_MAX_FILE_BYTES) {
        rejected.push(`${file.name} is larger than 10 MB`);
      } else {
        accepted.push(file);
      }
    }
    setUploadError(rejected.join(" · "));
    if (accepted.length === 0) return;
    setLiveSyncOk(false);

    const pendingKeys = accepted.map((file, idx) => `${Date.now()}-${idx}-${file.name}`);
    setPendingUploads((prev) => [
      ...prev,
      ...accepted.map((file, idx) => ({ key: pendingKeys[idx], name: file.name, size: file.size }))
    ]);

    const res = await uploadBusinessKnowledgeFiles(accepted, {
      ...(listingId ? { listingId } : {}),
      ...(installedAgentId ? { installedAgentId } : {})
    });

    setPendingUploads((prev) => prev.filter((row) => !pendingKeys.includes(row.key)));

    if (res.success && res.data) {
      const returned = res.data.files;
      setKnowledgeFiles((prev) => {
        const byId = new Map(prev.map((file) => [file.id, file]));
        for (const file of returned) byId.set(file.id, file);
        return Array.from(byId.values());
      });
      applyLiveSync(res.data.liveSync);
      void refreshKnowledgeFiles();
      onKnowledgeChanged?.();
    } else {
      setUploadError(res.error ?? "Upload failed. Please try again.");
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? []);
    if (fileInputRef.current) fileInputRef.current.value = "";
    void uploadPickedFiles(picked);
  }

  async function handleRemoveFile(id: string) {
    setBusyFileIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setLiveSyncOk(false);
    const res = await deleteBusinessKnowledgeFile(id);
    setBusyFileIds((prev) => prev.filter((busyId) => busyId !== id));
    if (res.success) {
      setKnowledgeFiles((prev) => prev.filter((file) => file.id !== id));
      applyLiveSync(res.data?.liveSync);
      void refreshKnowledgeFiles();
      onKnowledgeChanged?.();
    } else {
      setUploadError(res.error ?? "Could not remove the document. Please try again.");
    }
  }

  async function handleRetryFile(id: string) {
    setBusyFileIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setLiveSyncOk(false);
    const res = await reprocessBusinessKnowledgeFile(id);
    setBusyFileIds((prev) => prev.filter((busyId) => busyId !== id));
    if (res.success && res.data) {
      const updated = res.data.file;
      setKnowledgeFiles((prev) => prev.map((file) => (file.id === updated.id ? updated : file)));
      applyLiveSync(res.data.liveSync);
      void refreshKnowledgeFiles();
      onKnowledgeChanged?.();
    } else {
      setUploadError(res.error ?? "Could not reprocess the document. Please try again.");
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">Documents & Knowledge Base</h4>
        <span className="text-xs text-slate-400">Optional</span>
      </div>
      <p className="mt-0.5 text-xs text-slate-500">
        Brochures, price lists, policies, or service catalogs.
      </p>

      <label
        htmlFor="file-input"
        className="dropzone rounded-2xl p-5 flex flex-col items-center justify-center text-center gap-1.5 mt-2.5 border-2 border-dashed border-gray-200 cursor-pointer hover:border-amber-300 hover:bg-amber-50/40 transition-colors"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void uploadPickedFiles(Array.from(e.dataTransfer?.files ?? []));
        }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-slate-400">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" />
          <line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        <span className="text-xs text-slate-600">
          <span className="font-semibold text-amber-600">Click to upload</span> or drag and drop
        </span>
        <span className="text-[11px] text-slate-400 font-medium">PDF, DOCX, or TXT · up to 10 MB each</span>
        <input
          ref={fileInputRef}
          id="file-input"
          type="file"
          accept=".pdf,.docx,.txt"
          multiple
          className="sr-only"
          onChange={handleFileChange}
        />
      </label>

      {uploadError ? (
        <p
          className="mt-2.5 rounded-xl bg-rose-50 px-3.5 py-2 text-xs text-rose-600"
          role="alert"
          data-testid="business-setup-knowledge-upload-error"
        >
          {uploadError}
        </p>
      ) : null}

      {knowledgeFiles.length > 0 || pendingUploads.length > 0 ? (
        <div className="mt-2.5 space-y-2" data-testid="business-setup-uploaded-files">
          {pendingUploads.map((row) => (
            <div
              key={row.key}
              className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5 group transition-colors hover:border-slate-200"
              data-testid="business-setup-knowledge-file"
            >
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 grid place-items-center shrink-0">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </span>
              <div className="flex-1 min-w-0" data-testid="business-setup-file-chip">
                <p className="text-xs font-medium text-slate-700 truncate">{row.name}</p>
                <p className="text-[11px] text-slate-400">{formatKnowledgeFileSize(row.size)}</p>
              </div>
              <span
                className="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-bold text-slate-600"
                data-testid="business-setup-knowledge-file-status"
              >
                Uploading…
              </span>
            </div>
          ))}

          {knowledgeFiles.map((file) => {
            const status = knowledgeStatusPill(file);
            const busy = busyFileIds.includes(file.id);
            const needsRepair = file.status === "PROCESSED" && !file.ready;

            return (
              <div
                key={file.id}
                className="flex items-center gap-3 bg-slate-50 border border-slate-100 rounded-xl px-3.5 py-2.5 group transition-colors hover:border-slate-200"
                data-testid="business-setup-knowledge-file"
              >
                <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 grid place-items-center shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0" data-testid="business-setup-file-chip">
                  <p className="text-xs font-medium text-slate-700 truncate">{file.filename}</p>
                  <p className="text-[11px] text-slate-400">
                    {formatKnowledgeFileSize(file.sizeBytes)}
                    {file.ready
                      ? ` · ${file.extractedChars.toLocaleString()} chars`
                      : ""}
                  </p>
                  {needsRepair ? (
                    <p className="text-[11px] text-amber-600 mt-0.5">
                      Processed record doesn&rsquo;t match stored knowledge — retry processing.
                    </p>
                  ) : null}
                  {(file.status === "FAILED" || file.status === "REUPLOAD_REQUIRED") && file.errorMessage ? (
                    <p className="text-[11px] text-rose-600 mt-0.5">{file.errorMessage}</p>
                  ) : null}
                </div>
                <span
                  className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ${status.pill}`}
                  data-testid="business-setup-knowledge-file-status"
                >
                  {status.label}
                </span>
                {file.status === "FAILED" || needsRepair ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRetryFile(file.id)}
                    className="shrink-0 text-xs font-semibold text-amber-600 hover:text-amber-700 transition-colors disabled:opacity-50"
                    data-testid="business-setup-knowledge-file-retry"
                  >
                    {busy ? "Retrying…" : "Retry"}
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleRemoveFile(file.id)}
                  className="text-slate-300 hover:text-red-500 shrink-0 transition-colors disabled:opacity-50"
                  aria-label={`Remove ${file.filename}`}
                  data-testid="business-setup-knowledge-file-remove"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}

      {liveSyncWarning !== null ? (
        <div
          className="mt-2.5 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2 text-xs text-amber-700"
          role="alert"
          data-testid="business-setup-knowledge-sync-warning"
        >
          <p>Documents saved, but live agent wasn&rsquo;t updated yet.</p>
          {liveSyncWarning ? <p className="mt-0.5 text-[11px] text-amber-600">{liveSyncWarning}</p> : null}
          <button
            type="button"
            disabled={syncRetrying}
            onClick={() => void handleSyncRetry()}
            className="mt-1 text-[11px] font-semibold text-amber-700 underline hover:text-amber-800 transition-colors disabled:opacity-50"
            data-testid="business-setup-knowledge-sync-retry"
          >
            {syncRetrying ? "Retrying sync…" : "Retry sync"}
          </button>
        </div>
      ) : liveSyncOk ? (
        <p className="mt-1.5 text-xs text-green-600" data-testid="business-setup-knowledge-sync-ok">
          Live agent updated.
        </p>
      ) : null}

      {hoursSuggestionReady ? (
        <div
          className="mt-2.5 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-100 bg-amber-50/70 px-3.5 py-2"
          data-testid="business-setup-knowledge-hours-hint"
        >
          <p className="text-xs text-amber-800">
            We found opening hours in your documents — review and apply them.
          </p>
          {onReviewHours ? (
            <button
              type="button"
              data-testid="business-setup-knowledge-hours-hint-review"
              onClick={onReviewHours}
              className="text-xs font-semibold text-amber-700 underline hover:text-amber-800"
            >
              Review timings
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FaqSection({
  faqs,
  onFaqs
}: {
  faqs: BusinessFaq[];
  onFaqs: (faqs: BusinessFaq[]) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wide">FAQs</h4>
          <p className="mt-0.5 text-xs text-slate-500">Exact answers the agent should give.</p>
        </div>
        <button
          type="button"
          data-testid="business-setup-faq-add"
          onClick={() => onFaqs([...faqs, { question: "", answer: "" }])}
          className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          Add FAQ
        </button>
      </div>

      {faqs.length > 0 ? (
        <div className="mt-2.5 space-y-2.5">
          {faqs.map((faq, index) => (
            <div key={index} className="border border-gray-200 rounded-xl p-3 flex gap-2.5 bg-slate-50/50" data-testid="business-setup-faq-row">
              <div className="flex-1 space-y-1.5">
                <input
                  type="text"
                  value={faq.question}
                  aria-label={`FAQ ${index + 1} question`}
                  onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, question: e.target.value } : f)))}
                  className="field w-full border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none focus:border-amber-400"
                  placeholder="Question, e.g. Do you accept insurance?"
                />
                <textarea
                  rows={2}
                  value={faq.answer}
                  aria-label={`FAQ ${index + 1} answer`}
                  onChange={(e) => onFaqs(faqs.map((f, i) => (i === index ? { ...f, answer: e.target.value } : f)))}
                  className="field w-full border border-gray-200 bg-white rounded-lg px-3 py-1.5 text-xs outline-none resize-none focus:border-amber-400"
                  placeholder="Answer the agent should give"
                />
              </div>
              <button
                type="button"
                onClick={() => onFaqs(faqs.filter((_, i) => i !== index))}
                className="text-slate-400 hover:text-red-500 shrink-0 self-start mt-1 transition-colors"
                aria-label={`Remove FAQ ${index + 1}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 text-xs text-slate-400">No FAQs yet.</p>
      )}
    </div>
  );
}

export function KnowledgeSection({
  listingId,
  installedAgentId,
  faqs,
  onFaqs,
  onSummaryChange,
  onKnowledgeChanged,
  hoursSuggestionReady = false,
  onReviewHours
}: {
  listingId?: string;
  installedAgentId?: string | null;
  faqs: BusinessFaq[];
  onFaqs: (faqs: BusinessFaq[]) => void;
  onSummaryChange?: (summary: { files: number; ready: number }) => void;
  onKnowledgeChanged?: () => void;
  hoursSuggestionReady?: boolean;
  onReviewHours?: () => void;
}) {
  return (
    <div className="space-y-5">
      <DocumentUploadSection
        listingId={listingId}
        installedAgentId={installedAgentId}
        onSummaryChange={onSummaryChange}
        onKnowledgeChanged={onKnowledgeChanged}
        hoursSuggestionReady={hoursSuggestionReady}
        onReviewHours={onReviewHours}
      />
      <div className="border-t border-gray-100 pt-4">
        <FaqSection faqs={faqs} onFaqs={onFaqs} />
      </div>
    </div>
  );
}
