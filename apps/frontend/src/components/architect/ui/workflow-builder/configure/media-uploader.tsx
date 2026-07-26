import { useRef, useState, type DragEvent } from "react";
import { apiUpload } from "@/lib/api";
import { BuilderIcon } from "../icons";

const MAX_ICON_BYTES = 1024 * 1024;
const MAX_SCREENSHOT_BYTES = 3 * 1024 * 1024;
const MAX_SCREENSHOTS = 4;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function storeImage(file: File, kind: "icon" | "screenshot"): Promise<string> {
  if (kind === "icon") return readAsDataUrl(file);

  const form = new FormData();
  form.append("file", file);
  form.append("kind", kind);

  const response = await apiUpload<{ url: string }>("/architect/media/upload", form);
  if (response.success && response.data?.url) {
    return response.data.url;
  }
  if (response.code === "STORAGE_NOT_CONFIGURED" || response.status === 503) {
    return readAsDataUrl(file);
  }
  throw new Error(response.error || "Could not upload the image.");
}

export function IconUploader({
  iconUrl,
  onIconChange,
  onError,
  disabled = false
}: {
  iconUrl: string;
  onIconChange: (dataUrl: string) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File | undefined) {
    if (!file || disabled || uploading) return;
    if (!["image/png", "image/svg+xml", "image/jpeg", "image/webp"].includes(file.type)) {
      onError("Icon must be a PNG, SVG, JPG, or WEBP image.");
      return;
    }
    if (file.size > MAX_ICON_BYTES) {
      onError("Icon must be under 1MB.");
      return;
    }
    setUploading(true);
    try {
      onIconChange(await storeImage(file, "icon"));
    } catch (error) {
      onError(error instanceof Error ? error.message : "Could not upload the icon file.");
    } finally {
      setUploading(false);
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    void handleFile(event.dataTransfer.files?.[0]);
  }

  const dropzoneClass = [
    "dropzone relative flex h-44 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/40 px-4 text-center sm:w-44",
    dragOver ? "dragover" : "",
    iconUrl ? "filled" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload agent icon"
      data-testid="configure-icon-dropzone"
      onClick={() => !disabled && !uploading && inputRef.current?.click()}
      onKeyDown={(event) => {
        if ((event.key === "Enter" || event.key === " ") && !disabled && !uploading) inputRef.current?.click();
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
      className={dropzoneClass}
    >
      {iconUrl ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl bg-white">
          <div className="shadow-amber-sm mb-2 flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600">
            <img src={iconUrl} alt="Agent icon preview" className="h-full w-full object-cover" />
          </div>
          <p className="max-w-full truncate px-3 text-[12.5px] font-semibold text-slate-700">Icon uploaded</p>
          {!disabled ? (
            <button
              type="button"
              data-testid="configure-icon-remove"
              onClick={(event) => {
                event.stopPropagation();
                onIconChange("");
              }}
              className="mt-1.5 text-[11.5px] font-semibold text-red-500 hover:text-red-600"
            >
              Remove
            </button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col items-center">
          <div className="shadow-soft mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-gray-100 bg-white">
            <svg className="h-5 w-5 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4m0 0L8 8m4-4 4 4" />
              <path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </div>
          <p className="text-[13px] font-semibold text-slate-700">{uploading ? "Uploading…" : "Drop or click to upload"}</p>
          <p className="mt-1 text-[11.5px] text-slate-400">PNG or SVG · 512×512 · under 1MB</p>
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".png,.svg,.jpg,.jpeg,.webp,image/png,image/svg+xml,image/jpeg,image/webp"
        className="hidden"
        data-testid="configure-icon-input"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </div>
  );
}

export function ScreenshotUploader({
  screenshotUrls,
  onChange,
  onError,
  disabled = false
}: {
  screenshotUrls: string[];
  onChange: (urls: string[]) => void;
  onError: (message: string) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  async function handleFiles(files: FileList | null) {
    if (!files || disabled || uploading) return;

    setUploading(true);
    try {
      const next = [...screenshotUrls];
      for (const file of Array.from(files)) {
        if (next.length >= MAX_SCREENSHOTS) break;
        if (!file.type.startsWith("image/")) {
          onError("Screenshots must be images.");
          continue;
        }
        if (file.size > MAX_SCREENSHOT_BYTES) {
          onError(`"${file.name}" is over 3MB — please compress it first.`);
          continue;
        }
        try {
          next.push(await storeImage(file, "screenshot"));
        } catch (error) {
          onError(error instanceof Error ? error.message : `Could not upload "${file.name}".`);
        }
      }
      onChange(next.slice(0, MAX_SCREENSHOTS));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {screenshotUrls.map((url, index) => (
        <div
          key={`${index}-${url.slice(0, 24)}`}
          className="dropzone filled group relative aspect-[3/4] overflow-hidden rounded-xl border-2 border-solid border-amber-500 bg-[#fffbeb]"
          data-testid={`configure-screenshot-${index}`}
        >
          <img src={url} alt={`Screenshot ${index + 1}`} className="h-full w-full object-cover" />
          {index === 0 ? (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 shadow-sm">
              Cover
            </span>
          ) : null}
          {!disabled ? (
            <button
              type="button"
              data-testid={`configure-screenshot-remove-${index}`}
              aria-label={`Remove screenshot ${index + 1}`}
              onClick={() => onChange(screenshotUrls.filter((_, i) => i !== index))}
              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900/70 text-white opacity-0 transition group-hover:opacity-100"
            >
              <BuilderIcon name="x" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ))}
      {screenshotUrls.length < MAX_SCREENSHOTS ? (
        <button
          type="button"
          data-testid="configure-screenshot-add"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOverIndex(screenshotUrls.length);
          }}
          onDragLeave={() => setDragOverIndex(null)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOverIndex(null);
            void handleFiles(event.dataTransfer.files);
          }}
          className={[
            "dropzone flex aspect-[3/4] flex-col items-center justify-center rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/40 text-slate-400",
            dragOverIndex === screenshotUrls.length ? "dragover" : "",
            disabled ? "opacity-60" : "cursor-pointer"
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <svg className="mb-1 h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          <span className="text-[11px] font-semibold">{uploading ? "Uploading…" : "Add image"}</span>
        </button>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="configure-screenshot-input"
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.target.value = "";
        }}
      />
    </div>
  );
}
