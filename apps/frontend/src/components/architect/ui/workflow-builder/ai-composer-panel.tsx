"use client";

/**
 * BUILD IT FOR ME.
 *
 * The architect types what they want in plain English and watches the
 * orchestration assemble itself out of steps that already exist.
 *
 * The progress list is not decoration. This takes tens of seconds, and a
 * spinner for tens of seconds reads as "it has hung" — so every stage says what
 * is actually happening, including the one where it finds a problem with its
 * own first attempt and fixes it. Watching it correct itself is what makes the
 * result believable.
 */

import { useCallback, useRef, useState } from "react";
import { getAuthToken } from "@/lib/auth";

export type ComposedCanvas = {
  summary: string;
  asksTheBusiness: string[];
  attempts: number;
  nodes: Array<{ id: string; type: string; position: { x: number; y: number }; data: Record<string, unknown> }>;
  edges: Array<{ id: string; source: string; target: string; sourceHandle?: string }>;
};

const EXAMPLES = [
  "An AI receptionist for a dental practice — answers the phone, books appointments in our calendar, and texts anyone we miss.",
  "When someone books on Calendly, text them a reminder the day before.",
  "Every morning, find dental practices in California and add them to my email campaign."
];

/**
 * Why it did not start, in words the person reading them can act on.
 *
 * "That could not be started just now" is the sentence that hid a broken login
 * header for the entire life of this feature. Nobody can do anything with it.
 * Every branch below either tells them what to do, or says plainly that it is
 * our fault and not theirs.
 */
async function reasonFor(response: Response): Promise<string> {
  // The server's own sentence wins whenever it wrote one.
  const fromServer = await response
    .json()
    .then((body: { message?: unknown; error?: unknown }) => {
      const text = body?.message ?? body?.error;
      return typeof text === "string" && text.trim() ? text.trim() : null;
    })
    .catch(() => null);

  if (response.status === 401) {
    return "You have been signed out, so this could not start. Sign in again and your canvas will still be here.";
  }
  if (response.status === 403) {
    return "This account is not allowed to build here. Nothing was changed on your canvas.";
  }
  if (response.status === 422) {
    return fromServer ?? "Tell it a little more about what you want, then try again.";
  }
  if (response.status === 429) {
    return "Too many builds at once. Wait a moment and try again — nothing was changed on your canvas.";
  }
  if (response.status >= 500) {
    return "This failed on our side, not yours. Nothing was changed on your canvas, and we have been told.";
  }
  return fromServer ?? "This could not start. Nothing was changed on your canvas.";
}

