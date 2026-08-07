"use client";

import { DEEPGRAM_TTS_VOICES } from "@coreai/shared";
import type { BuilderNode, BuilderNodeData } from "./types";
import { Section, Label, TextInput, TextArea, SelectBox } from "./node-inspector";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};

export function DeepgramTtsNodeInspector({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const data = selectedNode.data ?? {};
  const str = (field: string, fallback = "") =>
    typeof data[field] === "string" ? (data[field] as string) : fallback;

  const model = str("model", "aura-2-thalia-en");
  const text = str("text");
  const textSource = str("textSource");
  const outputKey = str("outputKey", "audio");

  const selectedModel =
    (DEEPGRAM_TTS_VOICES as readonly string[]).includes(model) ? model : "aura-2-thalia-en";

  return (
    <div data-testid="deepgram-tts-node-inspector">
      <Section title="General">
        <Label>Node name</Label>
        <TextInput
          testId="deepgram-tts-node-title-input"
          value={selectedNode.data.title ?? "Deepgram TTS"}
          onChange={(val) => onUpdateNodeData("title", val)}
        />
      </Section>

      <Section title="Speech synthesis" last>
        <div className="space-y-3">
          <div>
            <Label>Model</Label>
            <SelectBox
              testId="deepgram-tts-model-select"
              value={selectedModel}
              onChange={(val) => onUpdateNodeData("model", val)}
              options={[...DEEPGRAM_TTS_VOICES]}
            />
          </div>
          <div>
            <Label>Text</Label>
            <TextArea
              testId="deepgram-tts-text-textarea"
              height="h-28"
              value={text}
              onChange={(val) => onUpdateNodeData("text", val)}
              placeholder="Thanks for calling {{business.name}}. How can I help?"
            />
          </div>
          <div>
            <Label>Text source variable</Label>
            <TextInput
              testId="deepgram-tts-text-source-input"
              value={textSource}
              onChange={(val) => onUpdateNodeData("textSource", val)}
              placeholder="Optional — e.g. transcript or ai.output"
              mono
            />
            <p className="mt-1.5 text-[11px] leading-relaxed text-slate-400">
              If Text is empty, uses this variable (or a prior STT transcript / last AI output).
            </p>
          </div>
          <div>
            <Label>Output key</Label>
            <TextInput
              testId="deepgram-tts-output-key-input"
              value={outputKey}
              onChange={(val) => onUpdateNodeData("outputKey", val)}
              placeholder="audio"
              mono
            />
          </div>
        </div>
      </Section>
    </div>
  );
}
