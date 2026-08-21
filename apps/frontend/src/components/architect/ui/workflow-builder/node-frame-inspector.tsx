"use client";

/**
 * THE NODE FRAME FORM.
 *
 * An architect needs a service Triven has no card for. Rather than waiting for
 * us to write one, they describe it here: where it lives, what key it needs,
 * what comes back. The platform builds the working node from that description
 * and puts it in their toolkit.
 *
 * Two decisions shape this form.
 *
 * It only asks what ONLY THEY can know. Retries, backoff, rate limits, the
 * cost ceiling, the daily self-test, the rollout stage — all of that is filled
 * in with sane defaults, because an architect adding Notion has no opinion
 * about backoff and should not be made to have one.
 *
 * And it never refuses to save. A half-finished description is kept as a draft
 * with its problems listed underneath, so nobody loses twenty minutes of
 * typing to a validation error.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BuilderNode, BuilderNodeData } from "./types";
import { apiPost } from "@/lib/api";

type NodePropsPanel = {
  selectedNode: BuilderNode;
  onUpdateNodeData: (field: keyof BuilderNodeData, value: BuilderNodeData[keyof BuilderNodeData]) => void;
};

type Problem = string;

/** A blank description, with everything an architect should not be asked about already filled in. */
function blankDeclaration(provider: string) {
  const slug = provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "service";
  return {
    id: `${slug}.fetch`,
    version: "1.0.0",
    job: "custom",
    label: `Get things from ${provider || "the service"}`,
    shortLabel: provider || "Service",
    description: "",
    provider: { name: provider, docsUrl: "", apiVersion: "v1", lastVerified: new Date().toISOString().slice(0, 10) },
    needs: { platform: [], architect: [], business: [], accounts: [] },
    produces: [{ key: "results", label: "What came back", kind: "list", required: true, sample: [] }],
    // Everything below is a default the architect never has to think about.
    cost: { style: "per_call", estimateCents: 1, unit: "per call", billedTo: "business" },
    failure: {
      onError: "retry",
      maxRetries: 2,
      backoffMs: 1000,
      neverRetry: [400, 401, 403, 404, 422],
      humanMessage: `${provider || "The service"} could not be reached, so nothing was found this time. It will try again on the next run.`
    },
    limits: { callsPerMinute: 30, callsPerDay: 1000, concurrent: 2, pageSize: 25, maxPages: 5 },
    rules: {},
    health: { everyHours: 24, expectKeys: ["results"], severity: "degrades" },
    execution: "immediate",
    rollout: "canary",
    recipe: { method: "GET", url: "", headers: {}, resultsAt: "" }
  } as Record<string, unknown>;
}

