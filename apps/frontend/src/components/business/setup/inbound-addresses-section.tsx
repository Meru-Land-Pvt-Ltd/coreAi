"use client";

/**
 * THE ADDRESS THE BUSINESS MUST PASTE SOMEWHERE.
 *
 * An agent that starts at a webhook is given its own private link when it
 * goes live. Until today that link was minted, stored, and shown to nobody —
 * so the single action the business had to take was invisible, and the whole
 * inbound half of their agent quietly did nothing.
 *
 * It appears only when there is one: a business whose agent has no inbound
 * address sees nothing at all rather than an empty box explaining an absence.
 */

import { useEffect, useState } from "react";
import { getInboundAddresses } from "@/components/business/features/api";

type Address = {
  nodeId: string;
  label: string;
  kind: "webhook" | "connector";
  provider: string | null;
  instructions: string;
  url: string;
  secretHeader: string | null;
  secret: string;
  installedAgentId: string;
  agentName: string;
};

function CopyRow({ value, testId }: { value: string; testId: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-1 flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-700">
        {value}
      </code>
      <button
        type="button"
        data-testid={testId}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="shrink-0 rounded-lg border border-gray-200 px-3 py-2 text-[12px] font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function InboundAddressesSection({ installedAgentId }: { installedAgentId?: string | null }) {
  const [addresses, setAddresses] = useState<Address[] | null>(null);

  useEffect(() => {
    let alive = true;
    void getInboundAddresses({ installedAgentId }).then((response) => {
      if (!alive) return;
      if (response.success && response.data) setAddresses(response.data.addresses as Address[]);
      else setAddresses([]);
    });
    return () => {
      alive = false;
    };
  }, [installedAgentId]);

  if (!addresses || addresses.length === 0) return null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4" data-testid="inbound-addresses-section">
      <p className="text-sm font-semibold text-slate-900">Your agent&apos;s private address</p>
      <p className="mt-1 text-[12px] leading-5 text-slate-500">
        Paste this into the other app once. Everything it sends will wake your agent. Keep it
        private — anyone who has it can start your agent.
      </p>

      {addresses.map((address) => (
        <div key={`${address.installedAgentId}-${address.nodeId}`} className="mt-4">
          <p className="text-[12px] font-semibold text-slate-700">
            {address.label}
            {address.provider ? ` · ${address.provider}` : ""}
          </p>
          <p className="mt-0.5 text-[11px] leading-4 text-slate-500">{address.instructions}</p>
          <CopyRow value={address.url} testId={`inbound-address-copy-${address.nodeId}`} />

          {address.secret ? (
            <>
              <p className="mt-3 text-[11px] font-semibold text-slate-600">
                {address.secretHeader
                  ? `Secret (paste as the "${address.secretHeader}" header)`
                  : "Secret — some apps ask for this too"}
              </p>
              <CopyRow value={address.secret} testId={`inbound-secret-copy-${address.nodeId}`} />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}
