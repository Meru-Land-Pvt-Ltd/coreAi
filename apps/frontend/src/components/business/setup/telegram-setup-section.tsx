"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  RefreshCw,
  Send,
  Trash2
} from "lucide-react";
import {
  connectBusinessTelegramManualBot,
  disconnectBusinessTelegram,
  getBusinessTelegramStatus,
  refreshBusinessTelegramHealth,
  sendBusinessTelegramTestMessage,
  startBusinessTelegramManagedSetup,
  startBusinessTelegramOwnerAuthorization,
  type TelegramSetupStatus
} from "@/components/business/features/api";

export function TelegramSetupSection({
  installedAgentId,
  businessName,
  onConnectedChange
}: {
  installedAgentId: string | null;
  businessName: string;
  onConnectedChange: (connected: boolean) => void;
}) {
  const [status, setStatus] = useState<TelegramSetupStatus | null>(null);
  const [mode, setMode] = useState<"managed" | "manual">("managed");
  /* Once the buyer picks a tab themselves we stop auto-selecting, so the
     availability check can never yank them off the tab they chose. */
  const [modeChosen, setModeChosen] = useState(false);
  // The agent is not necessarily a booking agent — name it after the business.
  const [botDisplayName, setBotDisplayName] = useState(
    `${businessName.trim() || "Business"} Assistant`
  );
  const [botToken, setBotToken] = useState("");
  const [rotatingToken, setRotatingToken] = useState(false);
  const [busy, setBusy] = useState(false);
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
    /* Managed provisioning needs Bot Management Mode on the platform manager
       bot plus a registered manager webhook. When either is missing, landing the
       buyer on a tab whose only button is disabled reads as "Telegram is
       broken" — start them on the BotFather flow, which always works. */
    if (!modeChosen && !response.data.managedProvisioningAvailable) {
      setMode("manual");
    }
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

  async function startManaged() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await startBusinessTelegramManagedSetup(installedAgentId, { botDisplayName });
      if (!response.success || !response.data) throw new Error(response.error ?? "Managed setup failed.");
      if (response.data.approvalUrl) window.open(response.data.approvalUrl, "_blank", "noopener,noreferrer");
      setMessage(
        response.data.approvalUrl
          ? "Telegram approval opened. Approve the bot, then refresh status."
          : "Telegram bot is connected."
      );
      await load();
    });
  }

  async function connectManual() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await connectBusinessTelegramManualBot(installedAgentId, {
        botDisplayName,
        botToken
      });
      if (!response.success) throw new Error(response.error ?? "Manual Telegram setup failed.");
      setBotToken("");
      setRotatingToken(false);
      setMessage("Telegram bot connected and webhook verified.");
      await load();
    });
  }

  async function checkHealth() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await refreshBusinessTelegramHealth(installedAgentId);
      if (!response.success || !response.data?.ok) {
        throw new Error(response.error ?? response.data?.lastError ?? "Telegram webhook is not healthy.");
      }
      setMessage("Bot identity and webhook are healthy.");
      await load();
    });
  }

  async function connectOwner() {
    if (!installedAgentId) return;
    await run(async () => {
      const response = await startBusinessTelegramOwnerAuthorization(installedAgentId);
      if (!response.success || !response.data) throw new Error(response.error ?? "Owner authorization failed.");
      window.open(response.data.authorizationUrl, "_blank", "noopener,noreferrer");
      setMessage("Open Telegram, press Start, then refresh status.");
      await load();
    });
  }

  async function sendTest() {
    if (!installedAgentId) return;
    const confirmed = window.confirm("This sends a real Telegram message to the connected owner chat. Continue?");
    if (!confirmed) return;
    await run(async () => {
      const response = await sendBusinessTelegramTestMessage(installedAgentId);
      if (!response.success) throw new Error(response.error ?? "Telegram test failed.");
      setMessage("Live Telegram test message sent.");
      await load();
    });
  }

  async function disconnect() {
    if (!installedAgentId) return;
    const confirmed = window.confirm("Disconnect this bot and remove its webhook?");
    if (!confirmed) return;
    await run(async () => {
      const response = await disconnectBusinessTelegram(installedAgentId);
      if (!response.success) throw new Error(response.error ?? "Telegram disconnect failed.");
      setMessage("Telegram bot disconnected.");
      await load();
    });
  }

  const connection = status?.connection ?? null;
  const connected = connection?.status === "ACTIVE" && connection.webhookStatus === "HEALTHY";
  const ownerConnected = connection?.ownerNotificationStatus === "CONNECTED";

  return (
    <div className="mt-6 border-t border-gray-100 pt-6" data-testid="business-setup-telegram">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
            <Send className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Telegram bot</h3>
            <p className="text-xs text-slate-500">
              {connection?.botUsername ? `@${connection.botUsername}` : "One dedicated bot for this installed agent"}
            </p>
          </div>
        </div>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
            connected ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
          }`}
          data-testid="business-setup-telegram-status"
        >
          {connected ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
          {connected ? "Connected" : connection?.provisioningStatus?.replaceAll("_", " ") || "Not connected"}
        </span>
      </div>

      {!installedAgentId ? (
        <p className="mt-4 text-sm text-amber-700">Install this agent before connecting its Telegram bot.</p>
      ) : (
        <>
          <div className="mt-5">
            <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="telegram-display-name">
              Bot display name
            </label>
            <input
              id="telegram-display-name"
              value={botDisplayName}
              onChange={(event) => setBotDisplayName(event.target.value)}
              maxLength={64}
              className="field w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900"
              data-testid="business-setup-telegram-display-name"
            />
            {connection?.requestedUsername ? (
              <p className="mt-1.5 text-xs text-slate-500">
                Proposed username: <span className="font-mono">@{connection.requestedUsername}</span>
              </p>
            ) : null}
          </div>

          {!connected ? (
            <div className="mt-5">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1" role="tablist">
                <button
                  type="button"
                  onClick={() => {
                    setModeChosen(true);
                    setMode("managed");
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    mode === "managed" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  Managed setup
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setModeChosen(true);
                    setMode("manual");
                  }}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
                    mode === "manual" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  BotFather token
                </button>
              </div>

              {mode === "managed" ? (
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={startManaged}
                    disabled={busy || !status?.managedProvisioningAvailable || botDisplayName.trim().length === 0}
                    className="btn inline-flex items-center gap-2 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                    data-testid="business-setup-telegram-managed"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Approve in Telegram
                  </button>
                  {!status?.managedProvisioningAvailable ? (
                    <p className="mt-2 text-xs text-amber-700">
                      {status?.managedProvisioningReason ??
                        "Managed setup is unavailable on this deployment."}{" "}
                      Use the BotFather token option.
                    </p>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4">
                  <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="telegram-token">
                    BotFather token
                  </label>
                  <div className="flex gap-2">
                    <input
                      id="telegram-token"
                      type="password"
                      value={botToken}
                      onChange={(event) => setBotToken(event.target.value)}
                      autoComplete="off"
                      placeholder="123456789:AA..."
                      className="field min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-mono text-sm text-slate-900"
                      data-testid="business-setup-telegram-token"
                    />
                    <button
                      type="button"
                      onClick={connectManual}
                      disabled={busy || botToken.trim().length < 20 || botDisplayName.trim().length === 0}
                      className="btn inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                      data-testid="business-setup-telegram-manual"
                    >
                      <KeyRound className="h-4 w-4" />
                      Connect
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="mt-5 flex flex-wrap gap-2">
              {connection?.botUrl ? (
                <a
                  href={connection.botUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open bot
                </a>
              ) : null}
              <button
                type="button"
                onClick={checkHealth}
                disabled={busy}
                title="Refresh bot and webhook health"
                className="btn inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
                Check health
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode("manual");
                  setRotatingToken(true);
                }}
                className="btn inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Rotate token
              </button>
            </div>
          )}

          {connected && rotatingToken ? (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-semibold text-slate-700" htmlFor="telegram-rotated-token">
                Replacement BotFather token
              </label>
              <div className="flex gap-2">
                <input
                  id="telegram-rotated-token"
                  type="password"
                  value={botToken}
                  onChange={(event) => setBotToken(event.target.value)}
                  autoComplete="off"
                  className="field min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-4 py-2.5 font-mono text-sm text-slate-900"
                />
                <button
                  type="button"
                  onClick={connectManual}
                  disabled={busy || botToken.trim().length < 20}
                  className="btn rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                >
                  Replace
                </button>
              </div>
            </div>
          ) : null}

          {connected ? (
            <div className="mt-5 border-t border-gray-100 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Owner notifications</p>
                  <p className="text-xs text-slate-500">
                    {ownerConnected ? "Authorized" : "The owner must start this business bot once."}
                  </p>
                </div>
                <div className="flex gap-2">
                  {!ownerConnected ? (
                    <button
                      type="button"
                      onClick={connectOwner}
                      disabled={busy}
                      className="btn inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Authorize
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={sendTest}
                      disabled={busy}
                      className="btn inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700"
                      data-testid="business-setup-telegram-test"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Send live test
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : null}

          {connection ? (
            <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
              <p className="text-xs text-slate-500">
                Webhook: {connection.webhookStatus.toLowerCase().replaceAll("_", " ")}
              </p>
              <button
                type="button"
                onClick={disconnect}
                disabled={busy}
                title="Disconnect Telegram bot"
                className="btn inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Disconnect
              </button>
            </div>
          ) : null}
        </>
      )}

      {message ? <p className="mt-3 text-sm font-semibold text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      {connection?.lastError ? (
        <p className="mt-2 text-xs text-red-600">Last provider error: {connection.lastError}</p>
      ) : null}
    </div>
  );
}
