"use client";

import { useMemo, useRef } from "react";
import {
  resolveScriptLanguage,
  SCRIPT_DEFAULT_TIMEOUT_MS,
  SCRIPT_MAX_SOURCE_LENGTH,
  SCRIPT_MAX_TIMEOUT_MS,
  SCRIPT_MIN_TIMEOUT_MS,
  SCRIPT_STARTER_CODE,
  type ScriptLanguage
} from "@coreai/shared";
import { Label, NumberInput, Section, SelectBox, TextInput } from "./node-inspector";
import type { BuilderNode, BuilderNodeData } from "./types";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};

const LANGUAGE_OPTIONS = [
  { value: "javascript", label: "JavaScript" },
  { value: "python", label: "Python 3" }
];

const HELP: Record<ScriptLanguage, { input: string; output: string }> = {
  javascript: {
    input: "input — everything the workflow has produced so far, as a plain object.",
    output: "return a value to publish it as this node's output."
  },
  python: {
    input: "input — everything the workflow has produced so far, as a dict.",
    output: "assign output = ... (or define main(input)) to publish this node's output."
  }
};

export function ScriptNodeInspector({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const editorRef = useRef<HTMLTextAreaElement>(null);

  const str = (key: string, fallback = ""): string => {
    const value = selectedNode.data[key];
    return typeof value === "string" ? value : fallback;
  };

  const language = resolveScriptLanguage(selectedNode.data.scriptLanguage);
  const code = str("scriptCode");
  const help = HELP[language];

  const lineNumbers = useMemo(() => {
    const count = Math.max(code.split("\n").length, 12);
    return Array.from({ length: count }, (_, index) => index + 1).join("\n");
  }, [code]);

  /* Switching language on untouched starter code swaps in that language's
     starter. Code the architect actually wrote is never overwritten — they can
     port it themselves or undo the switch. */
  const handleLanguageChange = (next: string) => {
    const target = resolveScriptLanguage(next);
    if (target === language) return;

    const untouched = !code.trim() || code === SCRIPT_STARTER_CODE[language];
    onUpdateNodeData("scriptLanguage", target);
    if (untouched) onUpdateNodeData("scriptCode", SCRIPT_STARTER_CODE[target]);
  };

  // Tab indents instead of leaving the editor, and Enter keeps the current
  // indentation — the two things that make a plain textarea unusable for code.
  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const target = event.currentTarget;
    const { selectionStart, selectionEnd, value } = target;

    if (event.key === "Tab") {
      event.preventDefault();
      const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
      onUpdateNodeData("scriptCode", next);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 2;
      });
      return;
    }

    if (event.key === "Enter") {
      const lineStart = value.lastIndexOf("\n", selectionStart - 1) + 1;
      const indent = /^[ \t]*/.exec(value.slice(lineStart, selectionStart))?.[0] ?? "";
      if (!indent) return;
      event.preventDefault();
      const next = `${value.slice(0, selectionStart)}\n${indent}${value.slice(selectionEnd)}`;
      onUpdateNodeData("scriptCode", next);
      requestAnimationFrame(() => {
        target.selectionStart = target.selectionEnd = selectionStart + 1 + indent.length;
      });
    }
  };

  const syncScroll = () => {
    const gutter = editorRef.current?.previousElementSibling as HTMLElement | null;
    if (gutter && editorRef.current) gutter.scrollTop = editorRef.current.scrollTop;
  };

  return (
    <>
      <Section title="General">
        <Label>Node name</Label>
        <TextInput
          value={String(selectedNode.data.title ?? "")}
          onChange={(val) => onUpdateNodeData("title", val)}
          testId="script-node-title"
        />

        <div className="mt-4">
          <Label>Language</Label>
          <SelectBox
            value={language}
            onChange={handleLanguageChange}
            options={LANGUAGE_OPTIONS}
            testId="script-node-language"
          />
        </div>
      </Section>

      <Section title="Code">
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-700 px-3 py-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400">
              {language === "python" ? "code-node.py" : "code-node.js"}
            </span>
            <span className="font-mono text-[10px] text-slate-500">
              {code.length.toLocaleString()} / {SCRIPT_MAX_SOURCE_LENGTH.toLocaleString()}
            </span>
          </div>

          <div className="flex">
            <pre
              aria-hidden="true"
              className="max-h-80 overflow-hidden select-none border-r border-slate-700 bg-slate-900 px-2 py-2 text-right font-mono text-xs leading-relaxed text-slate-600"
            >
              {lineNumbers}
            </pre>

            <textarea
              ref={editorRef}
              data-testid="script-node-code"
              value={code}
              onChange={(event) => onUpdateNodeData("scriptCode", event.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={syncScroll}
              spellCheck={false}
              maxLength={SCRIPT_MAX_SOURCE_LENGTH}
              placeholder={SCRIPT_STARTER_CODE[language]}
              className="h-80 w-full resize-none bg-slate-900 px-3 py-2 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:outline-none ring-0 focus:ring-0 placeholder:text-slate-600"
            />
          </div>
        </div>

        <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-slate-500">
          <li data-testid="script-node-help-input">{help.input}</li>
          <li data-testid="script-node-help-output">{help.output}</li>
          <li>
            {language === "python"
              ? "print() output shows in the Test panel."
              : "console.log() output shows in the Test panel. await is supported."}
          </li>
          <li data-testid="script-node-help-preview">
            Return HTML — or {language === "python" ? '{"html": …, "css": …, "js": …}' : "{ html, css, js }"} — to
            get a live page preview in the Test tab.
          </li>
        </ul>

        <button
          type="button"
          data-testid="script-node-reset"
          onClick={() => onUpdateNodeData("scriptCode", SCRIPT_STARTER_CODE[language])}
          className="mt-3 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
        >
          Reset to example
        </button>
      </Section>

      <Section title="Output" last>
        <Label>Save result as</Label>
        <TextInput
          value={str("scriptOutputKey", "script.output")}
          onChange={(val) => onUpdateNodeData("scriptOutputKey", val)}
          placeholder="script.output"
          mono
          testId="script-node-output-key"
        />
        <p className="mt-1.5 text-[11px] text-slate-500">
          Later steps read it as{" "}
          <span className="font-mono">{`{{${str("scriptOutputKey", "script.output")}}}`}</span>.
        </p>

        <div className="mt-4">
          <Label>Timeout (ms)</Label>
          <NumberInput
            value={str("scriptTimeoutMs", String(SCRIPT_DEFAULT_TIMEOUT_MS))}
            onChange={(val) => onUpdateNodeData("scriptTimeoutMs", val)}
            min={String(SCRIPT_MIN_TIMEOUT_MS)}
            max={String(SCRIPT_MAX_TIMEOUT_MS)}
            step="500"
            testId="script-node-timeout"
          />
          <p className="mt-1.5 text-[11px] text-slate-500">
            The run stops the script at this limit and marks the node failed.
          </p>
        </div>
      </Section>
    </>
  );
}