function read(data: Record<string, unknown>, path: string): string {
  let current: unknown = data;
  for (const step of path.split(".")) {
    if (current === null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[step];
  }
  return current === undefined || current === null ? "" : String(current);
}

function write(data: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const steps = path.split(".");
  const next = structuredClone(data);
  let current = next as Record<string, unknown>;
  for (const step of steps.slice(0, -1)) {
    if (typeof current[step] !== "object" || current[step] === null) current[step] = {};
    current = current[step] as Record<string, unknown>;
  }
  current[steps[steps.length - 1]] = value;
  return next;
}

const LABEL = "mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-slate-500";
const INPUT =
  "w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none transition focus:border-amber-300 focus:ring-2 focus:ring-amber-400/40";
const HELP = "mt-1 text-[11px] leading-4 text-slate-400";

export function NodeFrameInspector({ selectedNode, onUpdateNodeData }: NodePropsPanel) {
  const saved = selectedNode.data.frameDeclaration as Record<string, unknown> | undefined;
  const [declaration, setDeclaration] = useState<Record<string, unknown>>(
    () => saved ?? blankDeclaration("")
  );
  const [apiKey, setApiKey] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [status, setStatus] = useState<"idle" | "checking" | "saving" | "trying">("idle");
  const [notice, setNotice] = useState<string | null>(null);
  const [tried, setTried] = useState<{ ok: boolean; message: string; outputs?: unknown } | null>(null);

  const set = useCallback((path: string, value: unknown) => {
    setDeclaration((current) => write(current, path, value));
    setNotice(null);
  }, []);

  /** The key's name is derived, so an architect never has to invent one. */
  const keyName = useMemo(() => {
    const provider = read(declaration, "provider.name");
    const slug = provider.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    return slug ? `${slug}_API_KEY` : "";
  }, [declaration]);

  /* The name drives the id, the labels and the key, so those three can never
     drift apart — and none of them is a question worth asking. */
  const setProvider = useCallback(
    (name: string) => {
      const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "") || "service";
      const upper = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "_");
      setDeclaration((current) => {
        let next = write(current, "provider.name", name);
        next = write(next, "id", `${slug}.fetch`);
        next = write(next, "shortLabel", name.trim() || "Service");
        next = write(next, "label", `Get things from ${name.trim() || "the service"}`);
        next = write(next, "needs.platform", [
          {
            key: `${upper}_API_KEY`,
            label: `${name.trim() || "Service"} key`,
            kind: "api_key",
            help: `The key from your ${name.trim() || "service"} account.`,
            required: true
          }
        ]);
        return next;
      });
      setNotice(null);
    },
    []
  );

  const check = useCallback(async () => {
    setStatus("checking");
    const result = await apiPost<{ problems: string[]; ready: boolean }>(
      "/architect/node-frames/check",
      { declaration }
    );
    setStatus("idle");
    if (result.success && result.data) setProblems(result.data.problems);
  }, [declaration]);

  // Re-check as they type, quietly, so the list shrinks in front of them
  // instead of arriving all at once when they press save.
  useEffect(() => {
    if (!read(declaration, "provider.name")) return;
    const timer = setTimeout(() => void check(), 700);
    return () => clearTimeout(timer);
  }, [declaration, check]);

  const save = useCallback(async () => {
    setStatus("saving");
    const result = await apiPost<{ frameId: string; status: string; problems: string[] }>(
      "/architect/node-frames",
      { declaration, ...(apiKey.trim() ? { secrets: { [keyName]: apiKey.trim() } } : {}) }
    );
    setStatus("idle");
    if (!result.success || !result.data) {
      setNotice(result.error ?? "That could not be saved.");
      return;
    }
    setProblems(result.data.problems);
    setNotice(result.message ?? null);
    if (apiKey.trim()) setApiKey("");

    // The node on the canvas becomes the thing it describes.
    onUpdateNodeData("frameDeclaration" as keyof BuilderNodeData, declaration as never);
    if (result.data.status === "READY") {
      onUpdateNodeData("connectorId" as keyof BuilderNodeData, result.data.frameId as never);
      onUpdateNodeData("nodeKind" as keyof BuilderNodeData, "connector" as never);
      onUpdateNodeData("title" as keyof BuilderNodeData, read(declaration, "label") as never);
      onUpdateNodeData("subtitle" as keyof BuilderNodeData, read(declaration, "description") as never);
    }
  }, [declaration, apiKey, keyName, onUpdateNodeData]);

  const tryIt = useCallback(async () => {
    setStatus("trying");
    setTried(null);
    const result = await apiPost<{ ok: boolean; message: string; outputs: unknown }>(
      `/architect/node-frames/${encodeURIComponent(String(declaration.id))}/try`,
      { config: {} }
    );
    setStatus("idle");
    if (!result.success || !result.data) {
      setTried({ ok: false, message: result.error ?? "It could not be tried just now." });
      return;
    }
    setTried(result.data);
  }, [declaration.id]);

  const ready = problems.length === 0 && Boolean(read(declaration, "provider.name"));

  return (
    <div className="space-y-5" data-testid="node-frame-inspector">
      <div>
        <p className="text-sm font-semibold text-slate-800">Add a new connection</p>
        <p className={HELP}>
          Describe a service Triven does not have yet. When it is ready it becomes a node here, and a card
          in your sidebar for every agent you build after this.
        </p>
      </div>

      <div>
        <label className={LABEL} htmlFor="frame-provider">What is the service called?</label>
        <input
          id="frame-provider"
          value={read(declaration, "provider.name")}
          onChange={(event) => setProvider(event.target.value)}
          placeholder="Notion"
          data-testid="frame-provider"
          className={INPUT}
        />
        <p className={HELP}>The company&apos;s name. This is what your sidebar card will say.</p>
      </div>

      <div>
        <label className={LABEL} htmlFor="frame-description">What does this step do?</label>
        <input
          id="frame-description"
          value={read(declaration, "description")}
          onChange={(event) => set("description", event.target.value)}
          placeholder="Looks up pages in a Notion database."
          data-testid="frame-description"
          className={INPUT}
        />
      </div>

      <div>
        <label className={LABEL} htmlFor="frame-docs">Link to their documentation</label>
        <input
          id="frame-docs"
          value={read(declaration, "provider.docsUrl")}
          onChange={(event) => set("provider.docsUrl", event.target.value)}
          placeholder="https://developers.notion.com"
          data-testid="frame-docs"
          className={INPUT}
        />
        <p className={HELP}>So whoever fixes this in a year knows where to look.</p>
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">The request</p>

        <div className="flex gap-2">
          <select
            value={read(declaration, "recipe.method") || "GET"}
            onChange={(event) => set("recipe.method", event.target.value)}
            data-testid="frame-method"
            className="w-28 rounded-lg border border-gray-200 px-2 py-2 text-sm outline-none focus:border-amber-300"
          >
            {["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => (
              <option key={method} value={method}>{method}</option>
            ))}
          </select>
          <input
            value={read(declaration, "recipe.url")}
            onChange={(event) => set("recipe.url", event.target.value)}
            placeholder="https://api.notion.com/v1/databases/{{config.databaseId}}/query"
            data-testid="frame-url"
            className={INPUT}
          />
        </div>
        <p className={HELP}>
          Copy the address from their documentation. Anything the business will fill in goes in double
          braces, like <code>{"{{config.databaseId}}"}</code>.
        </p>

        <div className="mt-3">
          <label className={LABEL} htmlFor="frame-results">Where is the answer in their reply?</label>
          <input
            id="frame-results"
            value={read(declaration, "recipe.resultsAt")}
            onChange={(event) => set("recipe.resultsAt", event.target.value)}
            placeholder="results"
            data-testid="frame-results-at"
            className={INPUT}
          />
          <p className={HELP}>
            The name of the part that holds what you want — <code>results</code>, or{" "}
            <code>data.items</code>. Leave empty to take the whole reply.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 p-3">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-wide text-slate-500">The key</p>
        <label className={LABEL} htmlFor="frame-header">Which header does the key go in?</label>
        <input
          id="frame-header"
          value={Object.keys((declaration.recipe as Record<string, unknown>)?.headers as object ?? {})[0] ?? ""}
          onChange={(event) => {
            const header = event.target.value.trim();
            set("recipe.headers", header ? { [header]: `Bearer {{credentials.${keyName}}}` } : {});
          }}
          placeholder="Authorization"
          data-testid="frame-key-header"
          className={INPUT}
        />
        <p className={HELP}>Usually <code>Authorization</code>. Their documentation says which.</p>

        <div className="mt-3">
          <label className={LABEL} htmlFor="frame-key">Your key</label>
          <input
            id="frame-key"
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder="Paste it here"
            data-testid="frame-key"
            className={INPUT}
          />
          <p className={HELP}>
            Encrypted, and never shown again. A business installing your agent can use their own instead.
          </p>
        </div>
      </div>

      {problems.length > 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3" data-testid="frame-problems">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
            Still to sort out
          </p>
          <ul className="mt-2 space-y-1.5">
            {problems.map((problem) => (
              <li key={problem} className="text-[13px] leading-5 text-slate-700">• {problem}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {ready ? (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-[13px] font-medium text-emerald-800" data-testid="frame-ready">
          This is ready. Save it and it joins your toolkit.
        </p>
      ) : null}

      {notice ? <p className="text-[13px] text-slate-600" data-testid="frame-notice">{notice}</p> : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void save()}
          disabled={status !== "idle"}
          data-testid="frame-save"
          className="flex-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-50"
        >
          {status === "saving" ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => void tryIt()}
          disabled={status !== "idle" || !ready}
          data-testid="frame-try"
          className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-gray-50 disabled:opacity-40"
        >
          {status === "trying" ? "Trying…" : "Try it"}
        </button>
      </div>

      {tried ? (
        <div
          className={`rounded-xl border p-3 ${tried.ok ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}
          data-testid="frame-try-result"
        >
          <p className="text-[13px] font-medium text-slate-800">{tried.message}</p>
          {tried.outputs ? (
            <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-white/70 p-2 text-[11px] leading-4 text-slate-600">
              {JSON.stringify(tried.outputs, null, 2).slice(0, 2000)}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
