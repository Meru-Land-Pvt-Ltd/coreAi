"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { BusinessPageHeader } from "@/components/business/business-page-header";
import { FrontDeskNav } from "@/components/business/features/frontdesk/FrontDeskNav";
import {
  EmptyState,
  ErrorState,
  INPUT_CLASS,
  LoadingRows,
  Pill,
  PRIMARY_BUTTON_CLASS,
  SECONDARY_BUTTON_CLASS,
  formatDateTime,
  formatRelativeTime,
  humanizeToken,
  type PillTone
} from "@/components/business/features/frontdesk/ui";

type InboxConversation = {
  id: string;
  channel: string;
  customerPhone: string | null;
  customerId?: string | null;
  aiState: string;
  assignedTeamMemberId: string | null;
  waitingSince: string | null;
  humanSince: string | null;
  slaEscalatedAt?: string | null;
  outcome: string | null;
  sentiment: string | null;
  summary: string | null;
  lastInboundAt: string | null;
  lastOutboundAt?: string | null;
  updatedAt: string;
};

type InboxListResponse = {
  conversations: InboxConversation[];
  waitingCount: number;
};

type InboxMessage = {
  id: string;
  direction: string;
  body: string;
  createdAt: string;
};

type InboxDetailResponse = {
  conversation: InboxConversation & { messages: InboxMessage[] };
};

type FilterKey = "waiting" | "ai" | "human" | "all";

const FILTERS: Array<{ key: FilterKey; label: string; state: string }> = [
  { key: "waiting", label: "Waiting", state: "WAITING_FOR_HUMAN" },
  { key: "ai", label: "AI", state: "AI_ACTIVE" },
  { key: "human", label: "Human", state: "HUMAN_ACTIVE" },
  { key: "all", label: "All", state: "" }
];

function aiStateTone(state: string): PillTone {
  const value = state.toUpperCase();
  if (value === "WAITING_FOR_HUMAN") return "amber";
  if (value === "HUMAN_ACTIVE") return "blue";
  if (value === "AI_ACTIVE") return "green";
  return "slate";
}

