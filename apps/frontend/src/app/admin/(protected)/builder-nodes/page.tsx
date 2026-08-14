"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import { ARCHITECT_NODE_GROUP_ORDER } from "@coreai/shared";
import {
  createAdminBuilderGroup,
  deleteAdminBuilderGroup,
  getAdminBuilderNodes,
  updateAdminBuilderNodes,
  type AdminBuilderNode
} from "@/components/admin/features/api";

const ROW_GRID = "grid gap-3 sm:grid-cols-[minmax(0,1fr)_16rem_7.5rem] sm:items-start";
const FIELD_CLASS =
  "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 text-sm text-slate-800 focus:border-amber-300 focus:outline-none focus:ring-4 focus:ring-amber-100 disabled:opacity-50";

type NodeDraft = { label: string; group: string };
type VisibilityFilter = "all" | "visible" | "hidden";

function draftsFromNodes(nodes: AdminBuilderNode[]): Record<string, NodeDraft> {
  return Object.fromEntries(nodes.map((node) => [node.type, { label: node.label, group: node.group }]));
}

function nodeGroup(node: AdminBuilderNode, drafts: Record<string, NodeDraft>): string {
  return drafts[node.type]?.group || node.group;
}

function matchesQuery(node: AdminBuilderNode, draft: NodeDraft | undefined, query: string): boolean {
  if (!query) return true;
  const haystack = [node.label, node.type, node.group, node.defaultLabel, node.defaultGroup, draft?.label, draft?.group]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

export default function AdminBuilderNodesPage() {
  const [nodes, setNodes] = useState<AdminBuilderNode[]>([]);
  const [drafts, setDrafts] = useState<Record<string, NodeDraft>>({});
  const [loading, setLoading] = useState(true);
  const [savingType, setSavingType] = useState<string | null>(null);
  const [savingGroup, setSavingGroup] = useState(false);
  const [addingGroup, setAddingGroup] = useState(false);
  const [deletingGroup, setDeletingGroup] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [createdGroups, setCreatedGroups] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState("all");
  const [visibilityFilter, setVisibilityFilter] = useState<VisibilityFilter>("all");
  const [error, setError] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error" = "success") => {
    setToast({ type, message });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const applyNodes = useCallback((next: AdminBuilderNode[]) => {
    setNodes(next);
    setDrafts(draftsFromNodes(next));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const response = await getAdminBuilderNodes();
    if (!response.success || !response.data) {
      setError(response.error ?? "Could not load builder nodes.");
      setLoading(false);
      return;
    }
    applyNodes(response.data.nodes);
    setCreatedGroups(response.data.groups ?? []);
    setError("");
    setLoading(false);
  }, [applyNodes]);

  useEffect(() => {
    void load();
  }, [load]);

  const groupOptions = useMemo(() => {
    const extras: string[] = [];
    const names = [
      ...createdGroups,
      ...nodes.flatMap((node) => [node.group, node.defaultGroup, drafts[node.type]?.group])
    ];
    for (const name of names) {
      const value = name?.trim();
      if (value && !ARCHITECT_NODE_GROUP_ORDER.includes(value) && !extras.includes(value)) {
        extras.push(value);
      }
    }
    return [...ARCHITECT_NODE_GROUP_ORDER, ...extras];
  }, [createdGroups, drafts, nodes]);

  const query = search.trim().toLowerCase();

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      const group = nodeGroup(node, drafts);
      if (visibilityFilter === "visible" && !node.visible) return false;
      if (visibilityFilter === "hidden" && node.visible) return false;
      if (groupFilter !== "all" && group !== groupFilter) return false;
      return matchesQuery(node, drafts[node.type], query);
    });
  }, [drafts, groupFilter, nodes, query, visibilityFilter]);

  const groups = useMemo(() => {
    const extras: string[] = [];
    for (const name of [
      ...createdGroups,
      ...nodes.map((node) => nodeGroup(node, drafts))
    ]) {
      if (name && !ARCHITECT_NODE_GROUP_ORDER.includes(name) && !extras.includes(name)) extras.push(name);
    }
    const order = [...ARCHITECT_NODE_GROUP_ORDER, ...extras];
    return order
      .map((title) => ({
        title,
        nodes: filteredNodes.filter((node) => nodeGroup(node, drafts) === title)
      }))
      .filter((group) => {
        if (groupFilter !== "all" && group.title !== groupFilter) return false;
        if (group.nodes.length > 0) return true;
        if (query || visibilityFilter !== "all") return false;
        return createdGroups.includes(group.title);
      });
  }, [createdGroups, drafts, filteredNodes, groupFilter, nodes, query, visibilityFilter]);

  async function saveUpdate(
    node: AdminBuilderNode,
    payload: { visible?: boolean; label?: string; group?: string },
    successMessage: string
  ) {
    setSavingType(node.type);
    setError("");
    const response = await updateAdminBuilderNodes([{ type: node.type, ...payload }]);
    if (!response.success || !response.data) {
      showToast(response.error ?? "Could not update builder node.", "error");
      setSavingType(null);
      return false;
    }
    applyNodes(response.data.nodes);
    if (response.data.groups) setCreatedGroups(response.data.groups);
    showToast(successMessage);
    setSavingType(null);
    return true;
  }

  async function toggle(node: AdminBuilderNode) {
    const nextVisible = !node.visible;
    setNodes((current) =>
      current.map((item) => (item.type === node.type ? { ...item, visible: nextVisible } : item))
    );
    const ok = await saveUpdate(
      node,
      { visible: nextVisible },
      nextVisible
        ? `${node.label} is now visible in the architect builder.`
        : `${node.label} is hidden from the architect builder.`
    );
    if (!ok) {
      setNodes((current) =>
        current.map((item) => (item.type === node.type ? { ...item, visible: node.visible } : item))
      );
    }
  }

  function setDraft(type: string, patch: Partial<NodeDraft>) {
    setDrafts((current) => ({
      ...current,
      [type]: { label: current[type]?.label ?? "", group: current[type]?.group ?? "", ...patch }
    }));
  }

  async function saveName(node: AdminBuilderNode) {
    const draft = drafts[node.type] ?? { label: node.label, group: node.group };
    const label = draft.label.trim();
    if (label === node.label) return;
    await saveUpdate(node, { label }, `Saved name for ${label || node.defaultLabel}.`);
  }

  async function saveGroup(node: AdminBuilderNode, group: string) {
    if (group === node.group) return;
    setGroupFilter("all");
    setNodes((current) =>
      current.map((item) => (item.type === node.type ? { ...item, group } : item))
    );
    setDraft(node.type, { group });
    const ok = await saveUpdate(node, { group }, `Moved ${node.label} to ${group}.`);
    if (!ok) {
      setNodes((current) =>
        current.map((item) => (item.type === node.type ? { ...item, group: node.group } : item))
      );
      setDraft(node.type, { group: node.group });
    }
  }

  function closeAddGroup() {
    setAddingGroup(false);
    setNewGroupName("");
  }

  async function addGroup() {
    const group = newGroupName.trim();
    if (!group) {
      showToast("Enter a group name.", "error");
      return;
    }
    setSavingGroup(true);
    const response = await createAdminBuilderGroup(group);
    setSavingGroup(false);
    if (!response.success || !response.data) {
      showToast(response.error ?? "Could not add group.", "error");
      return;
    }
    setCreatedGroups(response.data.groups);
    setGroupFilter(group);
    showToast(`Added group "${group}". Assign nodes from the Group dropdown.`);
    closeAddGroup();
  }

  async function deleteGroup(name: string) {
    setSavingGroup(true);
    const response = await deleteAdminBuilderGroup(name);
    setSavingGroup(false);
    if (!response.success || !response.data) {
      showToast(response.error ?? "Could not delete group.", "error");
      return;
    }
    if (response.data.nodes) applyNodes(response.data.nodes);
    setCreatedGroups(response.data.groups ?? []);
    if (groupFilter === name) setGroupFilter("all");
    const moved = response.data.moved ?? 0;
    showToast(
      moved > 0
        ? `Deleted "${name}" and moved ${moved} node${moved === 1 ? "" : "s"} back to their original group.`
        : `Deleted group "${name}".`
    );
    setDeletingGroup(null);
  }

  const visibleCount = nodes.filter((node) => node.visible).length;

  return (
    <main data-testid="admin-builder-nodes-page" className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900" data-testid="admin-builder-nodes-heading">
          Builder nodes
        </h1>

        {nodes.length > 0 ? (
          <p className="mt-2 text-xs font-semibold text-slate-500 tabular-nums">
            {visibleCount} of {nodes.length} visible
            {filteredNodes.length !== nodes.length ? ` · ${filteredNodes.length} matching filter` : ""}
          </p>
        ) : null}
      </header>

      {error ? (
        <div
          data-testid="admin-builder-nodes-error"
          className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-4" data-testid="admin-builder-nodes-loading">
          {Array.from({ length: 3 }).map((_, index) => (
            <div key={index} className="h-40 animate-pulse rounded-2xl border border-gray-100 bg-white" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1">
              <span className="sr-only">Search builder nodes</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
              <input
                data-testid="admin-builder-nodes-search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name, type, or group…"
                className="h-10 w-full rounded-xl border border-gray-200 bg-white pl-9 pr-3 text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </label>
            <select
              data-testid="admin-builder-nodes-group-filter"
              value={groupFilter}
              onChange={(event) => setGroupFilter(event.target.value)}
              className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm text-slate-700 outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100 lg:w-52"
            >
              <option value="all">All groups</option>
              {groupOptions.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="admin-builder-nodes-add-group"
              onClick={() => {
                setAddingGroup(true);
                setNewGroupName("");
                setError("");
              }}
              className="h-10 shrink-0 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600"
            >
              Add group
            </button>
          </div>

          <div
            className="inline-flex w-fit rounded-xl bg-gray-100 p-1"
            role="group"
            aria-label="Filter by visibility"
            data-testid="admin-builder-nodes-visibility-filter"
          >
            {(
              [
                { value: "all", label: "All" },
                { value: "visible", label: "Visible" },
                { value: "hidden", label: "Hidden" }
              ] as const
            ).map((item) => {
              const selected = visibilityFilter === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  aria-pressed={selected}
                  data-testid={`admin-builder-nodes-visibility-${item.value}`}
                  onClick={() => setVisibilityFilter(item.value)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                    selected ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </div>

          {addingGroup ? (
            <div
              className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
              data-testid="admin-builder-nodes-add-group-modal"
              onClick={closeAddGroup}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-builder-nodes-add-group-title"
                className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-5 shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="admin-builder-nodes-add-group-title" className="text-base font-semibold text-slate-900">
                  Add group
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  The group stays after refresh. Assign nodes from the Group dropdown.
                </p>
                <input
                  autoFocus
                  data-testid="admin-builder-nodes-new-group-input"
                  value={newGroupName}
                  disabled={savingGroup}
                  maxLength={80}
                  placeholder="Group name"
                  onChange={(event) => setNewGroupName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void addGroup();
                    }
                    if (event.key === "Escape") closeAddGroup();
                  }}
                  className={`${FIELD_CLASS} mt-4`}
                />
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="admin-builder-nodes-new-group-cancel"
                    disabled={savingGroup}
                    onClick={closeAddGroup}
                    className="h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="admin-builder-nodes-new-group-save"
                    disabled={savingGroup || !newGroupName.trim()}
                    onClick={() => void addGroup()}
                    className="h-10 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:opacity-50"
                  >
                    {savingGroup ? "Adding…" : "Add"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {deletingGroup ? (
            <div
              className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 p-4"
              data-testid="admin-builder-nodes-delete-group-modal"
              onClick={() => !savingGroup && setDeletingGroup(null)}
            >
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="admin-builder-nodes-delete-group-title"
                className="w-full max-w-sm rounded-2xl border border-gray-100 bg-white p-5 shadow-xl"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="admin-builder-nodes-delete-group-title" className="text-base font-semibold text-slate-900">
                  Delete group
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  Delete <span className="font-semibold text-slate-900">{deletingGroup}</span>? Nodes in this
                  group will go back to their original group.
                </p>
                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    data-testid="admin-builder-nodes-delete-group-cancel"
                    disabled={savingGroup}
                    onClick={() => setDeletingGroup(null)}
                    className="h-10 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-slate-600 transition hover:border-slate-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-testid="admin-builder-nodes-delete-group-confirm"
                    disabled={savingGroup}
                    onClick={() => void deleteGroup(deletingGroup)}
                    className="h-10 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                  >
                    {savingGroup ? "Deleting…" : "Delete"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}

          {groups.length === 0 ? (
            <div
              data-testid="admin-builder-nodes-empty"
              className="rounded-2xl border border-dashed border-gray-200 bg-white p-12 text-center"
            >
              <p className="font-bold text-slate-900">No nodes match</p>
              <p className="mt-1 text-sm text-slate-400">Try a different search or filter.</p>
            </div>
          ) : (
            groups.map((group) => (
              <section
                key={group.title}
                data-testid={`admin-builder-nodes-group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-900">{group.title}</h2>
                  {!ARCHITECT_NODE_GROUP_ORDER.includes(group.title) ? (
                    <button
                      type="button"
                      data-testid={`admin-builder-nodes-delete-group-${group.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                      onClick={() => setDeletingGroup(group.title)}
                      className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-slate-600 transition hover:border-red-200 hover:text-red-600"
                    >
                      Delete
                    </button>
                  ) : null}
                </div>
                {group.nodes.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">
                    No nodes in this group yet. Assign one from the Group dropdown.
                  </p>
                ) : (
                  <>
                    <div className={`mt-4 hidden text-xs font-semibold text-slate-700 sm:grid ${ROW_GRID}`}>
                      <p>Name</p>
                      <p>Group</p>
                      <p>Visible</p>
                    </div>
                    <ul className="mt-1 divide-y divide-gray-50">
                      {group.nodes.map((node) => {
                        const saving = savingType === node.type;
                        const draft = drafts[node.type] ?? { label: node.label, group: node.group };
                        const selectGroups = groupOptions.includes(draft.group)
                          ? groupOptions
                          : [...groupOptions, draft.group];
                        return (
                          <li key={node.type} className={`${ROW_GRID} py-3`}>
                            <div className="min-w-0">
                              <label
                                htmlFor={`builder-node-label-${node.type}`}
                                className="mb-1.5 block text-xs font-semibold text-slate-700 sm:sr-only"
                              >
                                Name
                              </label>
                              <input
                                id={`builder-node-label-${node.type}`}
                                data-testid={`admin-builder-node-label-${node.type}`}
                                value={draft.label}
                                disabled={saving}
                                maxLength={80}
                                onChange={(event) => setDraft(node.type, { label: event.target.value })}
                                onBlur={() => void saveName(node)}
                                className={FIELD_CLASS}
                              />
                              <p className="mt-1 truncate font-mono text-[11px] text-slate-400">{node.type}</p>
                            </div>
                            <div className="min-w-0">
                              <label
                                htmlFor={`builder-node-group-${node.type}`}
                                className="mb-1.5 block text-xs font-semibold text-slate-700 sm:sr-only"
                              >
                                Group
                              </label>
                              <select
                                id={`builder-node-group-${node.type}`}
                                data-testid={`admin-builder-node-group-${node.type}`}
                                value={draft.group}
                                disabled={saving}
                                onChange={(event) => void saveGroup(node, event.target.value)}
                                className={`${FIELD_CLASS} pr-8`}
                              >
                                {selectGroups.map((name) => (
                                  <option key={name} value={name}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <label className="flex h-10 items-center gap-2 text-sm font-semibold text-slate-700">
                              <input
                                type="checkbox"
                                data-testid={`admin-builder-node-toggle-${node.type}`}
                                checked={node.visible}
                                disabled={saving}
                                onChange={() => void toggle(node)}
                                className="h-4 w-4 rounded border-gray-300 text-amber-500 focus:ring-amber-400 disabled:opacity-50"
                              />
                              {node.visible ? "Visible" : "Hidden"}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </section>
            ))
          )}
        </div>
      )}

      {toast ? (
        <div
          className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg"
          role="status"
          data-testid="admin-builder-nodes-toast"
        >
          {toast.type === "success" ? (
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-green-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 6 9 17l-5-5" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-4 w-4 text-red-400" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M15 9 9 15M9 9l6 6" />
            </svg>
          )}
          {toast.message}
        </div>
      ) : null}
    </main>
  );
}
