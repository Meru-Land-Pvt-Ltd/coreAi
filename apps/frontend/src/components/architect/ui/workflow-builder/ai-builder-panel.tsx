import { useEffect, useRef, useState } from "react";
import {
  aiBuilderChat,
  checkAgent,
  productChat,
  setAgentPurpose,
  smartCompose,
  smartDesignerChat
} from "@/components/architect/features/api";
import type { DesignChatMessage } from "@/components/architect/features/types";
import { getAuthToken } from "@/lib/auth";
import { BuilderIcon } from "./icons";

/**
 * THE AI BUILDER — one assistant instead of three.
 *
 * The platform had grown three AI faces: the AI Composer built the canvas, the
 * Smart Designer edited the page, and the Design Brain was already a corpse
 * with its name still on things. Three boxes, three names — and none of them
 * knew what the other two did, or what the architect's last run said. Nobody's
 * friend works like that; ChatGPT is one box that hears everything.
 *
 * The founder proved the missing hand himself: he briefed a Brain wrongly, the
 * agent echoed his words back, and the only reason he did not walk away is
 * that a person was in the room to read the run and name the mistake. An
 * architect alone gets nobody — until this box.
 *
 * One face, many hands. Every message goes to the platform's router first,
 * which answers with the hand it belongs to:
 *
 *   build    → the compose engine that already builds canvases
 *   page     → the interface engine that already edits the page
 *   explain  → the platform reads the canvas and the last runs, and answers
 *              in plain words — the mistake, and the box to fix
 *
 * The engines were never the problem. The three faces were. The old
 * `smart-designer-*` test ids are kept on purpose: renaming working test ids
 * is how Playwright suites rot.
 */

const COMPOSE_FALLBACK_REPLY =
  "I couldn't design the interface just now. Give it a moment and try again.";
const CHAT_FALLBACK_REPLY = "That one didn't go through — give it another try in a moment.";
const MAX_INSTRUCTION_LENGTH = 500;
const MAX_HISTORY_TURNS = 10;

const PROGRESS_STAGES = ["Reading your workflow…", "Designing the interface…"] as const;
const PROGRESS_STAGE_SWITCH_MS = 1500;

/** What the compose engine hands back when it builds a canvas. */
export type ComposedCanvas = {
  name?: string;
  workflowId?: string;
  nodes: unknown[];
  edges: unknown[];
  message?: string;
};

type BuilderBubble = {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** The reply was a packaging redirect — shown as a quiet note, not a fix. */
  boundary?: boolean;
  /** Compose replies carry the merge count so the win is visible. */
  merged?: number;
  /** Local fallback line (send failed) — never sent back as history. */
  local?: boolean;
};

let messageCounter = 0;
function nextMessageId(): string {
  messageCounter += 1;
  return `ai-builder-message-${messageCounter}`;
}

/**
 * The compose engine, spoken to the only way it can be — a hand-read SSE
 * stream (ported verbatim from the old composer panel, 401 lesson included:
 * the token goes in the header, never a cookie).
 */
