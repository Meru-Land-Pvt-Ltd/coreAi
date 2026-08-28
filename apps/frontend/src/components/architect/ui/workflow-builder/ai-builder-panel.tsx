import { useEffect, useRef, useState } from "react";
import {
  aiBuilderChat,
  checkAgent,
  setAgentPurpose,
  smartCompose,
  builderPageHand,
  teachBuilderLesson
} from "@/components/architect/features/api";
import type { DesignChatMessage } from "@/components/architect/features/types";
import { getAuthToken } from "@/lib/auth";
import { BuilderIcon } from "./icons";

/**
 * THE AI BUILDER — one assistant instead of three.
 *
 * The platform had grown three AI faces: the AI Composer built the canvas, the
 * the AI Builder edited the page, and the AI Builder was already a corpse
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
  /* THE BUILDER RAN WHAT IT BUILT. What the check found, in the Builder's
     own lines — or, when it could not run it at all, the honest sentence
     saying so. Never silence. */
  checked?: { lines: Array<{ kind: string; text: string }>; passed: number; failed: number } | null;
  couldNotCheck?: string | null;
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
type GraphPlan = {
  nodes: Array<{ id: string; type: string; title?: string; config?: Record<string, unknown> }>;
  edges: Array<{ from: string; to: string; when?: string }>;
};


/**
 * WHAT THE BUILDER SAW WHEN IT RAN ITS OWN WORK.
 *
 * The Builder has always looked at the customer page it designs. The agent
 * itself it handed over blind — composed, wired, never once run — so the
 * first eyes on a built agent were the architect's. It runs it now, and this
 * is where it says what happened.
 *
 * Three answers, and never a fourth: it ran and it worked · it ran and this
 * did not · it could not run it, and says so. A silent pass is the lie this
 * whole loop exists to prevent.
 */
function builtAndChecked(canvas: ComposedCanvas): string {
  if (canvas.couldNotCheck) return `\n\n${canvas.couldNotCheck}`;
  if (!canvas.checked) return "";

  const { passed, failed, lines } = canvas.checked;
  if (failed === 0 && passed > 0) {
    return `\n\nI ran it ${passed === 1 ? "once" : `${passed} times`} and it did the job.`;
  }
  if (failed > 0) {
    const first = lines.find((line) => line.kind === "problem")?.text;
    return `\n\nI ran it and ${failed === 1 ? "one thing is" : `${failed} things are`} not right yet${first ? `: ${first}` : "."}`;
  }
  return "";
}

async function composeCanvas(
  want: string,
  onStage: (line: string) => void,
  conversation?: Array<{ role: "user" | "assistant"; content: string }>,
  existingPlan?: GraphPlan,
  /* Which canvas this is being built into. The Builder needs it to RUN what
     it just built before it hands it over. */
  workflowId?: string | null
): Promise<{ canvas?: ComposedCanvas; failed?: string; ask?: { question: string; suggestion: string } }> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const token = getAuthToken();

  const response = await fetch(`${base}/architect/compose`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      want,
      ...(conversation?.length ? { conversation } : {}),
      ...(existingPlan ? { existingPlan } : {}),
      ...(workflowId ? { workflowId } : {})
    })
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
      else if (event === "ask")
        /* The third answer: the Builder is asking, proposal in hand. */
        return { ask: { question: String(data.question ?? ""), suggestion: String(data.suggestion ?? "") } };
      else if (event === "failed") return { failed: String(data.message ?? "Nothing was built.") };
    }
  }
  return { failed: "The builder stopped mid-way. Try once more." };
}

/**
 * THE ANSWER, ARRIVING AS IT IS WRITTEN.
 *
 * A person watching a silent box for twenty-five seconds assumes the thing is
 * broken. The compose hand has streamed since the day it shipped; the answer
 * hand caught up on 2026-08-26. Same hand-read SSE as the composer, same
 * lesson included: the token goes in the header, never a cookie.
 */
