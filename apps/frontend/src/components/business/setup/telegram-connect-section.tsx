"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  KeyRound,
  RefreshCw,
  Send,
  Trash2,
  X
} from "lucide-react";
import {
  connectBusinessTelegramManualBot,
  disconnectBusinessTelegram,
  getBusinessTelegramStatus,
  refreshBusinessTelegramHealth,
  sendBusinessTelegramTestMessage,
  startBusinessTelegramOwnerAuthorization,
  type TelegramSetupStatus
} from "@/components/business/features/api";

function TelegramLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 2.6 2.8 9.8c-1.3.5-1.3 1.3-.2 1.6l4.8 1.5 1.8 5.7c.2.7.1.9.8.9.5 0 .8-.2 1.1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.8-.8l3.1-14.9c.3-1.3-.5-1.9-1.7-1.4ZM9.3 12.6l9.3-5.9c.5-.3.9-.1.5.2l-7.7 7-.3 3.2-1.8-4.5Z" />
    </svg>
  );
}

function DisconnectModal({
  isOpen,
  onClose,
  onConfirm,
  busy,
  botUsername
}: {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  busy: boolean;
  botUsername: string | null;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, busy]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      data-testid="business-setup-telegram-disconnect-modal"
    >
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
        onClick={() => { if (!busy) onClose(); }}
        aria-hidden="true"
      />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl border border-slate-100 space-y-4 animate-in zoom-in-95 duration-150">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertCircle className="h-6 w-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Disconnect Telegram Bot?</h3>
              {botUsername ? (
                <p className="text-xs font-semibold text-slate-500">@{botUsername}</p>
              ) : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-50"
            aria-label="Close modal"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          Disconnecting will stop your AI assistant from responding to customer Telegram messages. You can reconnect anytime by re-entering your Bot key.
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            data-testid="business-setup-telegram-disconnect-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn inline-flex items-center gap-1.5 rounded-xl bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
            data-testid="business-setup-telegram-disconnect-confirm"
          >
            {busy ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            {busy ? "Disconnecting…" : "Disconnect Bot"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export interface TelegramConnectSectionProps {
  installedAgentId: string | null;
  businessName: string;
  onConnectedChange: (connected: boolean) => void;
}

export function TelegramConnectSection({
  installedAgentId,
  businessName,
  onConnectedChange
}: TelegramConnectSectionProps) {
  const [status, setStatus] = useState<TelegramSetupStatus | null>(null);
  const [botDisplayName, setBotDisplayName] = useState(
    `${businessName.trim() || "Business"} Assistant`
  );
  const [botToken, setBotToken] = useState("");
  const [rotatingToken, setRotatingToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!installedAgentId) return;
    const response = await getBusinessTelegramStatus(installedAgentId);
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not load Telegram status.");
      return;
    }
    setStatus(response.data);
    const connected =
      response.data.connection?.status === "ACTIVE" &&
      response.data.connection.webhookStatus === "HEALTHY";
    onConnectedChange(connected);
    if (response.data.connection?.botDisplayName) {
      setBotDisplayName(response.data.connection.botDisplayName);
    }
  }, [installedAgentId, onConnectedChange]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Telegram setup failed.");
    } finally {
      setBusy(false);
    }
  }

  async function connectWithToken() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await connectBusinessTelegramManualBot(installedAgentId, {
        botDisplayName,
        botToken
      });
      if (!response.success) throw new Error(response.error ?? "Telegram setup failed.");
      setBotToken("");
      setRotatingToken(false);
      setMessage("Telegram bot connected successfully!");
      await load();
    });
  }

  async function checkHealth() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await refreshBusinessTelegramHealth(installedAgentId);
      if (!response.success || !response.data?.ok) {
        throw new Error(response.error ?? response.data?.lastError ?? "Bot connection check failed. Please check your bot key.");
      }
      setMessage("Bot connection is active and working smoothly.");
      await load();
    });
  }

  async function connectOwner() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await startBusinessTelegramOwnerAuthorization(installedAgentId);
      if (!response.success || !response.data) throw new Error(response.error ?? "Owner connection failed.");
      window.open(response.data.authorizationUrl, "_blank", "noopener,noreferrer");
      setStatus((current) => current?.connection ? {
        ...current,
        connection: { ...current.connection, ownerNotificationStatus: "PENDING" }
      } : current);
      setMessage("Open Telegram and press Start within 15 minutes to complete pairing.");
    });
  }

  async function sendTest() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await sendBusinessTelegramTestMessage(installedAgentId);
      if (!response.success) throw new Error(response.error ?? "Telegram test failed.");
      setMessage("Live Telegram test message sent to your chat.");
      await load();
    });
  }

  async function confirmDisconnect() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await disconnectBusinessTelegram(installedAgentId);
      if (!response.success) throw new Error(response.error ?? "Telegram disconnect failed.");
      setShowDisconnectModal(false);
      setMessage("Telegram bot disconnected.");
      await load();
    });
  }

  const connection = status?.connection ?? null;
  const connected = connection?.status === "ACTIVE" && connection.webhookStatus === "HEALTHY";
  const ownerConnected = connection?.ownerNotificationStatus === "CONNECTED";
  const ownerPending = connection?.ownerNotificationStatus === "PENDING";

  return (
    <div className="mt-6 border-t border-gray-100 pt-6" data-testid="business-setup-telegram">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-[#229ED9]">
            <TelegramLogo />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Telegram Bot Connection</h3>
            <p className="text-xs text-slate-500">
              {connection?.botUsername ? `@${connection.botUsername}` : "Connect your Telegram bot key to let your assistant chat with customers"}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            connected ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60" : "bg-amber-50 text-amber-700 border border-amber-200/60"
          }`}
          data-testid="business-setup-telegram-status"
        >
          {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {!installedAgentId ? (
        <p className="mt-4 text-sm text-amber-700">Install this agent before connecting its Telegram bot.</p>
      ) : (
        <div className="mt-5 space-y-4">
          {/* Bot credentials form / connection card */}
          <div className="rounded-xl border border-slate-200/80 bg-white p-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-xs font-semibold text-slate-700">Bot display name</span>
                <input
                  value={botDisplayName}
                  onChange={(event) => setBotDisplayName(event.target.value)}
                  maxLength={64}
                  placeholder="e.g. My Business Assistant"
                  className="field w-full rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                  data-testid="business-setup-telegram-display-name"
                />
              </label>

              {!connected || rotatingToken ? (
                <label className="relative">
                  <div className="mb-1.5 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-700">
                      {rotatingToken ? "Replacement Bot key" : "Telegram Bot key"}
                    </span>
                    <div className="group relative flex items-center">
                      <button
                        type="button"
                        className="flex items-center gap-1 text-xs font-semibold text-sky-600 hover:text-sky-700 focus:outline-none"
                        aria-label="How to get Telegram bot key"
                      >
                        <HelpCircle className="h-3.5 w-3.5" />
                        <span className="text-xs font-semibold">How to get key?</span>
                      </button>
                      <div className="absolute right-0 top-full z-30 mt-1 hidden w-72 rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-700 shadow-xl animate-in fade-in zoom-in-95 duration-150 group-hover:block group-focus-within:block">
                        <div className="flex items-center gap-1.5 font-bold text-slate-900 mb-2 pb-1.5 border-b border-slate-100">
                          <TelegramLogo className="h-4 w-4 text-[#229ED9]" />
                          <span>How to get your Bot Key</span>
                        </div>
                        <ol className="space-y-2 text-[11px] text-slate-600 list-decimal pl-4">
                          <li>Open your <strong>Telegram app</strong> and search for <strong className="text-sky-600">@BotFather</strong></li>
                          <li>Start chat & send <code className="rounded bg-slate-100 border border-slate-200 px-1 py-0.5 font-mono text-slate-800">/newbot</code> to name your bot</li>
                          <li>Copy the <strong>Bot Token</strong> key provided and paste it into the field below</li>
                        </ol>
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="password"
                      value={botToken}
                      onChange={(event) => setBotToken(event.target.value)}
                      autoComplete="off"
                      placeholder="123456789:AA..."
                      className="field min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3.5 py-2 font-mono text-sm text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none"
                      data-testid="business-setup-telegram-token"
                    />
                    <button
                      type="button"
                      onClick={connectWithToken}
                      disabled={busy || botToken.trim().length < 20 || !botDisplayName.trim()}
                      className="btn inline-flex shrink-0 items-center gap-2 rounded-lg bg-[#229ED9] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1c8ec4] disabled:opacity-50"
                      data-testid="business-setup-telegram-manual"
                    >
                      <KeyRound className="h-4 w-4" />
                      {rotatingToken ? "Replace" : "Connect"}
                    </button>
                  </div>
                </label>
              ) : (
                <div>
                  <span className="mb-1.5 block text-xs font-semibold text-slate-700">Bot Key</span>
                  <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3.5 py-2 text-sm text-slate-600">
                    <span className="font-mono text-xs text-slate-500">••••••••••••••••••••••••</span>
                    <button
                      type="button"
                      onClick={() => setRotatingToken(true)}
                      className="text-xs font-semibold text-sky-600 hover:text-sky-700"
                    >
                      Change key
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Active bot action toolbar */}
            {connected ? (
              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100">
                {connection?.botUrl ? (
                  <a
                    href={connection.botUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="btn inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100"
                  >
                    <TelegramLogo className="h-3.5 w-3.5" /> Open bot
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={checkHealth}
                  disabled={busy}
                  className="btn inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Check status
                </button>
                <button
                  type="button"
                  onClick={() => setShowDisconnectModal(true)}
                  disabled={busy}
                  className="btn inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 ml-auto"
                  data-testid="business-setup-telegram-disconnect-trigger"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Disconnect
                </button>
              </div>
            ) : null}
          </div>

          {/* Business Owner Notifications Pairing Card */}
          {connected ? (
            <div className="rounded-xl border border-sky-100 bg-sky-50/40 p-4" data-testid="business-setup-telegram-owner">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-sky-900">Business Owner Alerts</h4>
                  <p className="mt-0.5 max-w-xl text-xs text-slate-600">
                    {ownerConnected
                      ? "Connected as the business owner. Your private Telegram chat receives instant booking notifications."
                      : ownerPending
                        ? "Waiting for owner connection. Click Start in Telegram before the link expires."
                        : "Pair your personal Telegram account to receive instant private booking alerts."}
                  </p>
                </div>
                {!ownerConnected ? (
                  <div className="flex flex-wrap gap-2">
                    {ownerPending ? (
                      <button
                        type="button"
                        onClick={() => void load()}
                        disabled={busy}
                        className="btn inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        data-testid="business-setup-telegram-owner-refresh"
                      >
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh status
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={connectOwner}
                      disabled={busy}
                      className="btn inline-flex items-center gap-1.5 rounded-lg bg-[#229ED9] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1c8ec4]"
                      data-testid="business-setup-telegram-owner-connect"
                    >
                      <ExternalLink className="h-3.5 w-3.5" /> {ownerPending ? "Generate new link" : "Connect my Telegram"}
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={sendTest}
                    disabled={busy}
                    className="btn inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                    data-testid="business-setup-telegram-test"
                  >
                    <Send className="h-3.5 w-3.5" /> Send live test
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* Disconnect Confirmation Modal */}
      <DisconnectModal
        isOpen={showDisconnectModal}
        onClose={() => setShowDisconnectModal(false)}
        onConfirm={confirmDisconnect}
        busy={busy}
        botUsername={connection?.botUsername ?? null}
      />

      {/* Messages */}
      {message ? <p className="mt-3 text-xs font-semibold text-emerald-700">{message}</p> : null}
      {error ? <p className="mt-3 text-xs font-semibold text-red-600">{error}</p> : null}
      {connection?.lastError && connection.webhookStatus !== "HEALTHY" ? (
        <p className="mt-2 text-xs text-red-600">Connection issue: {connection.lastError}</p>
      ) : null}
    </div>
  );
}