export default function BusinessInboxPage() {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [channel, setChannel] = useState("");
  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [waitingCount, setWaitingCount] = useState(0);
  const [listState, setListState] = useState<"loading" | "ready" | "error">("loading");
  const [listError, setListError] = useState("");

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxDetailResponse["conversation"] | null>(null);
  const [detailState, setDetailState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [detailError, setDetailError] = useState("");

  const [replyText, setReplyText] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  const loadList = useCallback(async () => {
    setListState("loading");
    setListError("");
    const state = FILTERS.find((f) => f.key === filter)?.state ?? "";
    const params = new URLSearchParams();
    if (state) params.set("state", state);
    if (channel) params.set("channel", channel);
    const query = params.toString();
    const result = await apiGet<InboxListResponse>(`/business/inbox${query ? `?${query}` : ""}`);
    if (result.success && result.data) {
      setConversations(result.data.conversations ?? []);
      setWaitingCount(result.data.waitingCount ?? 0);
      setListState("ready");
    } else {
      setListError(result.error ?? "Could not load the inbox.");
      setListState("error");
    }
  }, [filter, channel]);

  const loadDetail = useCallback(async (conversationId: string) => {
    setDetailState("loading");
    setDetailError("");
    const result = await apiGet<InboxDetailResponse>(`/business/inbox/${conversationId}`);
    if (result.success && result.data?.conversation) {
      setDetail(result.data.conversation);
      setDetailState("ready");
    } else {
      setDetailError(result.error ?? "Could not load the conversation.");
      setDetailState("error");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (selectedId) void loadDetail(selectedId);
  }, [selectedId, loadDetail]);

  const channelOptions = useMemo(() => {
    const set = new Set(conversations.map((c) => c.channel).filter(Boolean));
    if (channel) set.add(channel);
    return [...set].sort();
  }, [conversations, channel]);

  async function runAction(action: "claim" | "release" | "close") {
    if (!selectedId) return;
    setActionBusy(action);
    setActionError("");
    const result = await apiPost<{ conversation: InboxConversation }>(
      `/business/inbox/${selectedId}/${action}`,
      {}
    );
    setActionBusy(null);
    if (!result.success) {
      setActionError(result.error ?? `Could not ${action} the conversation.`);
      return;
    }
    await Promise.all([loadDetail(selectedId), loadList()]);
  }

  async function sendReply() {
    if (!selectedId || !replyText.trim()) return;
    setActionBusy("reply");
    setActionError("");
    const result = await apiPost<unknown>(`/business/inbox/${selectedId}/reply`, { body: replyText.trim() });
    setActionBusy(null);
    if (!result.success) {
      setActionError(result.error ?? "Could not send the reply.");
      return;
    }
    setReplyText("");
    await loadDetail(selectedId);
  }

  const isHumanActive = (detail?.aiState ?? "").toUpperCase() === "HUMAN_ACTIVE";

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5" data-testid="inbox-page">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-4 sm:-mx-4 sm:-mt-4 sm:mb-6 lg:-mx-5 lg:-mt-5"
        title="Inbox"
        description="Every AI and human conversation across your channels, in one place."
        actions={(
          <button type="button" onClick={() => void loadList()} className={SECONDARY_BUTTON_CLASS} data-testid="inbox-refresh-button">
            Refresh
          </button>
        )}
      />

      <FrontDeskNav />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-xl bg-gray-50 p-1" role="tablist" aria-label="Conversation state">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={filter === item.key}
              onClick={() => setFilter(item.key)}
              data-testid={`inbox-filter-${item.key}`}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-colors ${
                filter === item.key
                  ? "bg-amber-50 font-semibold text-amber-700"
                  : "font-medium text-slate-500 hover:text-slate-700"
              }`}
            >
              {item.label}
              {item.key === "waiting" && waitingCount > 0 ? (
                <span
                  className="inline-flex min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-white"
                  data-testid="inbox-waiting-badge"
                >
                  {waitingCount}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        <select
          value={channel}
          onChange={(event) => setChannel(event.target.value)}
          className="rounded-xl border border-gray-200 bg-white px-3 py-1.5 text-sm text-slate-600 focus:border-amber-400 focus:outline-none"
          data-testid="inbox-channel-select"
          aria-label="Channel"
        >
          <option value="">All channels</option>
          {channelOptions.map((option) => (
            <option key={option} value={option}>
              {humanizeToken(option)}
            </option>
          ))}
        </select>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-5">
        {/* Conversation list */}
        <section className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm lg:col-span-2">
          {listState === "loading" ? (
            <LoadingRows rows={4} testId="inbox-list-loading" />
          ) : listState === "error" ? (
            <ErrorState message={listError} onRetry={() => void loadList()} testId="inbox-list-error" />
          ) : conversations.length === 0 ? (
            <EmptyState
              title="No conversations"
              hint="When customers call or text your number, conversations appear here."
              testId="inbox-list-empty"
            />
          ) : (
            <div className="max-h-[70vh] divide-y divide-gray-50 overflow-y-auto" data-testid="inbox-list">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => setSelectedId(conversation.id)}
                  data-testid={`inbox-item-${conversation.id}`}
                  className={`block w-full px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                    selectedId === conversation.id ? "bg-amber-50/50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {conversation.customerPhone || "Unknown caller"}
                    </p>
                    <Pill tone={aiStateTone(conversation.aiState)} testId={`inbox-item-state-${conversation.id}`}>
                      {humanizeToken(conversation.aiState)}
                    </Pill>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-slate-500">
                    {humanizeToken(conversation.channel)}
                    {conversation.summary ? ` · ${conversation.summary}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {formatRelativeTime(conversation.lastInboundAt ?? conversation.updatedAt)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Thread view */}
        <section className="flex min-h-[50vh] flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm lg:col-span-3" data-testid="inbox-thread">
          {!selectedId ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center">
              <p className="text-sm font-medium text-slate-400" data-testid="inbox-thread-empty">
                Select a conversation to view the thread.
              </p>
            </div>
          ) : detailState === "loading" ? (
            <LoadingRows rows={3} testId="inbox-thread-loading" />
          ) : detailState === "error" ? (
            <ErrorState message={detailError} onRetry={() => selectedId && void loadDetail(selectedId)} testId="inbox-thread-error" />
          ) : detail ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900" data-testid="inbox-thread-customer">
                    {detail.customerPhone || "Unknown caller"}
                  </p>
                  <p className="text-xs text-slate-400">
                    {humanizeToken(detail.channel)}
                    {detail.waitingSince ? ` · waiting since ${formatDateTime(detail.waitingSince)}` : ""}
                    {detail.humanSince ? ` · human since ${formatDateTime(detail.humanSince)}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={aiStateTone(detail.aiState)} testId="inbox-thread-state">
                    {humanizeToken(detail.aiState)}
                  </Pill>
                  {detail.sentiment ? <Pill tone="slate">{humanizeToken(detail.sentiment)}</Pill> : null}
                  {!isHumanActive && (detail.aiState ?? "").toUpperCase() !== "CLOSED" ? (
                    <button
                      type="button"
                      onClick={() => void runAction("claim")}
                      disabled={actionBusy !== null}
                      className={PRIMARY_BUTTON_CLASS}
                      data-testid="inbox-claim-button"
                    >
                      {actionBusy === "claim" ? "Claiming…" : "Claim"}
                    </button>
                  ) : null}
                  {isHumanActive ? (
                    <button
                      type="button"
                      onClick={() => void runAction("release")}
                      disabled={actionBusy !== null}
                      className={SECONDARY_BUTTON_CLASS}
                      data-testid="inbox-release-button"
                    >
                      {actionBusy === "release" ? "Releasing…" : "Release to AI"}
                    </button>
                  ) : null}
                  {(detail.aiState ?? "").toUpperCase() !== "CLOSED" ? (
                    <button
                      type="button"
                      onClick={() => void runAction("close")}
                      disabled={actionBusy !== null}
                      className={SECONDARY_BUTTON_CLASS}
                      data-testid="inbox-close-button"
                    >
                      {actionBusy === "close" ? "Closing…" : "Close"}
                    </button>
                  ) : null}
                </div>
              </div>

              {detail.summary ? (
                <div className="border-b border-gray-100 bg-gray-50/60 px-4 py-2 sm:px-5">
                  <p className="text-xs text-slate-500" data-testid="inbox-thread-summary">
                    {detail.summary}
                  </p>
                </div>
              ) : null}

              <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4 sm:px-5" data-testid="inbox-thread-messages">
                {detail.messages.length === 0 ? (
                  <p className="text-center text-sm text-slate-400">No messages yet.</p>
                ) : (
                  detail.messages.map((message) => {
                    const inbound = message.direction.toUpperCase() === "INBOUND";
                    return (
                      <div key={message.id} className={`flex ${inbound ? "justify-start" : "justify-end"}`}>
                        <div
                          className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${
                            inbound
                              ? "rounded-bl-sm bg-gray-100 text-slate-700"
                              : "rounded-br-sm bg-amber-500 text-white"
                          }`}
                          data-testid={`inbox-message-${message.id}`}
                        >
                          <p className="whitespace-pre-wrap break-words">{message.body}</p>
                          <p className={`mt-1 text-[10px] ${inbound ? "text-slate-400" : "text-amber-100"}`}>
                            {formatDateTime(message.createdAt)}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {actionError ? (
                <p className="px-4 pb-2 text-sm font-semibold text-red-600 sm:px-5" data-testid="inbox-action-error">
                  {actionError}
                </p>
              ) : null}

              {isHumanActive ? (
                <div className="flex items-end gap-2 border-t border-gray-100 px-4 py-3 sm:px-5">
                  <textarea
                    value={replyText}
                    onChange={(event) => setReplyText(event.target.value)}
                    rows={2}
                    placeholder="Type your reply…"
                    className={`${INPUT_CLASS} resize-none`}
                    data-testid="inbox-reply-input"
                  />
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={actionBusy !== null || !replyText.trim()}
                    className={PRIMARY_BUTTON_CLASS}
                    data-testid="inbox-reply-button"
                  >
                    {actionBusy === "reply" ? "Sending…" : "Send"}
                  </button>
                </div>
              ) : (
                <div className="border-t border-gray-100 px-4 py-3 text-center sm:px-5">
                  <p className="text-xs text-slate-400" data-testid="inbox-reply-locked">
                    Claim the conversation to reply as a human.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
