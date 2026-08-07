"use client";

import { Mic } from "lucide-react";
import { ConfigureSectionCard } from "./configure-section-card";
import { DeepgramSttTestCard } from "@/components/common/deepgram-stt-test-card";
import {
  DeepgramTtsTestCard,
  type DeepgramSpeakRequest
} from "@/components/common/deepgram-tts-test-card";
import { testBusinessDeepgramSpeak } from "@/components/business/features/api";

export function DeepgramSetupSection({
  showTest = true,
  showSttTest = true,
  showTtsTest = false
}: {
  showTest?: boolean;
  showSttTest?: boolean;
  showTtsTest?: boolean;
}) {
  return (
    <ConfigureSectionCard
      id="deepgram"
      title="Speech"
      description="Listen and speak with your customers. Try it below."
      status="complete"
      summary="Ready"
      icon={<Mic className="h-4 w-4" aria-hidden="true" />}
      defaultOpen
    >
      <div className="space-y-4" data-testid="business-deepgram-setup">
        {showTest && showSttTest ? (
          <DeepgramSttTestCard
            testIdPrefix="business-deepgram"
            title="Try transcription"
            description="Tap the microphone and speak. Your words appear live as you talk."
            livePath="/business/setup/deepgram/live"
          />
        ) : null}

        {showTest && showTtsTest ? (
          <DeepgramTtsTestCard
            testIdPrefix="business-deepgram"
            title="Try voice"
            description="Enter a short message and play how it sounds."
            onSpeak={async (input: DeepgramSpeakRequest) => {
              const response = await testBusinessDeepgramSpeak(input);
              return {
                success: response.success,
                data: response.data ?? null,
                error: response.error
              };
            }}
          />
        ) : null}

        {!showTest || (!showSttTest && !showTtsTest) ? (
          <p className="text-sm leading-relaxed text-slate-600" data-testid="business-deepgram-ready-note">
            Speech is included with this agent. No extra setup is needed here.
          </p>
        ) : null}
      </div>
    </ConfigureSectionCard>
  );
}
