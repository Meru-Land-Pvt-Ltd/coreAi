import { useEffect, useRef, type ReactElement } from "react";

type EditorCommand = "bold" | "italic" | "insertUnorderedList" | "insertOrderedList";

const TOOLBAR: { command: EditorCommand; title: string; icon: ReactElement }[] = [
  {
    command: "bold",
    title: "Bold",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 4h7a4 4 0 0 1 0 8H6zM6 12h8a4 4 0 0 1 0 8H6z" />
      </svg>
    )
  },
  {
    command: "italic",
    title: "Italic",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M19 4h-9M14 20H5M15 4 9 20" />
      </svg>
    )
  },
  {
    command: "insertUnorderedList",
    title: "Bullet list",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6h13M8 12h13M8 18h13" />
        <circle cx="3.5" cy="6" r="1.2" />
        <circle cx="3.5" cy="12" r="1.2" />
        <circle cx="3.5" cy="18" r="1.2" />
      </svg>
    )
  },
  {
    command: "insertOrderedList",
    title: "Numbered list",
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M10 6h11M10 12h11M10 18h11" />
        <path d="M4 6h1v4M4 10h2" />
        <path d="M3.5 16.5c0-.8 1.5-.8 1.5 0 0 .6-1.5 1-1.5 2H5" />
      </svg>
    )
  }
];

function plainTextLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .length;
}

export function RichDescriptionEditor({
  value,
  onChange,
  placeholder = "Describe what your agent does, how it helps, and what makes it different…",
  disabled = false,
  maxLength = 2000
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const lastValidHtmlRef = useRef(value);

  // Only push external value into the DOM when it actually differs — writing
  // innerHTML on every keystroke would reset the caret position.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) {
      editor.innerHTML = value;
    }
    lastValidHtmlRef.current = value;
  }, [value]);

  function stripImages(editor: HTMLDivElement) {
    editor.querySelectorAll("img").forEach((img) => img.remove());
  }

  function syncValue() {
    const editor = editorRef.current;
    if (!editor) return;
    stripImages(editor);
    const html = editor.innerHTML;
    if (plainTextLength(html) > maxLength) {
      editor.innerHTML = lastValidHtmlRef.current;
      return;
    }
    lastValidHtmlRef.current = html;
    onChange(html);
  }

  function runCommand(command: EditorCommand) {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command);
    syncValue();
  }

  return (
    <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50/40 transition focus-within:border-amber-300 focus-within:ring-2 focus-within:ring-amber-400/40">
      <div className="flex items-center gap-1 border-b border-gray-100 bg-white/60 px-2.5 py-2">
        {TOOLBAR.map((tool, index) => (
          <span key={tool.command} className="flex items-center">
            {index === 2 ? <span className="mx-1 h-5 w-px bg-gray-200" /> : null}
            <button
              type="button"
              title={tool.title}
              data-testid={`configure-description-cmd-${tool.command.toLowerCase()}`}
              disabled={disabled}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runCommand(tool.command)}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-500 transition hover:bg-gray-100 hover:text-slate-900 disabled:opacity-50"
            >
              {tool.icon}
            </button>
          </span>
        ))}
      </div>
      <div
        ref={editorRef}
        data-testid="configure-description-textarea"
        role="textbox"
        aria-multiline="true"
        aria-label="Full description"
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder}
        onInput={syncValue}
        onPaste={(event) => {
          event.preventDefault();
          const editor = editorRef.current;
          if (!editor) return;
          const pasted = event.clipboardData.getData("text/plain");
          const remaining = maxLength - plainTextLength(editor.innerHTML);
          if (remaining <= 0) return;
          document.execCommand("insertText", false, pasted.slice(0, remaining));
          syncValue();
        }}
        onDrop={(event) => {
          event.preventDefault();
        }}
        onDragOver={(event) => {
          event.preventDefault();
        }}
        className="configure-editor min-h-[150px] px-4 py-3.5 text-[14.5px] leading-relaxed text-slate-700 outline-none"
      />
      <style>{`
        .configure-editor:empty::before { content: attr(data-placeholder); color: #94a3b8; }
        .configure-editor ul { list-style: disc; padding-left: 1.4em; margin: .4em 0; }
        .configure-editor ol { list-style: decimal; padding-left: 1.4em; margin: .4em 0; }
      `}</style>
    </div>
  );
}
