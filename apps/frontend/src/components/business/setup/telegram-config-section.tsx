"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, HelpCircle, Info, Loader2, Plus, Sparkles, Trash2, UploadCloud, Zap } from "lucide-react";
import {
  generateBusinessTelegramCommands,
  getBusinessTelegramStatus,
  updateBusinessTelegramSettings,
  type TelegramBusinessCustomCommand,
  type TelegramBusinessSettings,
  type TelegramSetupStatus
} from "@/components/business/features/api";
import { InfoTooltip } from "./InfoTooltip";
import { SECTION_TITLE } from "./ui";

/* ──────────────────────────────────────────────────────────────────────────
   Constants & Action Options
────────────────────────────────────────────────────────────────────────── */

const RESERVED_COMMANDS = new Set(["start"]);

const CUSTOM_COMMAND_ACTIONS: Array<{
  value: TelegramBusinessCustomCommand["action"];
  label: string;
  subtitle: string;
}> = [
  {
    value: "reply",
    label: "Manual Message",
    subtitle: "Send a fixed text response message directly to the customer"
  },
  {
    value: "book",
    label: "AI Action",
    subtitle: "AI intelligently responds and completes tasks using custom instructions"
  }
];



/* Quick command presets for 1-click selection */
const FIVE_PRESETS = [
  {
    command: "help",
    label: "Help",
    description: "Show available commands & guidance menu",
    action: "reply" as const,
    response: "Need assistance? Type your question or choose an option below."
  },
  {
    command: "services",
    label: "Services",
    description: "View business products & services list",
    action: "services" as const,
    response: "Here is our list of available products and services. Let us know how we can help!"
  },
  {
    command: "book",
    label: "Book Request",
    description: "Start interactive request or booking workflow",
    action: "book" as const,
    response: "Ask customer for request details and contact phone number, then alert business owner."
  },
  /* THESE USED TO ARRIVE PRE-FILLED, AND PUBLISH. Picking one of these three
     appended a ready-made answer — "packages start at $50", "Address: 123
     Business Way", "support@example.com or call (555) 019-2831" — and the
     screen saves on its own after a moment, so a business's own customers
     were told a price nobody set and an address that does not exist. They
     arrive empty now, and the save refuses an empty answer, so the business
     must write their own words before it can go out. */
  {
    command: "pricing",
    label: "Pricing",
    description: "View pricing & service packages",
    action: "reply" as const,
    response: ""
  },
  {
    command: "hours",
    label: "Hours",
    description: "View opening hours & store location",
    action: "reply" as const,
    response: ""
  },
  {
    command: "contact",
    label: "Contact",
    description: "Get direct business contact & phone",
    action: "reply" as const,
    response: ""
  }
];

function ensureDefaultCommands(loadedCmds: TelegramBusinessCustomCommand[]): TelegramBusinessCustomCommand[] {
  const hasCommands = loadedCmds.some((c) => c.command === "commands");
  if (!hasCommands) {
    return [
      {
        command: "commands",
        description: "Show list of all active bot commands",
        action: "reply",
        response: ""
      },
      ...loadedCmds
    ];
  }
  return loadedCmds;
}

/* ──────────────────────────────────────────────────────────────────────────
   Validation
────────────────────────────────────────────────────────────────────────── */

function validateCustomCommands(commands: TelegramBusinessCustomCommand[]): string {
  const seen = new Set<string>();
  for (const cmd of commands) {
    if (!cmd.command) return "Enter a name for every shortcut.";
    if (cmd.command === "start") return "/start is a fixed Telegram command and cannot be re-defined.";
    if (seen.has(cmd.command)) return `/${cmd.command} is used more than once.`;
    if (cmd.command !== "commands") {
      if ((cmd.action === "reply" || cmd.action === "services" || cmd.action === "help") && !cmd.response.trim()) return `Enter the reply message text for /${cmd.command}.`;
      if (cmd.action === "book" && !cmd.response.trim()) return `Enter the AI action instructions for /${cmd.command}.`;
    }
    seen.add(cmd.command);
  }
  return "";
}

/* ──────────────────────────────────────────────────────────────────────────
   Minimalist Custom Action Select (Amber Theme)
────────────────────────────────────────────────────────────────────────── */

