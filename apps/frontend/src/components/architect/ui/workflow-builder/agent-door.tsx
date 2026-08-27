"use client";

/**
 * THE DOOR — what an architect meets when they press Preview.
 *
 * The founder's ruling (2026-08-27): the old preview was born believing every
 * agent has a web page — a Telegram agent got dressed in a chat costume, with
 * a Chat/Voice/Create/Form toy bar underneath. A paying customer meeting that
 * doesn't complain; he leaves.
 *
 * So what stands behind the one Preview button is a JUDGEMENT (wayInFor, in
 * shared — deterministic, exam-guarded): a Telegram agent is met as its bot,
 * an email agent as a test email, a chat-app agent honestly, an empty canvas
 * honestly. Page agents and clock agents keep their existing, already-honest
 * rooms (the customer page and the Business Mirror) — this file holds the
 * doors that never existed.
 */

import { useState } from "react";
import type { WayIn } from "@coreai/shared";
import type { ArchitectTelegramTestConnection } from "@/components/architect/features/api";
import type { WorkflowRunLog } from "@/components/architect/features/types";

/* ------------------------------- the run log ------------------------------ */

function LogList({ logs, running }: { logs: WorkflowRunLog[]; running: boolean }) {
  if (logs.length === 0 && !running) return null;
  return (
    <div className="mt-4 rounded-2xl border border-gray-200 bg-white p-4" data-testid="agent-door-log">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {running ? "Running…" : "Last run"}
      </p>
      <div className="mt-2 space-y-1.5">
        {logs.map((log, index) => (
          <div key={`${log.nodeId}-${index}`} className="flex items-start gap-2">
            <span
              className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                log.status === "error" ? "bg-red-500" : "bg-emerald-500"
              }`}
            />
            <p className="min-w-0 text-[12px] leading-5 text-slate-600">
              <span className="font-medium text-slate-800">{log.label}</span>
              {log.message ? ` — ${log.message}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ the doors --------------------------------- */

export function AgentDoor({
  way,
  agentName,
  telegram,
  onConnectTelegram,
  onDisconnectTelegram,
  telegramBusy,
  logs,
  running,
  onRun,
  testEmail,
  onTestEmailChange
}: {
  way: WayIn;
  agentName: string;
  telegram?: ArchitectTelegramTestConnection | null;
  onConnectTelegram?: (botToken: string) => void;
  onDisconnectTelegram?: () => void;
  telegramBusy?: boolean;
  logs: WorkflowRunLog[];
  running: boolean;
  onRun: () => void;
  testEmail?: string;
  onTestEmailChange?: (value: string) => void;
}) {
  const [token, setToken] = useState("");

  return (
    <div className="absolute inset-0 overflow-y-auto bg-slate-50" data-testid="agent-door">
      <div className="mx-auto w-full max-w-xl px-6 py-10">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
          How people meet {agentName || "this agent"}
        </p>
        <p className="mt-1 text-sm leading-6 text-slate-600" data-testid="agent-door-why">
          {way.why}
        </p>

        {way.kind === "telegram" ? (
          telegram?.connected ? (
            <>
              <div className="mt-5 rounded-2xl border border-emerald-200 bg-white p-4" data-testid="agent-door-telegram-connected">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                  Test bot connected
                </p>
                <p className="mt-1 text-sm font-medium text-slate-800">
                  @{telegram.botUsername ?? "your bot"}
                </p>
                <p className="mt-1 text-[13px] leading-5 text-slate-600">
                  Open it and say hi — your agent answers right in the chat.
                </p>
                {telegram.botUrl ? (
                  <a
                    href={telegram.botUrl}
                    target="_blank"
                    rel="noreferrer"
                    data-testid="agent-door-telegram-open"
                    className="mt-3 inline-flex items-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    Open the bot
                  </a>
                ) : null}
                {telegram.lastMessage ? (
                  <p className="mt-3 border-t border-gray-100 pt-3 text-[12px] leading-5 text-slate-500">
                    Last message: “{telegram.lastMessage}”
                    {telegram.lastSender ? ` — ${telegram.lastSender}` : ""}
                  </p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onDisconnectTelegram}
                data-testid="agent-door-telegram-disconnect"
                className="mt-3 text-[12px] font-medium text-slate-400 underline-offset-4 hover:text-slate-600 hover:underline"
              >
                Disconnect this test bot
              </button>
            </>
          ) : (
            <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4" data-testid="agent-door-telegram-connect">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Try it for real
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Connect a test bot and message it — your agent answers in the chat itself.
              </p>
              <input
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="Bot token from @BotFather"
                data-testid="agent-door-telegram-token"
                className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
              />
              <button
                type="button"
                disabled={token.trim().length < 20 || telegramBusy}
                onClick={() => onConnectTelegram?.(token.trim())}
                data-testid="agent-door-telegram-connect-button"
                className="mt-3 inline-flex items-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {telegramBusy ? "Connecting…" : "Connect test bot"}
              </button>
              <p className="mt-2 text-[11px] leading-4 text-slate-400">
                In Telegram: message @BotFather, send /newbot, paste the token here. Two minutes.
              </p>
            </div>
          )
        ) : null}

        {way.kind === "email" ? (
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4" data-testid="agent-door-email">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Try it here</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              Run once with a sample email — and if a reply is sent, put your address here to
              receive the real thing.
            </p>
            <input
              value={testEmail ?? ""}
              onChange={(event) => onTestEmailChange?.(event.target.value)}
              placeholder="you@yourmail.com"
              data-testid="agent-door-test-email"
              className="mt-3 w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-amber-400"
            />
            <button
              type="button"
              disabled={running}
              onClick={onRun}
              data-testid="agent-door-run"
              className="mt-3 inline-flex items-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {running ? "Running…" : "Run once"}
            </button>
          </div>
        ) : null}

        {way.kind === "whatsapp" || way.kind === "calendly" ? (
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-4" data-testid="agent-door-generic">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Try it here</p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {way.kind === "whatsapp"
                ? "The live WhatsApp number connects when a business installs this agent. Here, run once with a sample message and watch every step."
                : "Live booking events arrive when a business connects Calendly at setup. Here, run once with a sample event and watch every step."}
            </p>
            <button
              type="button"
              disabled={running}
              onClick={onRun}
              data-testid="agent-door-run"
              className="mt-3 inline-flex items-center rounded-xl bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
            >
              {running ? "Running…" : "Run once"}
            </button>
          </div>
        ) : null}

        {way.kind === "empty" ? (
          <div className="mt-5 rounded-2xl border border-gray-200 bg-white p-6 text-center" data-testid="agent-door-empty">
            <p className="text-sm leading-6 text-slate-600">
              Describe your product to the AI Builder and it takes shape here.
            </p>
          </div>
        ) : null}

        <LogList logs={logs} running={running} />
      </div>
    </div>
  );
}
