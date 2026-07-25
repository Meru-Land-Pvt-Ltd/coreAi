import { COMPLIANCE_CHECK_DEFS, type AgentConfigureCompliance, type ComplianceCheckKey } from "@coreai/shared";

const DATA_HANDLING_QUESTIONS: {
  key: keyof Pick<
    AgentConfigureCompliance,
    "processesPersonalData" | "storesConversationHistory" | "connectsThirdPartyServices"
  >;
  question: string;
  testId: string;
}[] = [
  {
    key: "processesPersonalData",
    question: "Does this agent process personal data?",
    testId: "configure-data-personal"
  },
  {
    key: "storesConversationHistory",
    question: "Does this agent store conversation history?",
    testId: "configure-data-history"
  },
  {
    key: "connectsThirdPartyServices",
    question: "Does this agent connect to third-party services?",
    testId: "configure-data-thirdparty"
  }
];

export function ComplianceChecklist({
  compliance,
  onChange,
  disabled = false
}: {
  compliance: AgentConfigureCompliance;
  onChange: (next: Partial<AgentConfigureCompliance>) => void;
  disabled?: boolean;
}) {
  const toggleCheck = (key: ComplianceCheckKey) => {
    onChange({
      complianceChecks: {
        ...compliance.complianceChecks,
        [key]: !compliance.complianceChecks[key]
      }
    });
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="mb-1 block text-[13.5px] font-semibold text-slate-700">Data handling</p>
        <p className="mb-3 text-[12.5px] text-slate-400">Honest answers here speed up review and build buyer trust.</p>
        <div className="space-y-2.5">
          {DATA_HANDLING_QUESTIONS.map((item) => {
            const value = compliance[item.key];

            return (
              <div
                key={item.key}
                className="flex items-center justify-between gap-4 rounded-2xl border border-gray-100 bg-gray-50/40 p-4"
              >
                <p className="text-[13.5px] font-medium text-slate-700">{item.question}</p>
                <div className="inline-flex flex-none rounded-xl bg-gray-100 p-1" role="radiogroup" aria-label={item.question}>
                  <button
                    type="button"
                    data-testid={`${item.testId}-yes`}
                    aria-pressed={value}
                    disabled={disabled}
                    onClick={() => onChange({ [item.key]: true } as Partial<AgentConfigureCompliance>)}
                    className="seg-btn rounded-lg px-4 py-1.5 text-[13px] font-medium text-slate-500 disabled:opacity-60"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    data-testid={`${item.testId}-no`}
                    aria-pressed={!value}
                    disabled={disabled}
                    onClick={() => onChange({ [item.key]: false } as Partial<AgentConfigureCompliance>)}
                    className="seg-btn rounded-lg px-4 py-1.5 text-[13px] font-medium text-slate-500 disabled:opacity-60"
                  >
                    No
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="mb-1 block text-[13.5px] font-semibold text-slate-700">Before you publish</p>
        <p className="mb-3 text-[12.5px] text-slate-400">All four are required to submit.</p>
        <div className="space-y-2.5">
          {COMPLIANCE_CHECK_DEFS.map((check) => {
            const checked = compliance.complianceChecks[check.key];

            return (
              <button
                key={check.key}
                type="button"
                data-testid={`configure-compliance-check-${check.key}`}
                role="checkbox"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => toggleCheck(check.key)}
                className="flex w-full items-center gap-3.5 rounded-2xl border border-gray-100 bg-gray-50/40 p-4 text-left transition hover:border-gray-200 disabled:opacity-60"
              >
                <span
                  className="ck flex h-5 w-5 flex-none items-center justify-center rounded-md border-2 border-gray-300 bg-white"
                  aria-checked={checked}
                >
                  <svg className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <span className="text-[13.5px] font-medium text-slate-700">{check.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