function CustomActionSelect({
  value,
  onChange,
  testId
}: {
  value: TelegramBusinessCustomCommand["action"];
  onChange: (val: TelegramBusinessCustomCommand["action"]) => void;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const selectedOpt =
    CUSTOM_COMMAND_ACTIONS.find((a) => a.value === value) ||
    CUSTOM_COMMAND_ACTIONS.find((a) => a.value === "reply") ||
    CUSTOM_COMMAND_ACTIONS[0];

  return (
    <div className="relative flex-1" ref={dropdownRef}>
      {/* Hidden select for testing & form compatibility */}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as TelegramBusinessCustomCommand["action"])}
        className="sr-only"
        data-testid={testId}
        aria-hidden="true"
      >
        {CUSTOM_COMMAND_ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>{a.label}</option>
        ))}
      </select>

      {/* Minimalist trigger button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left transition-all hover:border-slate-300 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20 cursor-pointer"
      >
        <div className="min-w-0 pr-2">
          <span className="block truncate text-xs font-semibold text-slate-800 leading-snug">
            {selectedOpt.label}
          </span>
          <span className="block truncate text-[11px] font-normal text-slate-500 leading-snug">
            {selectedOpt.subtitle}
          </span>
        </div>
        <svg
          className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform duration-200 ${
            open ? "rotate-180 text-amber-600" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown Menu Popover */}
      {open ? (
        <div
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-1 max-h-60 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 shadow-lg transition-all animate-in fade-in zoom-in-95 duration-100"
        >
          {CUSTOM_COMMAND_ACTIONS.map((opt) => {
            const isSelected = value === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full flex items-center justify-between rounded-md px-2.5 py-1.5 text-left transition-colors cursor-pointer ${
                  isSelected
                    ? "bg-amber-50 text-amber-900 font-semibold"
                    : "hover:bg-slate-50 text-slate-700"
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="text-xs font-semibold text-slate-800 leading-snug">{opt.label}</div>
                  <div className="text-[11px] font-normal text-slate-500 leading-snug">{opt.subtitle}</div>
                </div>
                {isSelected ? (
                  <svg
                    className="w-3.5 h-3.5 text-amber-600 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth="3"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   Main Component
────────────────────────────────────────────────────────────────────────── */

export interface TelegramConfigSectionProps {
  installedAgentId: string | null;
  businessName: string;
  services?: string[];
  onSaved?: () => void;
  registerTelegramApi?: (
    api: { save: () => Promise<{ ok: boolean; error?: string }>; isDirty: () => boolean } | null
  ) => void;
}

export function TelegramConfigSection({
  installedAgentId,
  businessName,
  services: propServices,
  onSaved,
  registerTelegramApi
}: TelegramConfigSectionProps) {
  const [status, setStatus] = useState<TelegramSetupStatus | null>(null);
  const [settings, setSettings] = useState<TelegramBusinessSettings | null>(null);
  const [services, setServices] = useState<string[]>(propServices ?? []);
  const [botDisplayName, setBotDisplayName] = useState(
    `${businessName.trim() || "Business"} Assistant`
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showValidation, setShowValidation] = useState(false);

  const [activeCommandIndex, setActiveCommandIndex] = useState<number>(0);

  const [businessInfoInput, setBusinessInfoInput] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generationError, setGenerationError] = useState("");
  const [generationSuccess, setGenerationSuccess] = useState(false);

  const handleGenerateCommands = async () => {
    if (!installedAgentId) return;
    if (!businessInfoInput.trim() && !selectedFile) return;

    setGenerating(true);
    setGenerationError("");
    setGenerationSuccess(false);

    try {
      const response = await generateBusinessTelegramCommands(
        installedAgentId,
        businessInfoInput.trim() || undefined,
        selectedFile || undefined
      );

      if (!response.success || !response.data) {
        throw new Error(response.error ?? "Failed to generate commands.");
      }

      const generated = response.data;
      
      setSettings((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          telegramWelcomeMessage: generated.welcomeMessage || cur.telegramWelcomeMessage,
          telegramFallbackMessage: generated.fallbackMessage || cur.telegramFallbackMessage,
          telegramCustomCommands: [
            {
              command: "commands",
              description: "Show list of all active bot commands",
              action: "reply",
              response: "Show a list of all active bot commands."
            },
            ...generated.commands.map((c) => ({
              command: c.command.toLowerCase().replace(/[^a-z0-9_]/g, ""),
              description: c.description || "",
              action: c.action || "reply",
              response: c.response || ""
            }))
          ]
        };
      });

      setActiveCommandIndex(0);
      setGenerationSuccess(true);
      setBusinessInfoInput("");
      setSelectedFile(null);
    } catch (err) {
      setGenerationError(err instanceof Error ? err.message : "Error generating commands");
    } finally {
      setGenerating(false);
    }
  };

  const load = useCallback(async () => {
    if (!installedAgentId) return;
    const response = await getBusinessTelegramStatus(installedAgentId);
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not load Telegram settings.");
      return;
    }
    setStatus(response.data);
    const loadedCmds = ensureDefaultCommands(response.data.settings.telegramCustomCommands ?? []);
    setSettings({
      ...response.data.settings,
      telegramCustomCommands: loadedCmds
    });
    if (loadedCmds.length > 0) {
      setActiveCommandIndex(0);
    }
    if (propServices && propServices.length > 0) {
      setServices(propServices);
    } else {
      setServices(response.data.services ?? []);
    }
    if (response.data.connection?.botDisplayName) {
      setBotDisplayName(response.data.connection.botDisplayName);
    }
  }, [installedAgentId, propServices]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildPayload = useCallback(() => {
    if (!settings) return null;
    const activeServices = propServices && propServices.length > 0 ? propServices : services;
    const cmds = settings.telegramCustomCommands || [];
    const hasServices = cmds.some((c) => c.command === "services");
    const hasBook = cmds.some((c) => c.command === "book");
    const hasMyBookings = cmds.some((c) => c.command === "mybookings");
    const hasReschedule = cmds.some((c) => c.command === "reschedule");
    const hasCancel = cmds.some((c) => c.command === "cancel");
    const hasHelp = cmds.some((c) => c.command === "help");
    const hasBookingMode = hasBook || hasMyBookings || hasReschedule || hasCancel || cmds.some((c) => c.action === "book");

    return {
      ...settings,
      botDisplayName,
      telegramServicesCommand: hasServices,
      telegramBookCommand: hasBook,
      telegramMyBookingsCommand: hasMyBookings,
      telegramRescheduleCommand: hasReschedule,
      telegramCancelCommand: hasCancel,
      telegramHelpCommand: hasHelp,
      telegramBookingMode: hasBookingMode,
      services: activeServices.map((s) => s.trim()).filter(Boolean)
    };
  }, [settings, botDisplayName, propServices, services]);

  useEffect(() => {
    if (!registerTelegramApi) return;
    registerTelegramApi({
      save: async () => {
        if (!installedAgentId || !settings) return { ok: true };
        const vErr = validateCustomCommands(settings.telegramCustomCommands);
        if (vErr) return { ok: false, error: vErr };
        try {
          const payload = buildPayload();
          if (!payload) return { ok: true };
          const response = await updateBusinessTelegramSettings(installedAgentId, payload);
          if (!response.success) {
            return { ok: false, error: response.error ?? "Could not save Telegram settings." };
          }
          return { ok: true };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : "Could not save Telegram settings." };
        }
      },
      isDirty: () => true
    });
    return () => registerTelegramApi(null);
  }, [registerTelegramApi, installedAgentId, settings, buildPayload]);

  const saveSettings = useCallback(async () => {
    if (!installedAgentId || !settings) return;
    setShowValidation(true);
    const vErr = validateCustomCommands(settings.telegramCustomCommands);
    if (vErr) return;

    setBusy(true);
    setMessage("");
    setError("");
    try {
      const payload = buildPayload();
      if (!payload) return;
      const response = await updateBusinessTelegramSettings(installedAgentId, payload);
      if (!response.success || !response.data) {
        throw new Error(response.error ?? "Telegram settings could not be saved.");
      }
      setSettings(response.data.settings);
      setServices(response.data.services);
      setStatus((cur) =>
        cur ? { ...cur, services: response.data!.services, settings: response.data!.settings } : cur
      );
      setMessage("Telegram configuration saved.");
      onSaved?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Failed to save settings.");
    } finally {
      setBusy(false);
    }
  }, [installedAgentId, settings, buildPayload, onSaved]);

  // Debounced auto-save on change (only if valid)
  const isInitialMount = useRef(true);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    if (!installedAgentId || !settings) return;

    // Only auto-save if settings pass validation
    if (validateCustomCommands(settings.telegramCustomCommands)) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      void (async () => {
        try {
          const payload = buildPayload();
          if (!payload) return;
          const response = await updateBusinessTelegramSettings(installedAgentId, payload);
          if (response.success && response.data) {
            onSaved?.();
          }
        } catch (e) {
          console.error("Auto-save failed silently:", e);
        }
      })();
    }, 400);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [settings, installedAgentId, buildPayload, onSaved]);

  function patch<K extends keyof TelegramBusinessSettings>(key: K, value: TelegramBusinessSettings[K]) {
    setShowValidation(false);
    setSettings((cur) => (cur ? { ...cur, [key]: value } : cur));
  }

  function patchCustomCommand(index: number, delta: Partial<TelegramBusinessCustomCommand>) {
    setShowValidation(false);
    setSettings((cur) =>
      cur
        ? {
            ...cur,
            telegramCustomCommands: cur.telegramCustomCommands.map((cmd, i) =>
              i === index ? { ...cmd, ...delta } : cmd
            )
          }
        : cur
    );
  }

  function selectOrCreatePreset(preset: typeof FIVE_PRESETS[number]) {
    if (!settings) return;
    setShowValidation(false);
    const existingIdx = settings.telegramCustomCommands.findIndex((c) => c.command === preset.command);
    if (existingIdx >= 0) {
      setActiveCommandIndex(existingIdx);
    } else {
      const newCmd = {
        command: preset.command,
        description: preset.description,
        action: preset.action,
        response: preset.response
      };
      const nextList = [...settings.telegramCustomCommands, newCmd];
      setSettings((cur) => (cur ? { ...cur, telegramCustomCommands: nextList } : cur));
      setActiveCommandIndex(nextList.length - 1);
    }
  }

  function addCustomCommand() {
    setShowValidation(false);
    setSettings((cur) => {
      if (!cur) return cur;
      const newCmd = {
        command: "",
        description: "",
        action: "reply" as const,
        response: ""
      };
      const nextList = [...cur.telegramCustomCommands, newCmd];
      setActiveCommandIndex(nextList.length - 1);
      return { ...cur, telegramCustomCommands: nextList };
    });
  }

  function removeCustomCommand(index: number) {
    if (!settings) return;
    if (settings.telegramCustomCommands[index]?.command === "commands") return; // cannot remove default
    setShowValidation(false);
    setSettings((cur) => {
      if (!cur) return cur;
      const nextList = cur.telegramCustomCommands.filter((_, i) => i !== index);
      const nextIdx = Math.max(0, Math.min(index, nextList.length - 1));
      setActiveCommandIndex(nextIdx);
      return { ...cur, telegramCustomCommands: nextList };
    });
  }

  if (!installedAgentId) {
    return (
      <p className="text-xs text-slate-500">
        Connect your Telegram bot first to access configuration settings.
      </p>
    );
  }

  if (!settings) {
    return (
      <div className="py-3 flex items-center gap-2 text-xs text-slate-400">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-200 border-t-amber-500" />
        Loading settings…
      </div>
    );
  }

  const validationError = validateCustomCommands(settings.telegramCustomCommands);

  const activeIdx = Math.min(activeCommandIndex, Math.max(0, settings.telegramCustomCommands.length - 1));
  const activeCmd = settings.telegramCustomCommands[activeIdx] ?? null;
  const isDefaultCommandsCmd = activeCmd?.command === "commands";

  return (
    <div className="space-y-6 text-slate-900" data-testid="business-setup-telegram-customization">

      {/* ── Section 0: AI Command Generator ── */}
      <div className="space-y-3">
        <div>
          <h4 className={`${SECTION_TITLE} inline-flex items-center gap-1.5`}>
            <Sparkles className="h-3.5 w-3.5 text-amber-500" />
            AI Bot Command Generator
            <InfoTooltip content="Provide business details or upload documents to automatically generate bot greetings and command shortcuts." />
          </h4>
        </div>

        <div className="space-y-2.5">
          {/* Text Area */}
          <div>
            <textarea
              rows={3}
              value={businessInfoInput}
              onChange={(e) => setBusinessInfoInput(e.target.value)}
              placeholder="Paste website content, business profile, services list, or details here..."
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-400 transition-colors"
            />
          </div>

          {/* Compact File Upload Bar */}
          <div
            className="border border-dashed border-slate-200 hover:border-slate-300 rounded-lg px-3 py-2 bg-slate-50/50 hover:bg-slate-50 transition-colors cursor-pointer text-xs text-slate-600 flex items-center justify-between"
            onClick={() => document.getElementById("ai-command-file-input")?.click()}
          >
            <input
              id="ai-command-file-input"
              type="file"
              accept=".pdf,.docx,.txt"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0] || null;
                setSelectedFile(file);
              }}
            />
            {selectedFile ? (
              <div className="flex items-center justify-between w-full text-xs font-medium text-slate-700">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="h-4 w-4 text-slate-500 shrink-0" />
                  <span className="truncate">{selectedFile.name}</span>
                  <span className="text-[10px] text-slate-400 font-normal">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedFile(null);
                  }}
                  className="text-slate-400 hover:text-red-500 font-bold ml-2 shrink-0 p-0.5"
                  title="Remove file"
                >
                  ✕
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between w-full text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <UploadCloud className="h-4 w-4 text-slate-400 shrink-0" />
                  <span>Upload brochure, PDF, or text document</span>
                </div>
                <span className="text-[10px] text-slate-400">PDF, DOCX, TXT (up to 10MB)</span>
              </div>
            )}
          </div>

          {/* Action Footer & Status */}
          <div className="flex items-center justify-between gap-4 pt-1">
            <div>
              {generationSuccess && (
                <p className="text-[11px] font-medium text-emerald-600 flex items-center gap-1">
                  ✓ Commands generated successfully! Review settings below.
                </p>
              )}
              {generationError && (
                <p className="text-[11px] font-medium text-red-600">
                  {generationError}
                </p>
              )}
            </div>

            <button
              type="button"
              disabled={generating || (!businessInfoInput.trim() && !selectedFile)}
              onClick={handleGenerateCommands}
              className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white font-medium py-1.5 px-3.5 rounded-lg flex items-center gap-1.5 text-xs transition-colors cursor-pointer disabled:cursor-not-allowed select-none shrink-0"
            >
              {generating ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-slate-300" />
                  <span>Generating…</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 text-amber-400" />
                  <span>Generate Commands</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Section 1: Greeting Messages ── */}
      <div className="space-y-3">
        <div>
          <h4 className={`${SECTION_TITLE} inline-flex items-center gap-1.5`}>
            Greeting Messages
            <InfoTooltip content="Set automatic replies when a customer opens a chat or needs guidance." />
          </h4>
        </div>
        <div className="grid gap-3.5 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">
              Welcome Greeting <span className="text-slate-400 font-normal lowercase">(optional)</span>
              <InfoTooltip content="Sent automatically when a customer starts a chat (/start)." />
            </span>
            <textarea
              rows={2}
              value={settings.telegramWelcomeMessage}
              onChange={(e) => patch("telegramWelcomeMessage", e.target.value)}
              placeholder="e.g. Hi! Welcome! How can I help you today?"
              maxLength={4096}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-700">
              Help Guidance Reply <span className="text-slate-400 font-normal lowercase">(optional)</span>
              <InfoTooltip content="Sent when the bot cannot understand a customer message." />
            </span>
            <textarea
              rows={2}
              value={settings.telegramFallbackMessage}
              onChange={(e) => patch("telegramFallbackMessage", e.target.value)}
              placeholder="e.g. I didn't quite catch that. Type /help to view options."
              maxLength={4096}
              className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
            />
          </label>
        </div>
      </div>

      <div className="border-t border-slate-100" />

      {/* ── Section 2: Bot Commands & Shortcuts ── */}
      <div
        className="space-y-3.5"
        data-testid="business-setup-telegram-custom-commands"
      >
        <div>
          <h4 className={`${SECTION_TITLE} inline-flex items-center gap-1.5`}>
            Bot Commands &amp; Shortcuts
            <InfoTooltip content="Configure bot commands below, or click a Quick Add shortcut to add one." />
          </h4>
        </div>

        {/* ── Configured Command Tabs + Unconfigured Presets ── */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 pb-1">
          {/* Active Configured Commands */}
          {settings.telegramCustomCommands.map((cmd, idx) => {
            const isSelected = activeIdx === idx;
            const isDefault = cmd.command === "commands";
            return (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setShowValidation(false);
                  setActiveCommandIndex(idx);
                }}
                className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors cursor-pointer select-none ${
                  isSelected
                    ? "border-amber-500 bg-amber-500 text-white font-semibold shadow-xs"
                    : "border-amber-200 bg-amber-50/60 text-amber-900 hover:border-amber-300"
                }`}
              >
                <span>/{cmd.command || "custom"}</span>
                {isDefault ? (
                  <span className={`text-[10px] font-normal ${isSelected ? "opacity-90 text-amber-100" : "text-amber-700"}`}>
                    (default)
                  </span>
                ) : null}
              </button>
            );
          })}

          {/* Unconfigured Quick Add Presets */}
          {FIVE_PRESETS.filter(
            (preset) => !settings.telegramCustomCommands.some((c) => c.command === preset.command)
          ).map((preset) => (
            <button
              key={preset.command}
              type="button"
              onClick={() => selectOrCreatePreset(preset)}
              className="flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:border-amber-300 hover:bg-amber-50/40 transition-colors cursor-pointer select-none"
            >
              <span>+ /{preset.command}</span>
            </button>
          ))}

          {/* Add Custom Shortcut Button */}
          <button
            type="button"
            onClick={addCustomCommand}
            disabled={settings.telegramCustomCommands.length >= 20}
            className="flex items-center gap-1 rounded-md border border-dashed border-amber-300 bg-white px-2.5 py-1 text-xs font-medium text-amber-800 hover:border-amber-400 hover:bg-amber-50 disabled:opacity-50 transition-colors cursor-pointer"
            data-testid="business-setup-telegram-add-command"
          >
            <Plus className="h-3 w-3 text-amber-600" />
            <span>Custom</span>
          </button>
        </div>

        {/* ── Single Command Input Form ── */}
        {settings.telegramCustomCommands.length === 0 ? (
          <div className="py-6 text-center text-xs text-slate-500 rounded-lg border border-dashed border-slate-200 bg-slate-50/50">
            <p>No shortcut selected. Click a Quick Add preset above or + Custom to configure a command.</p>
          </div>
        ) : activeCmd ? (
          <div
            className="space-y-3 pt-2"
            data-testid={`business-setup-telegram-command-${activeIdx}`}
          >
            {/* Row 1: Shortcut Name + Bot Action Type + Remove Button */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Command Name */}
              <div className="w-full sm:w-auto sm:min-w-[140px] sm:max-w-[180px]">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Shortcut Name {isDefaultCommandsCmd ? null : <span className="text-red-500">*</span>}
                </span>
                <div className={`flex rounded-lg border overflow-hidden ${
                  isDefaultCommandsCmd
                    ? "border-slate-200 bg-slate-100 opacity-85 cursor-not-allowed"
                    : "border-slate-200 bg-white focus-within:border-amber-500 focus-within:ring-2 focus-within:ring-amber-500/20"
                }`}>
                  <span className="flex items-center rounded-l-lg border-r border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-mono text-slate-500 select-none">/</span>
                  <input
                    value={activeCmd.command}
                    disabled={isDefaultCommandsCmd}
                    onChange={(e) =>
                      patchCustomCommand(activeIdx, {
                        command: e.target.value
                          .replace(/^\/+/, "")
                          .toLowerCase()
                          .replace(/[^a-z0-9_]/g, "")
                          .slice(0, 32)
                      })
                    }
                    placeholder="pricing"
                    className={`min-w-0 flex-1 rounded-r-lg px-2.5 py-1.5 text-xs font-mono outline-none ${
                      isDefaultCommandsCmd ? "bg-slate-100 text-slate-600 cursor-not-allowed" : "bg-transparent text-slate-900"
                    }`}
                    data-testid={`business-setup-telegram-command-name-${activeIdx}`}
                  />
                </div>
              </div>

              {/* Bot Action Type (Selector) */}
              <div className="w-full sm:w-auto sm:flex-1">
                <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Bot Action Type {isDefaultCommandsCmd ? null : <span className="text-red-500">*</span>}
                </span>
                {isDefaultCommandsCmd ? (
                  <div className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-left opacity-85 cursor-not-allowed">
                    <div className="min-w-0 pr-2">
                      <span className="block truncate text-xs font-semibold text-slate-700 leading-snug">
                        System Default Command
                      </span>
                      <span className="block truncate text-[11px] font-normal text-slate-500 leading-snug">
                        Automatically displays all active bot commands to the customer
                      </span>
                    </div>
                  </div>
                ) : (
                  <CustomActionSelect
                    value={activeCmd.action}
                    onChange={(val) => patchCustomCommand(activeIdx, { action: val })}
                    testId={`business-setup-telegram-command-action-${activeIdx}`}
                  />
                )}
              </div>

              {/* Remove Button (Hidden for /commands default command) */}
              {!isDefaultCommandsCmd ? (
                <div className="flex justify-end sm:pt-4">
                  <button
                    type="button"
                    onClick={() => removeCustomCommand(activeIdx)}
                    className="rounded-md p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                    title="Remove shortcut"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ) : null}
            </div>

            {/* Row 2: Menu Description */}
            <div>
              <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Menu Description <span className="text-slate-400 font-normal lowercase">(optional)</span>
              </span>
              <input
                value={activeCmd.description}
                onChange={(e) => patchCustomCommand(activeIdx, { description: e.target.value.slice(0, 256) })}
                placeholder="Short description shown in Telegram command menu (e.g. Show list of all active bot commands)"
                className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                data-testid={`business-setup-telegram-command-description-${activeIdx}`}
              />
            </div>

            {/* Row 3: Response Text or AI Action Instructions (Omitted for /commands default command) */}
            {!isDefaultCommandsCmd ? (
              activeCmd.action === "reply" || activeCmd.action === "services" || activeCmd.action === "help" ? (
                <div>
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Reply Message Text <span className="text-red-500">*</span>
                  </span>
                  <textarea
                    rows={2}
                    value={activeCmd.response}
                    onChange={(e) => patchCustomCommand(activeIdx, { response: e.target.value.slice(0, 4096) })}
                    placeholder="Enter the exact response text message your bot will send when triggered..."
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    data-testid={`business-setup-telegram-command-response-${activeIdx}`}
                  />
                </div>
              ) : (
                <div>
                  <span className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    AI Action Instructions <span className="text-red-500">*</span>
                  </span>
                  <textarea
                    rows={2}
                    value={activeCmd.response}
                    onChange={(e) => patchCustomCommand(activeIdx, { response: e.target.value.slice(0, 4096) })}
                    placeholder="Describe what the AI bot should do (e.g. 'Ask for Policy ID & damage photo, collect phone number, and alert owner')."
                    className="w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/20"
                    data-testid={`business-setup-telegram-command-response-${activeIdx}`}
                  />
                </div>
              )
            ) : null}
          </div>
        ) : null}
      </div>

      {/* Hidden button for programmatic save/testing compatibility */}
      <button
        type="button"
        onClick={saveSettings}
        className="sr-only"
        data-testid="business-setup-telegram-save-settings"
        aria-hidden="true"
      />

      {/* Validation feedback: ONLY shown when user clicks Save & Continue / submits */}
      {showValidation && validationError ? (
        <p
          className="text-xs font-semibold text-red-600"
          data-testid="business-setup-telegram-validation-error"
        >
          {validationError}
        </p>
      ) : null}
      {error ? (
        <p className="text-xs font-semibold text-red-600">
          {error}
        </p>
      ) : null}
    </div>
  );
}