async function composeCanvas(
  want: string,
  onStage: (line: string) => void
): Promise<{ canvas?: ComposedCanvas; failed?: string }> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const token = getAuthToken();

  const response = await fetch(`${base}/architect/compose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({ want })
  });

  if (!response.ok || !response.body) {
    return { failed: "The builder could not start. Try once more." };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const chunk = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");

      const event = /^event:\s*(.+)$/m.exec(chunk)?.[1]?.trim();
      const dataLine = /^data:\s*(.+)$/m.exec(chunk)?.[1];
      if (!event || !dataLine) continue;

      let data: Record<string, unknown>;
      try {
        data = JSON.parse(dataLine) as Record<string, unknown>;
      } catch {
        continue;
      }

      if (event === "progress") onStage(String(data.step ?? ""));
      else if (event === "done") return { canvas: data as unknown as ComposedCanvas };
      else if (event === "failed") return { failed: String(data.message ?? "Nothing was built.") };
    }
  }
  return { failed: "The builder stopped mid-way. Try once more." };
}

export function AiBuilderPanel({
  workflowId,
  hasComposedSpec = false,
  canvasHasSteps = true,
  purpose = "",
  onApplied,
  onBuilt,
  onPurposeSaved
}: {
  /** Saved workflow id — null while a brand-new agent has not autosaved yet. */
  workflowId: string | null;
  /** True when a composed spec already exists (product blocks on the graph). */
  hasComposedSpec?: boolean;
  /** False only on a blank canvas, where "build me…" may compose from scratch. */
  canvasHasSteps?: boolean;
  /** What the architect said they are building — the yardstick every check
   *  tallies against. Empty until they answer the one question. */
  purpose?: string;
  /** Called after the page engine lands a change so the preview refetches. */
  onApplied?: (result: { graphChanged?: boolean }) => void;
  /** Called with the composed canvas when the build hand runs. */
  onBuilt?: (canvas: ComposedCanvas) => void;
  /** Called when the purpose is saved — the builder's own autosave writes the
   *  description too, and must learn the new value or clobber it. */
  onPurposeSaved?: (purpose: string) => void;
}) {
  const [messages, setMessages] = useState<BuilderBubble[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progressStage, setProgressStage] = useState(0);
  const [composed, setComposed] = useState(hasComposedSpec);
  const [savedPurpose, setSavedPurpose] = useState(purpose);
  const [checking, setChecking] = useState(false);
  /* The one question, asked once. While the answer is pending, the very next
     message is the purpose — not a chat turn. */
  const [askingPurpose, setAskingPurpose] = useState(false);
  useEffect(() => {
    if (purpose) setSavedPurpose(purpose);
  }, [purpose]);
  // The saved spec loads AFTER this panel mounts — one-way sync, a spec that
  // exists never un-composes the panel.
  useEffect(() => {
    if (hasComposedSpec) setComposed(true);
  }, [hasComposedSpec]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, sending, generating, checking]);

  /* THE ONE QUESTION. Asked once per agent, never again once answered — the
     answer becomes the agent's purpose, and every check tallies against it. */
  const askedRef = useRef(false);
  useEffect(() => {
    if (askedRef.current || savedPurpose || !workflowId || !canvasHasSteps) return;
    askedRef.current = true;
    setAskingPurpose(true);
    say({
      role: "assistant",
      content:
        'One question before anything else — what are we building? One sentence, e.g. "an agent that answers yes/no questions". I will test everything against it.'
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflowId, savedPurpose, canvasHasSteps]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
    };
  }, []);

  /* One box, always open. The old panel locked its chat until an interface was
     generated — which made sense when the chat could ONLY edit the interface,
     and stopped making sense the day it could also explain a run. */
  /* A blank canvas has no workflowId yet — composing is what CREATES it, so
     the build hand must not wait for one. */
  const chatReady = (Boolean(workflowId) || !canvasHasSteps) && !sending && !generating;

  function say(bubble: Omit<BuilderBubble, "id">) {
    setMessages((current) => [...current, { id: nextMessageId(), ...bubble }]);
  }

  async function generate() {
    if (!workflowId || generating || sending) return;

    setGenerating(true);
    setProgressStage(0);
    progressTimerRef.current = setTimeout(() => setProgressStage(1), PROGRESS_STAGE_SWITCH_MS);

    try {
      const result = await smartCompose(workflowId);
      const data = result.success ? result.data : undefined;
      if (data) {
        setComposed(true);
        say({ role: "assistant", content: data.reply, merged: data.merged });
        onApplied?.({});
      } else {
        say({ role: "assistant", content: COMPOSE_FALLBACK_REPLY, local: true });
      }
    } catch {
      say({ role: "assistant", content: COMPOSE_FALLBACK_REPLY, local: true });
    } finally {
      if (progressTimerRef.current) clearTimeout(progressTimerRef.current);
      setGenerating(false);
    }
  }

  /* ----------------------------------------------------------- the hands */

  async function handlePage(instruction: string, history: DesignChatMessage[]) {
    if (!workflowId) return;
    const result = await smartDesignerChat(workflowId, {
      instruction,
      ...(history.length ? { history } : {})
    });
    const data = result.success ? result.data : undefined;
    if (!data) {
      say({ role: "assistant", content: CHAT_FALLBACK_REPLY, local: true });
      return;
    }

    if (data.boundary === "packaging") {
      // Packaging work is not refused, it is ROUTED — the same instruction
      // goes to the packaging brain, and its reply lands here like any other.
      const packaged = await productChat(workflowId, {
        instruction,
        ...(history.length ? { history } : {})
      });
      const pages = packaged.success ? packaged.data : undefined;
      if (!pages) {
        say({ role: "assistant", content: CHAT_FALLBACK_REPLY, local: true });
        return;
      }
      const built = pages.pagesCreated.length;
      say({
        role: "assistant",
        content: built
          ? `${pages.reply} (${built} new ${built === 1 ? "page" : "pages"})`
          : pages.reply,
        boundary: true
      });
      onApplied?.({});
      return;
    }

    say({ role: "assistant", content: data.reply });
    onApplied?.({});
  }

  async function handleBuild(want: string) {
    if (canvasHasSteps) {
      /* Composing REPLACES the canvas. On an agent that already has steps,
         obeying "add a step" by rebuilding everything would destroy an
         afternoon's work — saying so honestly beats doing that. */
      say({
        role: "assistant",
        content:
          "This canvas already has steps, and I don't rebuild working agents from chat yet — that lands next. Drag the step in from the left, or ask me to explain or change the page."
      });
      return;
    }

    setGenerating(true);
    setProgressStage(0);
    try {
      const { canvas, failed } = await composeCanvas(want, () => setProgressStage(1));
      if (canvas) {
        say({
          role: "assistant",
          content: canvas.message ?? `Built — ${canvas.nodes.length} steps are on your canvas.`
        });
        onBuilt?.(canvas);
      } else {
        say({ role: "assistant", content: failed ?? COMPOSE_FALLBACK_REPLY, local: true });
      }
    } catch {
      say({ role: "assistant", content: COMPOSE_FALLBACK_REPLY, local: true });
    } finally {
      setGenerating(false);
    }
  }

  async function runCheck() {
    if (!workflowId || checking || sending || generating) return;
    setChecking(true);
    say({ role: "assistant", content: "Checking — wires first, then I run real tests against your purpose…" });
    try {
      const result = await checkAgent(workflowId);
      const report = result.success ? result.data : undefined;
      if (!report) {
        say({ role: "assistant", content: "The check could not finish. Try once more.", local: true });
        return;
      }
      say({
        role: "assistant",
        content: report.lines
          .map((line) => `${line.kind === "ok" ? "✓" : line.kind === "problem" ? "✗" : "—"} ${line.text}`)
          .join("\n")
      });
    } catch {
      say({ role: "assistant", content: "The check could not finish. Try once more.", local: true });
    } finally {
      setChecking(false);
    }
  }

  async function send(instruction: string) {
    const trimmed = instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH);
    if (!trimmed || !chatReady) return;

    /* No saved agent yet: there is nothing to route on and nothing to explain.
       Every message is a build ask, verbatim. */
    if (!workflowId) {
      say({ role: "user", content: trimmed });
      setDraft("");
      await handleBuild(trimmed);
      return;
    }

    const history: DesignChatMessage[] = messages
      .filter((message) => !message.local)
      .slice(-MAX_HISTORY_TURNS)
      .map((message) => ({ role: message.role, content: message.content }));

    say({ role: "user", content: trimmed });
    setDraft("");

    /* The answer to the one question is the purpose, not a chat turn. */
    if (askingPurpose) {
      setSending(true);
      try {
        const saved = await setAgentPurpose(workflowId, trimmed);
        if (saved.success) {
          setSavedPurpose(trimmed);
          setAskingPurpose(false);
          onPurposeSaved?.(trimmed);
          say({
            role: "assistant",
            content: "Saved — that's our yardstick now. Press Check my agent any time, or ask me anything."
          });
        } else {
          say({ role: "assistant", content: saved.error ?? CHAT_FALLBACK_REPLY, local: true });
        }
      } finally {
        setSending(false);
      }
      return;
    }

    setSending(true);

    try {
      /* The router first: which hand does this message belong to? A router
         that cannot answer routes to "explain" server-side — the cheapest
         wrong answer. */
      const routed = await aiBuilderChat(workflowId, trimmed, history);
      const answer = routed.success ? routed.data : undefined;

      if (!answer) {
        say({ role: "assistant", content: CHAT_FALLBACK_REPLY, local: true });
        return;
      }

      if (answer.hand === "explain") {
        say({ role: "assistant", content: answer.reply ?? CHAT_FALLBACK_REPLY });
      } else if (answer.hand === "page") {
        await handlePage(trimmed, history);
      } else {
        await handleBuild(trimmed);
      }
    } catch {
      say({ role: "assistant", content: CHAT_FALLBACK_REPLY, local: true });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 pb-4 pt-3" data-testid="smart-designer-panel">
      {workflowId || !canvasHasSteps ? null : (
        <p
          className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800"
          data-testid="smart-designer-save-first"
        >
          Your agent is still saving — one moment.
        </p>
      )}

      {/* THE YARDSTICK, NEVER INVISIBLE. The Check once tallied an agent
          against a stale description nobody could see, and the report read as
          pure nonsense. Whatever is being measured against is on screen, with
          the way to change it one click away. */}
      {savedPurpose && workflowId ? (
        <div
          className="mb-2 flex items-start justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2"
          data-testid="ai-builder-purpose"
        >
          <p className="text-[11px] leading-4 text-slate-500">
            Testing against: <span className="font-semibold text-slate-700">{savedPurpose}</span>
          </p>
          <button
            type="button"
            data-testid="ai-builder-purpose-change"
            onClick={() => {
              setAskingPurpose(true);
              say({ role: "assistant", content: "Tell me the new purpose — one sentence." });
            }}
            className="shrink-0 text-[11px] font-semibold text-amber-700 hover:underline"
          >
            change
          </button>
        </div>
      ) : null}

      {workflowId && canvasHasSteps ? (
        <button
          type="button"
          onClick={() => void runCheck()}
          disabled={checking || sending || generating}
          data-testid="ai-builder-check"
          className="mb-3 w-full rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
        >
          {checking ? "Checking your agent…" : "Check my agent"}
        </button>
      ) : null}

      {composed ? null : (
        <div className="mb-3" data-testid="smart-designer-intro">
          <p className="mb-3 text-xs leading-5 text-slate-500">
            I read your whole workflow — every question your steps need answered — and design the
            smallest page that does the job.
          </p>
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!workflowId || generating}
            data-testid="smart-designer-generate"
            className="w-full rounded-lg bg-amber-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            Generate my product&apos;s interface
          </button>
        </div>
      )}

      {messages.length === 0 && !generating ? (
        <p className="min-h-0 flex-1 text-xs leading-5 text-slate-500" data-testid="smart-designer-empty">
          Ask me anything about your agent — &ldquo;why is it just repeating what I type?&rdquo; —
          or tell me what to change on the page.
        </p>
      ) : (
        <div
          ref={listRef}
          data-testid="smart-designer-messages"
          className="mb-1 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1"
        >
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="flex justify-end">
                <p
                  data-testid="smart-designer-message-user"
                  className="max-w-[85%] rounded-2xl rounded-br-md bg-amber-500 px-3 py-2 text-xs leading-5 text-white"
                >
                  {message.content}
                </p>
              </div>
            ) : message.boundary ? (
              <div key={message.id} className="flex flex-col items-start">
                <div
                  data-testid="smart-designer-boundary"
                  className="max-w-[85%] rounded-2xl rounded-bl-md border border-slate-200 bg-slate-50 px-3 py-2"
                >
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Packaging
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-600">{message.content}</p>
                </div>
              </div>
            ) : (
              <div key={message.id} className="flex flex-col items-start">
                <p
                  data-testid="smart-designer-message-assistant"
                  className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-800"
                >
                  {message.content}
                </p>
                {typeof message.merged === "number" && message.merged > 0 ? (
                  <p
                    data-testid="smart-designer-merged"
                    className="mt-1 pl-1 text-[10px] font-semibold text-emerald-600"
                  >
                    {message.merged} inputs merged
                  </p>
                ) : null}
              </div>
            )
          )}

          {generating ? (
            <div className="flex justify-start" data-testid="smart-designer-progress">
              <span className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                <span className="text-xs leading-5 text-slate-600">{PROGRESS_STAGES[progressStage]}</span>
              </span>
            </div>
          ) : null}

          {sending ? (
            <div className="flex justify-start" data-testid="smart-designer-typing">
              <span className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2.5">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400 [animation-delay:300ms]" />
              </span>
            </div>
          ) : null}
        </div>
      )}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask anything, or say what to change"
          maxLength={MAX_INSTRUCTION_LENGTH}
          disabled={(!workflowId && canvasHasSteps) || generating}
          spellCheck={false}
          data-testid="smart-designer-input"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-none outline-none ring-0 transition-colors placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-0 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={!chatReady || !draft.trim()}
          data-testid="smart-designer-send"
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500 text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          <BuilderIcon name="arrow-right" className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
