"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  Plus,
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
  startBusinessTelegramOwnerAuthorization,
  updateBusinessTelegramSettings,
  type TelegramBusinessCustomCommand,
  type TelegramBusinessSettings,
  type TelegramSetupStatus
} from "@/components/business/features/api";

const TELEGRAM_BUILT_IN_COMMANDS = new Set([
  "start",
  "services",
  "book",
  "mybookings",
  "reschedule",
  "cancel",
  "help"
]);

const TELEGRAM_CUSTOM_COMMAND_ACTIONS: Array<{
  value: TelegramBusinessCustomCommand["action"];
  label: string;
}> = [
  { value: "reply", label: "Send a custom reply" },
  { value: "services", label: "Show services" },
  { value: "book", label: "Start booking" },
  { value: "help", label: "Show help menu" }
];

function newTelegramCustomCommand(): TelegramBusinessCustomCommand {
  return { command: "", description: "", action: "reply", response: "" };
}

function telegramCustomizationError(
  services: string[],
  commands: TelegramBusinessCustomCommand[]
): string {
  const normalizedServices = services.map((service) => service.trim()).filter(Boolean);
  if (normalizedServices.length !== services.length) {
    return "Enter a service name or remove the empty service row.";
  }
  if (new Set(normalizedServices.map((service) => service.toLocaleLowerCase())).size !== normalizedServices.length) {
    return "Each service name must be unique.";
  }

  const seen = new Set<string>();
  for (const command of commands) {
    if (!command.command) return "Enter a name for every custom command.";
    if (TELEGRAM_BUILT_IN_COMMANDS.has(command.command)) {
      return `/${command.command} is already a built-in command.`;
    }
    if (seen.has(command.command)) return `/${command.command} is duplicated.`;
    if (!command.description.trim()) return `Add a menu description for /${command.command}.`;
    if (command.action === "reply" && !command.response.trim()) {
      return `Add the bot reply for /${command.command}.`;
    }
    seen.add(command.command);
  }
  return "";
}

function TelegramLogo({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M21.4 2.6 2.8 9.8c-1.3.5-1.3 1.3-.2 1.6l4.8 1.5 1.8 5.7c.2.7.1.9.8.9.5 0 .8-.2 1.1-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.8-.8l3.1-14.9c.3-1.3-.5-1.9-1.7-1.4ZM9.3 12.6l9.3-5.9c.5-.3.9-.1.5.2l-7.7 7-.3 3.2-1.8-4.5Z" />
    </svg>
  );
}

