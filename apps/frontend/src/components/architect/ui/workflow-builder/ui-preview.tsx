"use client";

import { useEffect, useState } from "react";
import type { UiPreviewSource } from "./ui-preview-source";

type Device = "desktop" | "tablet" | "mobile";

const DEVICES: { id: Device; label: string; width: string }[] = [
  { id: "desktop", label: "Desktop", width: "100%" },
  { id: "tablet", label: "Tablet", width: "768px" },
  { id: "mobile", label: "Mobile", width: "390px" }
];

export function UiPreview({ source, nodeId }: { source: UiPreviewSource; nodeId: string }) {
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [device, setDevice] = useState<Device>("desktop");
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  // Escape leaves fullscreen — the overlay covers the whole builder.
  useEffect(() => {
    if (!fullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [fullscreen]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(source.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const frame = (
    <iframe
      key={`${device}-${fullscreen}`}
      title={`UI preview for ${nodeId}`}
      srcDoc={source.document}
      sandbox="allow-scripts allow-forms"
      referrerPolicy="no-referrer"
      loading="lazy"
      data-testid={`ui-preview-frame-${nodeId}`}
      className="h-full w-full border-0 bg-white"
      style={{ maxWidth: DEVICES.find((d) => d.id === device)?.width }}
    />
  );

  const toolbar = (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 bg-slate-50/80 px-3 py-2">
      <div className="flex items-center gap-1.5">
        <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
          {(["preview", "code"] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              data-testid={`ui-preview-tab-${value}-${nodeId}`}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                tab === value ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              {value}
            </button>
          ))}
        </div>

        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-semibold uppercase text-slate-500">
          {source.origin}
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        {tab === "preview" ? (
          <div className="flex rounded-lg bg-white p-0.5 ring-1 ring-slate-200">
            {DEVICES.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setDevice(option.id)}
                title={option.label}
                data-testid={`ui-preview-device-${option.id}-${nodeId}`}
                className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                  device === option.id ? "bg-slate-900 text-white" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleCopy}
            data-testid={`ui-preview-copy-${nodeId}`}
            className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-900"
          >
            {copied ? "Copied" : "Copy code"}
          </button>
        )}

        <button
          type="button"
          onClick={() => setFullscreen((open) => !open)}
          data-testid={`ui-preview-fullscreen-${nodeId}`}
          className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-900"
        >
          {fullscreen ? "Close" : "Expand"}
        </button>
      </div>
    </div>
  );

  const codeView = (
    <pre className="max-h-full overflow-auto bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
      {source.code}
    </pre>
  );

  const body =
    tab === "preview" ? frame : <div className="w-full overflow-auto">{codeView}</div>;

  return (
    <>
      <div
        className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white"
        data-testid={`ui-preview-${nodeId}`}
      >
        {fullscreen ? (
          <div className="flex h-32 items-center justify-center gap-3 bg-slate-50 text-[12px] text-slate-500">
            Previewing full screen
            <button
              type="button"
              onClick={() => setFullscreen(false)}
              className="rounded-lg bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 transition hover:text-slate-900"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {toolbar}
            <div className="flex h-72 justify-center overflow-hidden bg-slate-100">{body}</div>
          </>
        )}
      </div>

      {fullscreen ? (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-slate-900/70 p-4 sm:p-8"
          data-testid={`ui-preview-overlay-${nodeId}`}
        >
          <div className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            {toolbar}
            <div className="flex flex-1 justify-center overflow-hidden bg-slate-100">{body}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