export function AiComposerPanel({
  onBuilt,
  onCancel
}: {
  onBuilt: (canvas: ComposedCanvas) => void;
  onCancel: () => void;
}) {
  const [want, setWant] = useState("");
  const [steps, setSteps] = useState<Array<{ step: string; detail?: string }>>([]);
  const [building, setBuilding] = useState(false);
  const [failed, setFailed] = useState<{ message: string; problems: string[] } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const build = useCallback(async () => {
    if (want.trim().length < 8) return;
    setBuilding(true);
    setSteps([]);
    setFailed(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      /*
       * The token, sent the way every other screen sends it.
       *
       * This is read by hand rather than through apiClient because the answer
       * arrives as a stream and axios cannot read one. That is exactly how this
       * request came to be the only one in the architect UI that sent a cookie
       * instead of the token — and the server only ever reads the header, so it
       * refused all seven attempts ever made with a 401. The panel then said
       * "that could not be started", which sounds like the request was at
       * fault, and hid a one-line problem for as long as it existed.
       */
      const base = process.env.NEXT_PUBLIC_API_URL ?? "/api";
      const token = getAuthToken();

      const response = await fetch(`${base}/architect/compose`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ want: want.trim() }),
        signal: controller.signal
      });

      if (!response.ok || !response.body) {
        setFailed({ message: await reasonFor(response), problems: [] });
        setBuilding(false);
        return;
      }

      // Server-sent events, read by hand: one "event:" line, one "data:" line,
      // separated by a blank line.
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

          if (event === "progress") {
            setSteps((current) => {
              const step = String(data.step ?? "");
              const detail = data.detail === undefined ? undefined : String(data.detail);
              // The same stage reported twice (once bare, once with a count)
              // should refine the line, not add a second one.
              const last = current[current.length - 1];
              if (last?.step === step) return [...current.slice(0, -1), { step, detail }];
              return [...current, { step, detail }];
            });
          } else if (event === "done") {
            setBuilding(false);
            onBuilt(data as unknown as ComposedCanvas);
            return;
          } else if (event === "failed") {
            setBuilding(false);
            setFailed({
              message: String(data.message ?? "Nothing was built."),
              problems: Array.isArray(data.problems) ? (data.problems as string[]) : []
            });
            return;
          }
        }
      }
      setBuilding(false);
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return;
      setBuilding(false);
      // A thrown fetch is the network, not the server — say so, because "something
      // went wrong" sends people to support for a lost wifi connection.
      setFailed({
        message: "Could not reach the builder. Check your connection and try again — nothing was changed on your canvas.",
        problems: []
      });
    }
  }, [want, onBuilt]);

  return (
    <div className="w-full" data-testid="ai-composer-panel">
      <h2 className="text-center text-lg font-black tracking-tight text-slate-900">
        Tell me what you want to build
      </h2>
      <p className="mt-1 text-center text-xs leading-5 text-slate-500">
        In your own words. I&apos;ll pick the steps, wire them together and set the conditions.
      </p>

      <textarea
        value={want}
        onChange={(event) => setWant(event.target.value)}
        disabled={building}
        rows={3}
        data-testid="ai-composer-input"
        placeholder="An AI receptionist for a dental practice that answers the phone, books appointments and texts anyone we miss…"
        className="mt-4 w-full resize-y rounded-2xl border border-gray-200 px-4 py-3 text-sm leading-6 outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40 disabled:bg-gray-50"
      />

      {!building && steps.length === 0 && !failed ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setWant(example)}
              data-testid="ai-composer-example"
              className="rounded-full border border-gray-200 px-3 py-1 text-[11px] text-slate-500 transition hover:border-amber-300 hover:bg-amber-50 hover:text-slate-700"
            >
              {example.length > 52 ? `${example.slice(0, 52)}…` : example}
            </button>
          ))}
        </div>
      ) : null}

      {steps.length > 0 ? (
        <ol className="mt-4 space-y-2" data-testid="ai-composer-progress">
          {steps.map((entry, index) => {
            const isLast = index === steps.length - 1;
            const running = building && isLast;
            return (
              <li key={`${entry.step}-${index}`} className="flex items-start gap-2.5">
                <span
                  className={`mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    running ? "bg-amber-100 text-amber-700" : "bg-emerald-100 text-emerald-700"
                  }`}
                  aria-hidden="true"
                >
                  {running ? "•" : "✓"}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium leading-5 text-slate-800">{entry.step}</span>
                  {entry.detail ? (
                    <span className="block text-[11px] leading-4 text-slate-500">{entry.detail}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}

      {failed ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-3" data-testid="ai-composer-failed">
          <p className="text-[13px] leading-5 text-slate-800">{failed.message}</p>
          {failed.problems.length > 0 ? (
            <ul className="mt-2 space-y-1">
              {failed.problems.slice(0, 4).map((problem) => (
                <li key={problem} className="text-[11px] leading-4 text-slate-600">• {problem}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => void build()}
          disabled={building || want.trim().length < 8}
          data-testid="ai-composer-build"
          className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {building ? "Building…" : "Build it"}
        </button>
        <button
          type="button"
          onClick={() => {
            abortRef.current?.abort();
            onCancel();
          }}
          data-testid="ai-composer-cancel"
          className="rounded-xl border border-gray-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-gray-50"
        >
          {building ? "Stop" : "Back"}
        </button>
      </div>
    </div>
  );
}
