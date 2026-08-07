"use client";

import {
  DEEPGRAM_STT_LANGUAGES,
  DEEPGRAM_STT_MODELS
} from "@coreai/shared";
import type { BuilderNode, BuilderNodeData } from "./types";
import { Section, Label, TextInput, SelectBox } from "./node-inspector";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};

const BOOL_OPTIONS = [
  { value: "true", label: "On" },
  { value: "false", label: "Off" }
];

export function DeepgramNodeInspector({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const data = selectedNode.data ?? {};
  const str = (field: string, fallback = "") =>
    typeof data[field] === "string" ? (data[field] as string) : fallback;

  const model = str("model", "nova-3");
  const language = str("language", "en");
  const audioSource = str("audioSource");
  const outputKey = str("outputKey", "transcript");
  const smartFormat = str("smartFormat", "true");
  const punctuate = str("punctuate", "true");
  const diarize = str("diarize", "false");

  const languageOptions = DEEPGRAM_STT_LANGUAGES.map((item) => ({
    value: item.value,
    label: item.label
  }));
  const selectedModel =
    (DEEPGRAM_STT_MODELS as readonly string[]).includes(model) ? model : "nova-3";

  return (
    <div data-testid="deepgram-stt-node-inspector">
      <Section title="General">
        <Label>Node name</Label>
        <TextInput
          testId="deepgram-node-title-input"
          value={selectedNode.data.title ?? "Deepgram STT"}
          onChange={(val) => onUpdateNodeData("title", val)}
        />
      </Section>

      <Section title="Transcription">
        <div className="space-y-3">
          <div>
            <Label>Model</Label>
            <SelectBox
              testId="deepgram-model-select"
              value={selectedModel}
              onChange={(val) => onUpdateNodeData("model", val)}
              options={[...DEEPGRAM_STT_MODELS]}
            />
          </div>
          <div>
            <Label>Language</Label>
            <SelectBox
              testId="deepgram-language-select"
              value={language}
              onChange={(val) => onUpdateNodeData("language", val)}
              options={languageOptions}
            />
          </div>
          <div>
            <Label>Audio source variable</Label>
            <TextInput
              testId="deepgram-audio-source-input"
              value={audioSource}
              onChange={(val) => onUpdateNodeData("audioSource", val)}
              placeholder="Leave empty to use live mic / uploaded audio"
              mono
            />
          </div>
          <div>
            <Label>Output key</Label>
            <TextInput
              testId="deepgram-output-key-input"
              value={outputKey}
              onChange={(val) => onUpdateNodeData("outputKey", val)}
              placeholder="transcript"
              mono
            />
          </div>
        </div>
      </Section>

      <Section title="Formatting" last>
        <div className="space-y-3">
          <div>
            <Label>Smart format</Label>
            <SelectBox
              testId="deepgram-smart-format-select"
              value={smartFormat}
              onChange={(val) => onUpdateNodeData("smartFormat", val)}
              options={BOOL_OPTIONS}
            />
          </div>
          <div>
            <Label>Punctuation</Label>
            <SelectBox
              testId="deepgram-punctuate-select"
              value={punctuate}
              onChange={(val) => onUpdateNodeData("punctuate", val)}
              options={BOOL_OPTIONS}
            />
          </div>
          <div>
            <Label>Speaker diarization</Label>
            <SelectBox
              testId="deepgram-diarize-select"
              value={diarize}
              onChange={(val) => onUpdateNodeData("diarize", val)}
              options={BOOL_OPTIONS}
            />
          </div>
        </div>
      </Section>
    </div>
  );
}