function SettingToggle({
  label,
  checked,
  onChange,
  disabled = false
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center justify-between gap-3 rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2.5 text-sm font-medium text-slate-700 ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="h-4 w-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500"
      />
    </label>
  );
}

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
  const [settings, setSettings] = useState<TelegramBusinessSettings | null>(null);
  const [services, setServices] = useState<string[]>([]);
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
    setSettings({
      ...response.data.settings,
      telegramCustomCommands: response.data.settings.telegramCustomCommands ?? []
    });
    setServices(response.data.services);
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
      setMessage("Telegram bot connected and webhook verified.");
      await load();
    });
  }

  async function saveSettings() {
    if (!installedAgentId || !settings) return;
    await run(async () => {
      const response = await updateBusinessTelegramSettings(installedAgentId, {
        ...settings,
        botDisplayName,
        services: services.map((service) => service.trim())
      });
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "Telegram settings could not be saved.");
      }
      setSettings(response.data.settings);
      setServices(response.data.services);
      setStatus((current) => current ? { ...current, services: response.data!.services, settings: response.data!.settings } : current);
      setMessage("Telegram services, commands, and customer-detail settings saved.");
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
      setStatus((current) => current?.connection ? {
        ...current,
        connection: { ...current.connection, ownerNotificationStatus: "PENDING" }
      } : current);
      setMessage("Open Telegram and press Start within 15 minutes. Then refresh the owner status here.");
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

  function updateSetting<K extends keyof TelegramBusinessSettings>(
    key: K,
    value: TelegramBusinessSettings[K]
  ) {
    setSettings((current) => current ? { ...current, [key]: value } : current);
  }

  function updateBookingMode(enabled: boolean) {
    setSettings((current) => current ? {
      ...current,
      telegramBookingMode: enabled,
      telegramRequestPhone: enabled || current.telegramRequestPhone,
      ...(!enabled ? {
        telegramBookCommand: false,
        telegramMyBookingsCommand: false,
        telegramRescheduleCommand: false,
        telegramCancelCommand: false
      } : {})
    } : current);
  }

  function updateService(index: number, value: string) {
    setServices((current) => current.map((service, serviceIndex) => (
      serviceIndex === index ? value.slice(0, 120) : service
    )));
  }

  function updateCustomCommand(
    index: number,
    patch: Partial<TelegramBusinessCustomCommand>
  ) {
    setSettings((current) => current ? {
      ...current,
      telegramCustomCommands: current.telegramCustomCommands.map((command, commandIndex) => (
        commandIndex === index ? { ...command, ...patch } : command
      ))
    } : current);
  }

  const connection = status?.connection ?? null;
  const connected = connection?.status === "ACTIVE" && connection.webhookStatus === "HEALTHY";
  const ownerConnected = connection?.ownerNotificationStatus === "CONNECTED";
  const ownerPending = connection?.ownerNotificationStatus === "PENDING";
  const customizationError = settings
    ? telegramCustomizationError(services, settings.telegramCustomCommands)
    : "";

  return (
    <div className="mt-6 border-t border-gray-100 pt-6" data-testid="business-setup-telegram">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-50 text-[#229ED9]">
            <TelegramLogo />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Telegram bot</h3>
            <p className="text-xs text-slate-500">
              {connection?.botUsername ? `@${connection.botUsername}` : "Connect your BotFather bot token"}
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
          {connected ? "Connected" : "Not connected"}
        </span>
      </div>

      {!installedAgentId ? (
        <p className="mt-4 text-sm text-amber-700">Install this agent before connecting its Telegram bot.</p>
      ) : (
        <>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-sm font-semibold text-slate-700">Bot display name</span>
              <input
                value={botDisplayName}
                onChange={(event) => setBotDisplayName(event.target.value)}
                maxLength={64}
                className="field w-full rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900"
                data-testid="business-setup-telegram-display-name"
              />
            </label>
            {!connected || rotatingToken ? (
              <label>
                <span className="mb-1.5 block text-sm font-semibold text-slate-700">
                  {rotatingToken ? "Replacement BotFather token" : "BotFather token"}
                </span>
                <div className="flex gap-2">
                  <input
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
                    onClick={connectWithToken}
                    disabled={busy || botToken.trim().length < 20 || !botDisplayName.trim()}
                    className="btn inline-flex items-center gap-2 rounded-lg bg-[#229ED9] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
                    data-testid="business-setup-telegram-manual"
                  >
                    <KeyRound className="h-4 w-4" />
                    {rotatingToken ? "Replace" : "Connect"}
                  </button>
                </div>
              </label>
            ) : null}
          </div>

          {connected ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {connection?.botUrl ? (
                <a href={connection.botUrl} target="_blank" rel="noreferrer" className="btn inline-flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700">
                  <TelegramLogo className="h-3.5 w-3.5" /> Open bot
                </a>
              ) : null}
              <button type="button" onClick={checkHealth} disabled={busy} className="btn inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} /> Check health
              </button>
              <button type="button" onClick={() => setRotatingToken(true)} className="btn inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <KeyRound className="h-3.5 w-3.5" /> Rotate token
              </button>
            </div>
          ) : null}

          {settings ? (
            <div className="mt-6 space-y-6 border-t border-gray-100 pt-6" data-testid="business-setup-telegram-customization">
              <div>
                <h4 className="text-sm font-bold text-slate-900">Command menu</h4>
                <p className="mt-1 text-xs text-slate-500">Choose the commands customers see in Telegram. /start is always available.</p>
                <div className="mt-3 max-w-sm">
                  <SettingToggle label="Appointment booking features" checked={settings.telegramBookingMode} onChange={updateBookingMode} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <SettingToggle label="/services" checked={settings.telegramServicesCommand} onChange={(value) => updateSetting("telegramServicesCommand", value)} />
                  <SettingToggle label="/book" checked={settings.telegramBookCommand} disabled={!settings.telegramBookingMode} onChange={(value) => updateSetting("telegramBookCommand", value)} />
                  <SettingToggle label="/mybookings" checked={settings.telegramMyBookingsCommand} disabled={!settings.telegramBookingMode} onChange={(value) => updateSetting("telegramMyBookingsCommand", value)} />
                  <SettingToggle label="/reschedule" checked={settings.telegramRescheduleCommand} disabled={!settings.telegramBookingMode} onChange={(value) => updateSetting("telegramRescheduleCommand", value)} />
                  <SettingToggle label="/cancel" checked={settings.telegramCancelCommand} disabled={!settings.telegramBookingMode} onChange={(value) => updateSetting("telegramCancelCommand", value)} />
                  <SettingToggle label="/help" checked={settings.telegramHelpCommand} onChange={(value) => updateSetting("telegramHelpCommand", value)} />
                </div>

                <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50/50 p-4" data-testid="business-setup-telegram-custom-commands">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h5 className="text-sm font-bold text-slate-800">Custom commands</h5>
                      <p className="mt-1 text-xs text-slate-500">Add a command and choose exactly what the bot should do when a customer uses it.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => updateSetting("telegramCustomCommands", [
                        ...settings.telegramCustomCommands,
                        newTelegramCustomCommand()
                      ])}
                      disabled={settings.telegramCustomCommands.length >= 20}
                      className="btn inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 disabled:opacity-50"
                      data-testid="business-setup-telegram-add-command"
                    >
                      <Plus className="h-3.5 w-3.5" /> Add command
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    {settings.telegramCustomCommands.length === 0 ? (
                      <p className="text-xs text-slate-500">No custom commands added.</p>
                    ) : settings.telegramCustomCommands.map((command, index) => (
                      <div key={`${index}-${command.command}`} className="rounded-lg border border-gray-200 bg-white p-3" data-testid={`business-setup-telegram-command-${index}`}>
                        <div className="grid gap-3 md:grid-cols-2">
                          <label>
                            <span className="mb-1 block text-xs font-semibold text-slate-700">Command</span>
                            <div className="flex rounded-lg border border-gray-200 bg-white focus-within:border-sky-400">
                              <span className="border-r border-gray-200 px-3 py-2 text-sm text-slate-400">/</span>
                              <input
                                value={command.command}
                                onChange={(event) => updateCustomCommand(index, {
                                  command: event.target.value
                                    .replace(/^\/+/, "")
                                    .toLowerCase()
                                    .replace(/[^a-z0-9_]/g, "")
                                    .slice(0, 32)
                                })}
                                placeholder="pricing"
                                className="min-w-0 flex-1 rounded-r-lg px-3 py-2 text-sm text-slate-900 outline-none"
                                data-testid={`business-setup-telegram-command-name-${index}`}
                              />
                            </div>
                          </label>
                          <label>
                            <span className="mb-1 block text-xs font-semibold text-slate-700">What does this command do?</span>
                            <select
                              value={command.action}
                              onChange={(event) => updateCustomCommand(index, {
                                action: event.target.value as TelegramBusinessCustomCommand["action"]
                              })}
                              className="field w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900"
                              data-testid={`business-setup-telegram-command-action-${index}`}
                            >
                              {TELEGRAM_CUSTOM_COMMAND_ACTIONS.map((action) => (
                                <option key={action.value} value={action.value}>{action.label}</option>
                              ))}
                            </select>
                          </label>
                          <label className="md:col-span-2">
                            <span className="mb-1 block text-xs font-semibold text-slate-700">Command menu description</span>
                            <input
                              value={command.description}
                              onChange={(event) => updateCustomCommand(index, { description: event.target.value.slice(0, 256) })}
                              placeholder="View pricing information"
                              className="field w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900"
                              data-testid={`business-setup-telegram-command-description-${index}`}
                            />
                          </label>
                          {command.action === "reply" ? (
                            <label className="md:col-span-2">
                              <span className="mb-1 block text-xs font-semibold text-slate-700">Bot reply</span>
                              <textarea
                                rows={2}
                                value={command.response}
                                onChange={(event) => updateCustomCommand(index, { response: event.target.value.slice(0, 4096) })}
                                placeholder="Tell the customer what they need to know."
                                className="field w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900"
                                data-testid={`business-setup-telegram-command-response-${index}`}
                              />
                            </label>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          onClick={() => updateSetting(
                            "telegramCustomCommands",
                            settings.telegramCustomCommands.filter((_, commandIndex) => commandIndex !== index)
                          )}
                          className="btn mt-3 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Remove command
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900">Services shown by the bot</h4>
                <p className="mt-1 text-xs text-slate-500">Type the services this business offers. The bot uses this list for /services and /book, and saving also updates Business Profile.</p>
                <div className="mt-3 max-w-2xl space-y-2" data-testid="business-setup-telegram-services">
                  {services.map((service, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        value={service}
                        onChange={(event) => updateService(index, event.target.value)}
                        placeholder="e.g. Consultation"
                        className="field min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-slate-900"
                        data-testid={`business-setup-telegram-service-${index}`}
                      />
                      <button
                        type="button"
                        onClick={() => setServices((current) => current.filter((_, serviceIndex) => serviceIndex !== index))}
                        className="btn inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-red-600"
                        aria-label={`Remove ${service || `service ${index + 1}`}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Remove
                      </button>
                    </div>
                  ))}
                  {services.length === 0 ? (
                    <p className="text-xs font-semibold text-amber-700">No services added. Add the services customers can view and book.</p>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setServices((current) => [...current, ""])}
                    disabled={services.length >= 30}
                    className="btn inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-700 disabled:opacity-50"
                    data-testid="business-setup-telegram-add-service"
                  >
                    <Plus className="h-3.5 w-3.5" /> Add service
                  </button>
                </div>
              </div>

              <div>
                <h4 className="text-sm font-bold text-slate-900">Customer details</h4>
                <p className="mt-1 text-xs text-slate-500">Choose what the bot asks for during booking. Telegram already provides the customer name and user ID.</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  <SettingToggle label="Phone number (required for booking)" checked={settings.telegramBookingMode || settings.telegramRequestPhone} disabled={settings.telegramBookingMode} onChange={(value) => updateSetting("telegramRequestPhone", value)} />
                  <SettingToggle label="Email address" checked={settings.telegramRequestEmail} onChange={(value) => updateSetting("telegramRequestEmail", value)} />
                  <SettingToggle label="Booking notes" checked={settings.telegramRequestNotes} onChange={(value) => updateSetting("telegramRequestNotes", value)} />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Welcome message</span>
                  <textarea rows={3} value={settings.telegramWelcomeMessage} onChange={(event) => updateSetting("telegramWelcomeMessage", event.target.value)} maxLength={4096} className="field w-full resize-y rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900" />
                </label>
                <label>
                  <span className="mb-1.5 block text-sm font-semibold text-slate-700">Fallback message</span>
                  <textarea rows={3} value={settings.telegramFallbackMessage} onChange={(event) => updateSetting("telegramFallbackMessage", event.target.value)} maxLength={4096} className="field w-full resize-y rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm text-slate-900" />
                </label>
              </div>

              {customizationError ? <p className="text-sm font-semibold text-red-600" data-testid="business-setup-telegram-validation-error">{customizationError}</p> : null}

              <button type="button" onClick={saveSettings} disabled={busy || Boolean(customizationError)} className="btn rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" data-testid="business-setup-telegram-save-settings">
                Save Telegram settings
              </button>
            </div>
          ) : null}

          {connected ? (
            <div className="mt-6 rounded-xl border border-sky-100 bg-sky-50/50 p-4" data-testid="business-setup-telegram-owner">
              <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-800">Business owner notifications</p>
                <p className="mt-1 max-w-xl text-xs text-slate-600">
                  {ownerConnected
                    ? "Connected as the business owner. This private chat is stored separately from customer chats and receives full booking details."
                    : ownerPending
                      ? "Waiting for the business owner to press Start in Telegram. The secure link expires after 15 minutes."
                      : "Connect your personal Telegram privately. Customers receive only their confirmations and necessary updates."}
                </p>
              </div>
              {!ownerConnected ? (
                <div className="flex flex-wrap gap-2">
                  {ownerPending ? (
                    <button type="button" onClick={() => void load()} disabled={busy} className="btn inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700" data-testid="business-setup-telegram-owner-refresh"><RefreshCw className="h-3.5 w-3.5" /> Refresh status</button>
                  ) : null}
                  <button type="button" onClick={connectOwner} disabled={busy} className="btn inline-flex items-center gap-2 rounded-lg bg-[#229ED9] px-3 py-2 text-xs font-semibold text-white" data-testid="business-setup-telegram-owner-connect"><ExternalLink className="h-3.5 w-3.5" /> {ownerPending ? "Generate new link" : "Connect my Telegram"}</button>
                </div>
              ) : (
                <button type="button" onClick={sendTest} disabled={busy} className="btn inline-flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs font-semibold text-green-700" data-testid="business-setup-telegram-test"><Send className="h-3.5 w-3.5" /> Send live test</button>
              )}
              </div>
              <p className="mt-3 text-[11px] text-slate-500">No phone number or manual chat ID is required. Telegram provides the verified private chat ID only after the owner presses Start.</p>
            </div>
          ) : null}

          {connection ? (
            <div className="mt-5 flex items-center justify-between border-t border-gray-100 pt-4">
              <p className="text-xs text-slate-500">Webhook: {connection.webhookStatus.toLowerCase().replaceAll("_", " ")}</p>
              <button type="button" onClick={disconnect} disabled={busy} className="btn inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50"><Trash2 className="h-3.5 w-3.5" /> Disconnect</button>
            </div>
          ) : null}
        </>
      )}

      {message ? <p className="mt-3 text-sm font-semibold text-green-700">{message}</p> : null}
      {error ? <p className="mt-3 text-sm font-semibold text-red-600">{error}</p> : null}
      {connection?.lastError ? <p className="mt-2 text-xs text-red-600">Last provider error: {connection.lastError}</p> : null}
    </div>
  );
}
