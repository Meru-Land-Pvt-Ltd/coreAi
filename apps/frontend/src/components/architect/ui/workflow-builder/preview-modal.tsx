"use client";

import { useEffect, useState } from "react";
import { getWorkflowConfigure } from "@/components/architect/features/api";
import { BuilderIcon } from "./icons";

type PreviewMessage = {
  mine?: boolean;
  text: string;
};

function getInitials(name: string) {
  const initials = name
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
  return initials || "AI";
}

function resolveTemplate(text: string, vars: { assistantName: string; businessName: string }) {
  return text
    .replace(/\{\{\s*assistantName\s*\}\}/gi, vars.assistantName || "our assistant")
    .replace(/\{\{\s*business[_]?name\s*\}\}/gi, vars.businessName)
    .replace(/\{\{\s*business\.name\s*\}\}/gi, vars.businessName)
    .replace(/\{\{\s*contact\.name\s*\}\}/gi, "there")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const EMPTY_INDUSTRY_TAGS: string[] = [];
const EMPTY_BOOKING_SLOTS: string[] = [];

function buildPreviewConversation(input: {
  greeting: string;
  smsBody: string;
  assistantName: string;
  businessName: string;
  agentPurpose: string;
  canBook: boolean;
  bookingSlots: string[];
  industry: string;
}): PreviewMessage[] {
  const {
    greeting,
    smsBody,
    assistantName,
    businessName,
    agentPurpose,
    canBook,
    bookingSlots,
    industry
  } = input;

  const agentLabel = assistantName.trim() || businessName.trim() || "our assistant";

  const opening =
    greeting.trim() ||
    smsBody.trim() ||
    (assistantName.trim()
      ? `Hi! This is ${assistantName.trim()} from ${businessName}. How can I help you today?`
      : `Hi! Thanks for reaching out to ${businessName}. How can I help you today?`);

  const messages: PreviewMessage[] = [{ text: opening }];

  const industryKey = industry.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
  let userAsk = canBook
    ? "Hi! Can I book an appointment?"
    : "Hi! Can you tell me more about your services?";

  if (industryKey === "dental") userAsk = "Do you have openings this week for a cleaning?";
  else if (industryKey === "restaurant") userAsk = "Can I book a table for 4 tonight around 7?";
  else if (industryKey.includes("real") || industryKey === "realestate") {
    userAsk = "Can I schedule a property viewing this weekend?";
  } else if (industryKey === "legal" || industryKey.includes("law")) {
    userAsk = "I'd like a consult — do you have availability this week?";
  }

  messages.push({ mine: true, text: userAsk });

  if (canBook) {
    if (bookingSlots.length > 0) {
      messages.push({
        text: "Of course! Here are our next openings — tap one to confirm:"
      });
    } else {
      messages.push({
        text: `Of course! I can help book that for ${businessName}. Which day works best for you?`
      });
    }
  } else if (smsBody.trim() && smsBody.trim() !== opening) {
    messages.push({ text: smsBody.trim() });
  } else if (agentPurpose.trim()) {
    messages.push({ text: `Happy to help! ${agentPurpose.trim()}` });
  } else {
    messages.push({
      text: `Happy to help! ${agentLabel} is here for whatever you need — ask me anything.`
    });
  }

  return messages;
}

export function PreviewModal({
  open,
  onClose,
  workflowId = null,
  businessName = "Your business",
  assistantName = "",
  greeting = "",
  smsBody = "",
  agentPurpose = "",
  industryTags = EMPTY_INDUSTRY_TAGS,
  iconUrl = null,
  canBook = false,
  canText = false,
  bookingSlots = EMPTY_BOOKING_SLOTS
}: {
  open: boolean;
  onClose: () => void;
  workflowId?: string | null;
  businessName?: string;
  /** Assistant name from the workflow's voice node. */
  assistantName?: string;
  /** First message from the workflow's voice node (template tokens resolved). */
  greeting?: string;
  /** SMS body from a Send SMS node when present. */
  smsBody?: string;
  /** Listing tagline/short description — shapes the sample answer. */
  agentPurpose?: string;
  industryTags?: string[];
  iconUrl?: string | null;
  /** Whether the workflow actually has a booking node. */
  canBook?: boolean;
  /** Whether the workflow actually has an SMS node/trigger. */
  canText?: boolean;
  /** Real availability slots from the latest calendar test run, when present. */
  bookingSlots?: string[];
}) {
  const [resolvedIconUrl, setResolvedIconUrl] = useState<string | null>(iconUrl?.trim() || null);
  const [resolvedIndustries, setResolvedIndustries] = useState<string[]>(industryTags);
  const [resolvedPurpose, setResolvedPurpose] = useState(agentPurpose);
  const [resolvedDisplayName, setResolvedDisplayName] = useState(businessName);

  useEffect(() => {
    if (!open) return;

    setResolvedIconUrl(iconUrl?.trim() || null);
    setResolvedIndustries(industryTags);
    setResolvedPurpose(agentPurpose);
    setResolvedDisplayName(businessName.trim() || "Your business");
  }, [open, iconUrl, industryTags, agentPurpose, businessName]);

  useEffect(() => {
    if (!open || !workflowId) return;

    let cancelled = false;

    void (async () => {
      const result = await getWorkflowConfigure(workflowId);
      if (cancelled || !result.success || !result.data?.configure) return;

      const basics = result.data.configure.basics;
      const fetchedIcon = basics.iconUrl?.trim() || null;
      const fetchedIndustries = (basics.industryTags ?? []).map((tag) => tag.trim()).filter(Boolean);
      const fetchedName = basics.agentName?.trim() || "";
      const fetchedPurpose = basics.tagline?.trim() || basics.shortDescription?.trim() || "";

      if (!cancelled) {
        if (fetchedIcon) {
          setResolvedIconUrl((current) => current || fetchedIcon);
        }
        if (fetchedIndustries.length > 0) {
          setResolvedIndustries((current) => (current.length > 0 ? current : fetchedIndustries));
        }
        if (fetchedPurpose) {
          setResolvedPurpose((current) => current.trim() || fetchedPurpose);
        }
        if (fetchedName) {
          setResolvedDisplayName((current) =>
            !current.trim() || current === "Your business" ? fetchedName : current
          );
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, workflowId]);

  if (!open) return null;

  const displayName = resolvedDisplayName.trim() || "Your business";
  const initials = getInitials(displayName);
  const templateVars = {
    assistantName: assistantName.trim(),
    businessName: displayName
  };
  const resolvedGreeting = resolveTemplate(greeting, templateVars);
  const resolvedSmsBody = resolveTemplate(smsBody, templateVars);
  const industry = resolvedIndustries[0] ?? "";

  const conversation = buildPreviewConversation({
    greeting: resolvedGreeting,
    smsBody: resolvedSmsBody,
    assistantName: assistantName.trim(),
    businessName: displayName,
    agentPurpose: resolvedPurpose.trim(),
    canBook,
    bookingSlots,
    industry
  });

  const channelLabel = canText
    ? "SMS · Text Message"
    : canBook
      ? "AI Receptionist · Booking"
      : "AI Receptionist";

  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-900/45 backdrop-blur-[5px]"
      role="dialog"
      aria-modal="true"
      aria-label="End-user preview"
      style={{ animation: "fadeIn .2s ease" }}
    >
      <button
        type="button"
        data-testid="preview-modal-backdrop"
        className="absolute inset-0"
        aria-label="Close preview"
        onClick={onClose}
      />
      <div className="workflow-modal-card relative z-10 flex flex-col items-center">
        <button
          type="button"
          onClick={onClose}
          data-testid="preview-modal-close"
          className="absolute -right-2 -top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-gray-100 bg-white text-slate-500 transition hover:text-slate-800 md:-right-12 md:top-0"
          aria-label="Close preview"
        >
          <BuilderIcon name="x" className="h-4 w-4" />
        </button>
        <p
          className="mb-4 text-sm font-medium text-white/80"
          data-testid="architect-ui-workflow-builder-preview-modal-what-the-patient-sees-on-their-phone-text"
        >
          What the customer sees on their phone
        </p>
        <div className="phone-shell h-[600px] w-[300px] rounded-[44px] border-2 border-amber-500 bg-black p-2.5">
          <div className="relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-[36px] bg-white">
            <div className="absolute left-1/2 top-0 z-20 h-6 w-32 -translate-x-1/2 rounded-b-2xl bg-black" />
            <div className="z-10 flex shrink-0 items-center justify-between px-6 pb-1 pt-3 text-[11px] font-semibold text-slate-900">
              <span data-testid="architect-ui-workflow-builder-preview-modal-9-41-text">9:41</span>
              <span className="flex items-center gap-1">
                <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="currentColor">
                  <path d="M2 17h2v4H2zM6 13h2v8H6zM10 9h2v12h-2zM14 5h2v16h-2zM18 3h2v18h-2z" opacity=".9" />
                </svg>
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <path d="M12 4C7 4 2.7 6.1 0 9.4L12 24 24 9.4C21.3 6.1 17 4 12 4z" opacity=".9" />
                </svg>
              </span>
            </div>
            <div className="shrink-0 border-b border-gray-100 bg-gray-50/60 px-4 py-3 text-center">
              <div
                className="mx-auto flex h-11 w-11 items-center justify-center overflow-hidden rounded-full bg-amber-100 text-sm font-bold text-amber-700"
                data-testid="preview-modal-avatar"
              >
                {resolvedIconUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element -- listing icons may be data URLs
                  <img src={resolvedIconUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  initials
                )}
              </div>
              <p
                className="mt-1.5 text-sm font-semibold text-slate-900"
                data-testid="architect-ui-workflow-builder-preview-modal-business-text"
              >
                {displayName}
              </p>
              <p
                className="text-[11px] text-slate-400"
                data-testid="architect-ui-workflow-builder-preview-modal-sms-message-text"
              >
                {channelLabel}
              </p>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain bg-white px-4 py-5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <p
                className="text-center text-[10px] uppercase tracking-wider text-slate-400"
                data-testid="architect-ui-workflow-builder-preview-modal-today-2-14-pm-text"
              >
                Today 2:14 PM
              </p>
              {conversation.map((message, index) => {
                if (message.mine) {
                  return (
                    <div key={`user-${index}`} className="flex justify-end">
                      <div
                        className="max-w-[70%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-green-500 px-3.5 py-2.5 text-[13px] leading-relaxed text-white"
                        data-testid={index === 1 ? "preview-modal-user-message" : `preview-modal-user-message-${index}`}
                      >
                        {message.text}
                      </div>
                    </div>
                  );
                }

                return (
                  <div key={`bot-${index}`} className="flex">
                    <div
                      className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-gray-100 px-3.5 py-2.5 text-[13px] leading-relaxed text-slate-800"
                      data-testid={
                        index === 0
                          ? "preview-modal-greeting"
                          : index === 2
                            ? "preview-modal-reply"
                            : `preview-modal-bot-message-${index}`
                      }
                    >
                      {message.text}
                      {canBook &&
                      bookingSlots.length > 0 &&
                      index === conversation.length - 1
                        ? bookingSlots.map((slot, slotIndex) => (
                            <span
                              key={`${slot}-${slotIndex}`}
                              className={`${slotIndex === 0 ? "mt-2" : "mt-1.5"} block rounded-lg border border-amber-100 bg-white px-3 py-1.5 font-medium text-amber-600`}
                              data-testid={
                                slotIndex === 0
                                  ? "architect-ui-workflow-builder-preview-modal-tomorrow-10-30-am-text"
                                  : slotIndex === 1
                                    ? "architect-ui-workflow-builder-preview-modal-tomorrow-3-00-pm-text"
                                    : `preview-modal-booking-slot-${slotIndex}`
                              }
                            >
                              {slot}
                            </span>
                          ))
                        : null}
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="flex shrink-0 items-center gap-2 border-t border-gray-100 bg-gray-50/60 px-3 py-2.5">
              <div className="flex-1 rounded-full border border-gray-200 bg-white px-3.5 py-2 text-[13px] text-slate-400">
                Text Message
              </div>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-500 text-white">
                <BuilderIcon name="send" className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