async function streamAnswer(
  workflowId: string,
  message: string,
  history: DesignChatMessage[],
  onStage: (stage: string) => void,
  onWord: (chunk: string) => void,
  images?: string[]
): Promise<{ hand?: "build" | "page" | "explain"; reply?: string | null; failed?: string }> {
  const base = process.env.NEXT_PUBLIC_API_URL ?? "/api";
  const token = getAuthToken();
  const response = await fetch(`${base}/architect/workflows/${workflowId}/ai-builder/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify({
      message,
      ...(history.length ? { history } : {}),
      ...(images?.length ? { images } : {})
    })
  });
  if (!response.ok || !response.body) return { failed: CHAT_FALLBACK_REPLY };

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
      if (event === "stage") onStage(String(data.stage ?? ""));
      else if (event === "word") onWord(String(data.chunk ?? ""));
      else if (event === "done") return data as { hand?: "build" | "page" | "explain"; reply?: string | null };
      else if (event === "failed") return { failed: String(data.message ?? CHAT_FALLBACK_REPLY) };
    }
  }
  return { failed: CHAT_FALLBACK_REPLY };
}

export function AiBuilderPanel({
  workflowId,
  hasComposedSpec = false,
  canvasHasSteps = true,
  getGraphPlan,
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
  /** The canvas as it stands — for edit asks (the seventh organ). */
  getGraphPlan?: () => GraphPlan;
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
  /* THE BUILDER'S EYES (the founder's ruling, 2026-08-27): pictures attach
     the way they do in any real chat — paste, drag, or pick. Five at a time,
     ten megabytes each, and the browser says so BEFORE the upload rather
     than after a rejection. */
  const [pictures, setPictures] = useState<Array<{ name: string; dataUrl: string }>>([]);
  const [pictureNote, setPictureNote] = useState<string | null>(null);
  /* The Builder's open question: while set, the next message is the ANSWER —
     it rejoins the same build instead of starting a new one. */
  const [buildThread, setBuildThread] = useState<{
    want: string;
    turns: Array<{ role: "user" | "assistant"; content: string }>;
  } | null>(null);
  /* The words as they arrive, and what the platform is doing while it works. */
  const [streamingReply, setStreamingReply] = useState("");
  const [stage, setStage] = useState("");
  /* Teach the Builder — the declared-intent capture of the learning loop. */
  const [teachOpen, setTeachOpen] = useState(false);
  const [teachDraft, setTeachDraft] = useState("");
  const [teachPrivate, setTeachPrivate] = useState(false);
  const [teachSaving, setTeachSaving] = useState(false);
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
  }, [messages, sending, generating, checking, streamingReply, stage]);

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

  /**
   * ONE CALL, NOT THREE (the founder's ruling, 2026-08-27).
   *
   * This used to be a three-hop dance: ask the page designer, and if the ask
   * turned out to be about packaging, ask a third employee. Three round
   * trips, three briefings, three strangers. The Builder owns all of it
   * behind his own door now — he decides which hand and answers once.
   */
  async function handlePage(instruction: string, history: DesignChatMessage[]) {
    if (!workflowId) return;
    const result = await builderPageHand(workflowId, {
      instruction,
      ...(history.length ? { history } : {})
    });
    const data = result.success ? result.data : undefined;
    if (!data) {
      say({ role: "assistant", content: CHAT_FALLBACK_REPLY, local: true });
      return;
    }
    say({
      role: "assistant",
      content: data.reply,
      ...(data.boundary === "packaging" ? { boundary: true } : {})
    });
    onApplied?.({});
  }

  async function handleBuild(want: string, threadOverride?: Array<{ role: "user" | "assistant"; content: string }>) {
    /* THE SEVENTH ORGAN (the founder's ruling, 2026-08-27): a canvas with
       steps means the ask is a CHANGE — the Builder edits, keeping every
       step the architect did not name. The old refusal is gone. */
    const existingPlan = canvasHasSteps ? getGraphPlan?.() : undefined;

    setGenerating(true);
    setProgressStage(0);
    try {
      const thread = threadOverride ?? (buildThread?.want === want ? buildThread.turns : []);
      const { canvas, failed, ask } = await composeCanvas(
        want,
        () => setProgressStage(1),
        thread,
        existingPlan,
        workflowId
      );
      if (canvas) {
        setBuildThread(null);
        say({
          role: "assistant",
          content: `${canvas.message ?? `Built — ${canvas.nodes.length} steps are on your canvas.`}${builtAndChecked(canvas)}`
        });
        onBuilt?.(canvas);
      } else if (ask) {
        /* An employee asking, proposal in hand — the next message answers it. */
        const spoken = ask.suggestion ? `${ask.question}\n\nMy suggestion: ${ask.suggestion}` : ask.question;
        setBuildThread({ want, turns: [...thread, { role: "assistant", content: spoken }] });
        say({ role: "assistant", content: spoken });
      } else {
        setBuildThread(null);
        say({ role: "assistant", content: failed ?? COMPOSE_FALLBACK_REPLY, local: true });
      }
    } catch {
      say({ role: "assistant", content: COMPOSE_FALLBACK_REPLY, local: true });
    } finally {
      setGenerating(false);
    }
  }

  const MAX_PICTURES = 5;
  const MAX_PICTURE_BYTES = 10 * 1024 * 1024;

  async function attachPictures(files: File[]) {
    if (files.length === 0) return;
    const room = MAX_PICTURES - pictures.length;
    if (room <= 0) {
      setPictureNote(`Five pictures at a time is the limit.`);
      return;
    }
    const notes: string[] = [];
    const accepted: Array<{ name: string; dataUrl: string }> = [];
    for (const file of files.slice(0, room)) {
      if (!file.type.startsWith("image/")) {
        notes.push(`${file.name || "That file"} is not a picture.`);
        continue;
      }
      if (file.size > MAX_PICTURE_BYTES) {
        notes.push(`${file.name || "That picture"} is over 10 MB.`);
        continue;
      }
      const dataUrl = await new Promise<string | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (dataUrl) accepted.push({ name: file.name || "screenshot", dataUrl });
    }
    if (files.length > room) notes.push("Five pictures at a time is the limit.");
    if (accepted.length > 0) setPictures((current) => [...current, ...accepted].slice(0, MAX_PICTURES));
    setPictureNote(notes[0] ?? null);
  }

  async function saveLesson() {
    if (!workflowId || teachDraft.trim().length < 8) return;
    setTeachSaving(true);
    const response = await teachBuilderLesson(workflowId, teachDraft.trim(), teachPrivate);
    setTeachSaving(false);
    if (response.success) {
      setTeachDraft("");
      setTeachOpen(false);
      say({
        role: "assistant",
        content: "Learned. From your next build onward I'll remember it — this lesson shapes your work only."
      });
      return;
    }
    say({ role: "assistant", content: response.error ?? "That lesson could not be saved — try again.", local: true });
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
    const trimmed =
      instruction.trim().slice(0, MAX_INSTRUCTION_LENGTH) ||
      (pictures.length > 0 ? "What am I looking at here?" : "");
    if (!trimmed || !chatReady) return;

    /* The Builder asked a question and this is the answer: it rejoins the
       SAME build — routing it anywhere else would turn a conversation into
       an interrogation transcript nobody reads. */
    if (buildThread) {
      say({ role: "user", content: trimmed });
      setDraft("");
      const turns = [...buildThread.turns, { role: "user" as const, content: trimmed }];
      setBuildThread({ want: buildThread.want, turns });
      /* Passed by hand: React state lands after this call would read it. */
      await handleBuild(buildThread.want, turns);
      return;
    }

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
         wrong answer. The reply then arrives word by word, so nobody watches
         a silent box and assumes the machine is dead. */
      setStreamingReply("");
      const attached = pictures.map((picture) => picture.dataUrl);
      setPictures([]);
      setPictureNote(null);
      const streamed = await streamAnswer(
        workflowId,
        trimmed,
        history,
        (stage) => setStage(stage),
        (chunk) => setStreamingReply((current) => current + chunk),
        attached
      );
      setStage("");
      setStreamingReply("");
      const answer = streamed.failed ? undefined : streamed;

      if (!answer) {
        say({ role: "assistant", content: streamed.failed ?? CHAT_FALLBACK_REPLY, local: true });
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

      {/* THE CHAT IS THE PRODUCT, SO THE CHAT GETS THE ROOM.
          Four things used to stand above the conversation, each on its own
          line: the yardstick, a full-width Check my agent, a paragraph
          explaining what the Generate button does, and the Generate button.
          With the input and the Teach link below, six blocks left the
          conversation a thin strip in the middle of a 540-pixel panel — the
          one thing the architect opened the Builder for was the smallest
          thing on the screen.

          They are one quiet row now. Nothing was removed: the yardstick is
          still visible and still one click from changing, both actions are
          still one click away. The paragraph went, because the button beside
          it already says what it does and a screen must never say one thing
          twice. */}
      <div className="mb-2 flex items-center gap-1.5 text-[11px]" data-testid="ai-builder-actions">
        {workflowId && canvasHasSteps ? (
          <button
            type="button"
            onClick={() => void runCheck()}
            disabled={checking || sending || generating}
            data-testid="ai-builder-check"
            className="shrink-0 rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check my agent"}
          </button>
        ) : null}

        {composed ? null : (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={!workflowId || generating}
            data-testid="smart-designer-generate"
            className="shrink-0 rounded-full bg-amber-500 px-2.5 py-1 font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
          >
            {generating ? "Designing…" : "Design the page"}
          </button>
        )}

        {savedPurpose && workflowId ? (
          <button
            type="button"
            data-testid="ai-builder-purpose"
            title={`Testing against: ${savedPurpose}`}
            onClick={() => {
              setAskingPurpose(true);
              say({ role: "assistant", content: "Tell me the new purpose — one sentence." });
            }}
            className="min-w-0 flex-1 truncate rounded-full px-2 py-1 text-left text-slate-400 transition hover:bg-slate-50 hover:text-slate-600"
          >
            vs. <span className="font-semibold text-slate-600">{savedPurpose}</span>
          </button>
        ) : null}
      </div>

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

          {streamingReply ? (
            <div className="flex flex-col items-start" data-testid="smart-designer-streaming">
              <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-xs leading-5 text-slate-800">
                {streamingReply}
                <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-slate-400 align-middle" />
              </p>
            </div>
          ) : null}

          {stage && !streamingReply ? (
            <div className="flex justify-start" data-testid="smart-designer-stage">
              <span className="flex items-center gap-2 rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2">
                <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-400" />
                <span className="text-xs leading-5 text-slate-600">{stage}</span>
              </span>
            </div>
          ) : null}

          {sending && !stage && !streamingReply ? (
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

      {/* The pictures waiting to be sent — small, removable, honest. */}
      {pictures.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-2" data-testid="builder-pictures">
          {pictures.map((picture, index) => (
            <span key={`${picture.name}-${index}`} className="group relative">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={picture.dataUrl}
                alt={picture.name}
                className="h-14 w-14 rounded-lg border border-slate-200 object-cover"
              />
              <button
                type="button"
                aria-label={`Remove ${picture.name}`}
                data-testid={`builder-picture-remove-${index}`}
                onClick={() => setPictures((current) => current.filter((_, at) => at !== index))}
                className="absolute -right-1.5 -top-1.5 grid h-5 w-5 place-items-center rounded-full bg-slate-900 text-[11px] font-bold text-white opacity-0 transition group-hover:opacity-100"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {pictureNote ? (
        <p className="mt-1.5 text-[11px] text-amber-700" data-testid="builder-picture-note">
          {pictureNote}
        </p>
      ) : null}

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void attachPictures(Array.from(event.dataTransfer.files));
        }}
      >
        <label
          data-testid="builder-picture-button"
          title="Add a picture"
          className="grid h-9 w-9 shrink-0 cursor-pointer place-items-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-amber-400 hover:text-amber-600"
        >
          <input
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            data-testid="builder-picture-input"
            onChange={(event) => {
              void attachPictures(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </label>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            /* Paste is how a person actually shares a screenshot. */
            const files = Array.from(event.clipboardData?.files ?? []);
            if (files.length > 0) {
              event.preventDefault();
              void attachPictures(files);
            }
          }}
          placeholder={pictures.length > 0 ? "Say what to look at — or just send" : "Ask anything, or say what to change"}
          maxLength={MAX_INSTRUCTION_LENGTH}
          disabled={(!workflowId && canvasHasSteps) || generating}
          spellCheck={false}
          data-testid="smart-designer-input"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 shadow-none outline-none ring-0 transition-colors placeholder:text-slate-400 focus:border-amber-400 focus:outline-none focus:ring-0 disabled:bg-slate-50"
        />
        <button
          type="submit"
          disabled={!chatReady || (!draft.trim() && pictures.length === 0)}
          data-testid="smart-designer-send"
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-amber-500 text-white transition hover:bg-amber-600 disabled:opacity-40"
        >
          <BuilderIcon name="arrow-right" className="h-4 w-4" />
        </button>
      </form>

      {/* TEACH THE BUILDER — Tier 1 of the self-healing loop. A lesson exists
          only because the architect declares it here; it rides only their own
          future requests, and the terms carry the anonymous-sharing line. */}
      {workflowId ? (
        <div className="mt-2">
          {teachOpen ? (
            <form
              className="rounded-lg border border-slate-200 bg-slate-50 p-2"
              data-testid="builder-teach-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveLesson();
              }}
            >
              <input
                value={teachDraft}
                onChange={(event) => setTeachDraft(event.target.value)}
                maxLength={500}
                placeholder="Next time, do this differently…"
                data-testid="builder-teach-input"
                className="w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-amber-400"
              />
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                  <input
                    type="checkbox"
                    checked={teachPrivate}
                    onChange={(event) => setTeachPrivate(event.target.checked)}
                    data-testid="builder-teach-private"
                  />
                  keep this lesson private to me
                </label>
                <button
                  type="submit"
                  disabled={teachSaving || teachDraft.trim().length < 8}
                  data-testid="builder-teach-save"
                  className="rounded-md bg-amber-500 px-3 py-1 text-[11px] font-semibold text-white transition hover:bg-amber-600 disabled:opacity-40"
                >
                  {teachSaving ? "Saving…" : "Teach it"}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setTeachOpen(true)}
              data-testid="builder-teach-open"
              className="text-[11px] font-medium text-slate-400 hover:text-amber-700"
            >
              Teach the Builder a lesson
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}
