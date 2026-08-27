"use client";

/**
 * THE DOCUMENTATION — every step, in a person's words.
 *
 * The founder's ruling (2026-08-27): "Every big platform has documentation —
 * AWS, Google Cloud, Instantly. Most architects will want to drag and drop
 * and wire it themselves, and there is no section like this on our whole
 * platform."
 *
 * Every page here is GENERATED from the node's own row — the same row the
 * panel draws itself from — so a page can never drift from the software, and
 * a node added next year documents itself the day its row ships.
 *
 * The shape follows the order a person actually asks: what is it · what it
 * needs · what it gives · what YOU fill in · what the BUSINESS answers ·
 * what Triven caps · and the written wisdom about when to use it.
 */

import { useEffect, useMemo, useState } from "react";
import { apiGet } from "@/lib/api";

type DocSetting = {
  name: string;
  whatItsFor: string;
  type: string;
  filledBy: string;
  default: string;
  limits: string | null;
};

type NodeDoc = {
  type: string;
  title: string;
  element: string;
  oneLine: string;
  wisdom: string | null;
  needs: string[];
  gives: string[];
  yourSettings: DocSetting[];
  businessAnswers: DocSetting[];
  platformLimits: DocSetting[];
  hasDoors: boolean;
  parked: string | null;
};

const ELEMENT_BLURB: Record<string, string> = {
  Trigger: "What wakes your agent up",
  Face: "What your customer sees",
  Brain: "How it thinks",
  Hand: "How it acts in the world",
  Connection: "How it reaches another service"
};

function SettingTable({ title, note, settings }: { title: string; note: string; settings: DocSetting[] }) {
  if (settings.length === 0) return null;
  return (
    <div className="mt-6">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{title}</p>
      <p className="mt-1 text-[13px] text-slate-500">{note}</p>
      <div className="mt-3 overflow-hidden rounded-xl border border-gray-200">
        {settings.map((setting, index) => (
          <div
            key={setting.name}
            className={`px-4 py-3 ${index > 0 ? "border-t border-gray-100" : ""}`}
            data-testid={`doc-setting-${setting.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            <p className="text-sm font-semibold text-slate-900">{setting.name}</p>
            <p className="mt-0.5 text-[13px] leading-5 text-slate-600">{setting.whatItsFor}</p>
            <p className="mt-1.5 text-[12px] text-slate-400">
              Starts as: {setting.default}
              {setting.limits ? ` · ${setting.limits}` : ""}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Pills({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <code key={item} className="rounded-md bg-slate-100 px-2 py-1 text-[12px] text-slate-700">
            {item}
          </code>
        ))}
      </div>
    </div>
  );
}

export function DocsView() {
  const [docs, setDocs] = useState<NodeDoc[] | null>(null);
  const [search, setSearch] = useState("");
  const [openType, setOpenType] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void apiGet<{ nodes: NodeDoc[] }>("/architect/docs/nodes").then((response) => {
      if (!alive) return;
      if (response.success && response.data) setDocs(response.data.nodes);
      else setDocs([]);
    });
    return () => {
      alive = false;
    };
  }, []);

  const groups = useMemo(() => {
    const query = search.trim().toLowerCase();
    const matching = (docs ?? []).filter(
      (doc) =>
        !query ||
        doc.title.toLowerCase().includes(query) ||
        doc.oneLine.toLowerCase().includes(query) ||
        doc.type.toLowerCase().includes(query)
    );
    const byElement = new Map<string, NodeDoc[]>();
    for (const doc of matching) {
      byElement.set(doc.element, [...(byElement.get(doc.element) ?? []), doc]);
    }
    return [...byElement.entries()];
  }, [docs, search]);

  if (!docs) {
    return <p className="p-8 text-sm text-slate-500">Loading…</p>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-10" data-testid="architect-docs">
      <h1 className="text-3xl font-black tracking-tight text-slate-900">Docs</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
        Every step you can put on a canvas: what it does, what it needs, what it gives back, and
        exactly which boxes are yours to fill in and which the business answers when they install
        your agent.
      </p>

      <input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search steps…"
        data-testid="docs-search"
        className="mt-6 w-full rounded-xl border border-gray-200 px-4 py-3 text-sm text-slate-800 outline-none focus:border-amber-400"
      />

      {groups.length === 0 ? (
        <p className="mt-8 text-sm text-slate-500" data-testid="docs-empty">
          Nothing matches “{search}”.
        </p>
      ) : null}

      {groups.map(([element, items]) => (
        <section key={element} className="mt-10">
          <h2 className="text-lg font-bold text-slate-900">{element}</h2>
          <p className="mt-0.5 text-[13px] text-slate-500">{ELEMENT_BLURB[element] ?? ""}</p>

          <div className="mt-4 space-y-2">
            {items.map((doc) => {
              const open = openType === doc.type;
              return (
                <div
                  key={doc.type}
                  className={`overflow-hidden rounded-2xl border ${doc.parked ? "border-gray-200 bg-slate-50" : "border-gray-200 bg-white"}`}
                  data-testid={`doc-${doc.type.replace(/[._]/g, "-")}`}
                >
                  <button
                    type="button"
                    onClick={() => setOpenType(open ? null : doc.type)}
                    className="flex w-full items-start justify-between gap-4 px-5 py-4 text-left transition hover:bg-slate-50"
                  >
                    <span className="min-w-0">
                      <span className="flex items-center gap-2">
                        <span className={`text-sm font-bold ${doc.parked ? "text-slate-500" : "text-slate-900"}`}>
                          {doc.title}
                        </span>
                        {doc.parked ? (
                          <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-500">
                            Asleep
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-5 text-slate-600">{doc.oneLine}</span>
                    </span>
                    <span className="mt-1 shrink-0 text-slate-400">{open ? "−" : "+"}</span>
                  </button>

                  {open ? (
                    <div className="border-t border-gray-100 px-5 pb-6 pt-4">
                      {doc.parked ? (
                        <p className="mb-4 rounded-xl bg-slate-100 px-4 py-3 text-[13px] leading-5 text-slate-600">
                          This step is asleep: {doc.parked}
                        </p>
                      ) : null}

                      {doc.wisdom ? (
                        <p className="whitespace-pre-line text-[13px] leading-6 text-slate-700">{doc.wisdom}</p>
                      ) : null}

                      <Pills label="It needs" items={doc.needs} />
                      <Pills label="It gives" items={doc.gives} />

                      <SettingTable
                        title="You fill these in"
                        note="Set once, for every business that installs your agent."
                        settings={doc.yourSettings}
                      />
                      <SettingTable
                        title="The business answers these"
                        note="Asked on their setup screen when they install it — never your job."
                        settings={doc.businessAnswers}
                      />
                      <SettingTable
                        title="Triven caps these"
                        note="Platform limits an admin sets. You cannot change them, and they protect the bill."
                        settings={doc.platformLimits}
                      />

                      {doc.hasDoors ? (
                        <p className="mt-6 text-[13px] leading-5 text-slate-500">
                          This step has smart doors: it understands what arrives in plain language, so you
                          rarely have to describe the shape of the data.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
