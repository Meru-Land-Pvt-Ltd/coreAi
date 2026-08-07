"use client";

import { TelegramConnectSection, type TelegramConnectSectionProps } from "./telegram-connect-section";
import { TelegramConfigSection, type TelegramConfigSectionProps } from "./telegram-config-section";

export { TelegramConnectSection, TelegramConfigSection };
export type { TelegramConnectSectionProps, TelegramConfigSectionProps };

export function TelegramSetupSection({
  installedAgentId,
  businessName,
  onConnectedChange
}: {
  installedAgentId: string | null;
  businessName: string;
  onConnectedChange: (connected: boolean) => void;
}) {
  return (
    <div className="space-y-6">
      <TelegramConnectSection
        installedAgentId={installedAgentId}
        businessName={businessName}
        onConnectedChange={onConnectedChange}
      />
      <TelegramConfigSection
        installedAgentId={installedAgentId}
        businessName={businessName}
      />
    </div>
  );
}
