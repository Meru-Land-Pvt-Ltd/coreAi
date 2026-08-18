"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BusinessPageHeader } from "@/components/business/business-page-header";
// [DISABLED] BUSINESS_CRM_PATH is commented out in @/lib/routes while the CRM UI
// is turned off. This component is no longer rendered (the /business/crm page is
// inert), so it keeps a local copy of the path to stay type-clean.
// [DISABLED] import { BUSINESS_CRM_PATH, BUSINESS_SETUP_PATH } from "@/lib/routes";
import type { Route } from "next";
import { BUSINESS_SETUP_PATH } from "@/lib/routes";

const BUSINESS_CRM_PATH = "/business/crm" as Route;
import {
  addCrmContactNote,
  disconnectHubSpot,
  getCrmContact,
  getCrmDashboard,
  getCrmProviders,
  getHubSpotOAuthUrl,
  listCrmContacts,
  setActiveCrmProvider,
  updateCrmContact,
  type CrmContact,
  type CrmContactDetail,
  type CrmContactList,
  type CrmContactUpdate,
  type CrmDashboard,
  type CrmProviderEntry
} from "./api";
import { CrmCustomerDrawer } from "./crm-customer-drawer";
import { CrmEmptyConnect } from "./crm-empty-connect";
import { CrmFilters } from "./crm-filters";
import { CrmKpiCards } from "./crm-kpi-cards";
import { CrmProviderSwitcher } from "./crm-provider-switcher";
import { CrmTable } from "./crm-table";
import { relativeTime } from "./crm-format";

/**
 * Buyer CRM page.
 *
 * Triven is the AI layer on top of the customer's CRM — so this page is
 * provider-agnostic in every visible string. The connected pill, the empty
 * state and the switcher all read from /crm/providers; "HubSpot" is never
 * hardcoded in the chrome.
 */

const SEARCH_DEBOUNCE_MS = 300;
const PER_PAGE = 10;

export function CrmPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [providers, setProviders] = useState<CrmProviderEntry[]>([]);
  const [activeProvider, setActiveProvider] = useState<string | null>(null);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [providerBusy, setProviderBusy] = useState<string | null>(null);

  const [dashboard, setDashboard] = useState<CrmDashboard | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(true);

  const [contacts, setContacts] = useState<CrmContactList | null>(null);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [stage, setStage] = useState("");
  const [owner, setOwner] = useState("");
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<CrmContact | null>(null);
  const [detail, setDetail] = useState<CrmContactDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  // OAuth returns here with ?crm=connected|cancelled|error. Consume the param
  // so a refresh does not replay the toast.
  useEffect(() => {
    const outcome = searchParams.get("crm");
    if (!outcome) return;

    if (outcome === "connected") showToast("CRM connected");
    else if (outcome === "cancelled") showToast("CRM connection was cancelled");
    else showToast("Could not finish connecting your CRM");

    router.replace(BUSINESS_CRM_PATH);
  }, [searchParams, router, showToast]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // Any filter change invalidates the page number.
  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, stage, owner]);

  const loadProviders = useCallback(async () => {
    setProvidersLoading(true);
    const result = await getCrmProviders();
    if (result.success && result.data) {
      setProviders(result.data.providers);
      setActiveProvider(result.data.activeProvider);
    }
    setProvidersLoading(false);
  }, []);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders, refreshToken]);

  const connected = useMemo(
    () => providers.some((provider) => provider.connected),
    [providers]
  );

  useEffect(() => {
    if (providersLoading || !connected) {
      setDashboardLoading(false);
      setContactsLoading(false);
      return;
    }

    let active = true;

    async function load() {
      setDashboardLoading(true);
      setContactsLoading(true);
      setLoadError("");

      const [dashboardResult, contactsResult] = await Promise.all([
        getCrmDashboard(),
        listCrmContacts({
          q: debouncedSearch,
          stage: stage || undefined,
          owner: owner || undefined,
          page,
          perPage: PER_PAGE
        })
      ]);

      if (!active) return;

      if (dashboardResult.success && dashboardResult.data) setDashboard(dashboardResult.data);
      setDashboardLoading(false);

      if (contactsResult.success && contactsResult.data) {
        setContacts(contactsResult.data);
      } else {
        setContacts(null);
        setLoadError(contactsResult.error ?? "Could not load CRM data.");
      }
      setContactsLoading(false);
      setRefreshing(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [connected, providersLoading, debouncedSearch, stage, owner, page, refreshToken]);

  // Filter options come from the loaded rows — the CRM owns the vocabulary,
  // so hardcoding stage names here would drift from the portal.
  const stageOptions = useMemo(
    () => unique((contacts?.items ?? []).map((contact) => contact.stage)),
    [contacts]
  );
  const ownerOptions = useMemo(
    () => unique((contacts?.items ?? []).map((contact) => contact.owner)),
    [contacts]
  );

  const activeEntry = providers.find((provider) => provider.id === activeProvider) ?? null;
  const activeName = activeEntry?.name ?? "CRM";

  async function handleConnect(providerId: string) {
    if (providerId !== "HUBSPOT") {
      const entry = providers.find((provider) => provider.id === providerId);
      showToast(`${entry?.name ?? "This CRM"} connection coming soon`);
      return;
    }

    setProviderBusy(providerId);
    const result = await getHubSpotOAuthUrl(BUSINESS_CRM_PATH);
    setProviderBusy(null);

    if (result.success && result.data?.url) {
      window.location.assign(result.data.url);
      return;
    }
    showToast(result.error ?? "Could not start the CRM connection");
  }

  async function handleProviderChange(providerId: string) {
    if (!providerId || providerId === activeProvider) return;

    const entry = providers.find((provider) => provider.id === providerId);
    if (!entry) return;

    if (entry.status !== "live") {
      showToast(`${entry.name} connection coming soon`);
      return;
    }

    if (!entry.connected) {
      // Not connected yet: switch the empty state to this provider instead of
      // failing the PATCH.
      setActiveProvider(providerId);
      showToast(`Connect ${entry.name} to use it for customer context`);
      return;
    }

    setProviderBusy(providerId);
    const result = await setActiveCrmProvider(providerId);
    setProviderBusy(null);

    if (result.success) {
      setActiveProvider(providerId);
      showToast(`Using ${entry.name} for customer context`);
      setRefreshToken((token) => token + 1);
      return;
    }
    showToast(result.error ?? "Could not switch CRM");
  }

  async function handleDisconnect() {
    const result = await disconnectHubSpot();
    if (result.success) {
      showToast(`${activeName} disconnected`);
      setContacts(null);
      setDashboard(null);
      setRefreshToken((token) => token + 1);
      return;
    }
    showToast(result.error ?? "Could not disconnect");
  }

  async function openContact(contact: CrmContact, startEditing = false) {
    setSelected(contact);
    setDetail(null);
    setEditing(startEditing);
    setDetailLoading(true);

    const result = await getCrmContact(contact.id);
    if (result.success && result.data) setDetail(result.data);
    setDetailLoading(false);
  }

  async function handleSaveContact(changes: CrmContactUpdate) {
    if (!selected) return;

    setSaving(true);
    const result = await updateCrmContact(selected.id, changes);
    setSaving(false);

    if (!result.success || !result.data) {
      showToast(result.error ?? "Could not save customer details");
      return;
    }

    const updated = result.data.contact;

    // Optimistic-style local update so the drawer and the row behind it agree
    // without a full refetch.
    setSelected(updated);
    setDetail((current) => (current ? { ...current, ...updated } : current));
    setContacts((current) =>
      current
        ? {
            ...current,
            items: current.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item))
          }
        : current
    );
    setEditing(false);
    showToast(result.message ?? "Customer details saved");
  }

  async function handleAddNote(body: string) {
    if (!selected || !body) return;

    setSavingNote(true);
    const result = await addCrmContactNote(selected.id, body);
    setSavingNote(false);

    if (!result.success) {
      showToast(result.error ?? "Could not add the note");
      return;
    }

    showToast("Note added");
    const refreshed = await getCrmContact(selected.id);
    if (refreshed.success && refreshed.data) setDetail(refreshed.data);
  }

  return (
    <main className="min-w-0 w-full max-w-full overflow-x-hidden p-3 sm:p-4 lg:p-5">
      <BusinessPageHeader
        className="-mx-3 -mt-3 mb-6 sm:-mx-4 sm:-mt-4 sm:mb-8 lg:-mx-5 lg:-mt-5"
        title="CRM"
        description="Manage customer relationships and AI-powered customer context"
        actions={
          <>
            <CrmProviderSwitcher
              providers={providers}
              activeProvider={activeProvider}
              busy={Boolean(providerBusy)}
              onChange={handleProviderChange}
            />

            {connected ? (
              <span
                data-testid="business-crm-connection-status"
                className="hidden items-center gap-2 rounded-full border border-green-100 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 sm:inline-flex"
              >
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {activeName} Connected
              </span>
            ) : (
              <span
                data-testid="business-crm-connection-status"
                className="hidden items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 sm:inline-flex"
              >
                <span className="h-2 w-2 rounded-full bg-slate-300" />
                {activeName} not connected
              </span>
            )}

            {dashboard?.lastSyncedAt ? (
              <span
                data-testid="business-crm-last-sync"
                className="hidden text-sm font-medium text-slate-600 md:inline"
              >
                Last sync {relativeTime(dashboard.lastSyncedAt)}
              </span>
            ) : null}

            {connected ? (
              <button
                type="button"
                onClick={handleDisconnect}
                data-testid="business-crm-disconnect"
                className="rounded-xl border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
              >
                Disconnect
              </button>
            ) : null}
          </>
        }
      />

      {providersLoading ? (
        <div
          className="h-80 animate-pulse rounded-2xl border border-gray-100 bg-white"
          data-testid="business-crm-loading"
        />
      ) : !connected ? (
        <CrmEmptyConnect
          providers={providers}
          busyProviderId={providerBusy}
          onConnect={handleConnect}
          onComingSoon={(provider) => showToast(`${provider.name} connection coming soon`)}
        />
      ) : (
        <>
          <CrmKpiCards dashboard={dashboard} loading={dashboardLoading} />

          <CrmFilters
            search={search}
            onSearchChange={setSearch}
            stage={stage}
            onStageChange={setStage}
            stageOptions={stageOptions}
            owner={owner}
            onOwnerChange={setOwner}
            ownerOptions={ownerOptions}
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              setRefreshToken((token) => token + 1);
            }}
          />

          {loadError ? (
            <p
              data-testid="business-crm-error"
              className="mt-4 rounded-2xl border border-red-100 bg-red-50 p-5 text-sm font-semibold text-red-700"
            >
              {loadError}
            </p>
          ) : (
            <CrmTable
              contacts={contacts?.items ?? []}
              pagination={contacts?.pagination ?? null}
              loading={contactsLoading}
              stale={contacts?.stale}
              onOpen={(contact) => void openContact(contact)}
              onEdit={(contact) => void openContact(contact, true)}
              onPageChange={setPage}
            />
          )}
        </>
      )}

      {selected ? (
        <CrmCustomerDrawer
          contact={selected}
          detail={detail}
          loading={detailLoading}
          editing={editing}
          saving={saving}
          savingNote={savingNote}
          onClose={() => {
            setSelected(null);
            setDetail(null);
            setEditing(false);
          }}
          onStartEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onSave={(changes) => void handleSaveContact(changes)}
          onAddNote={(body) => void handleAddNote(body)}
          onBookAppointment={() => router.push(BUSINESS_SETUP_PATH)}
        />
      ) : null}

      {toast ? (
        <div
          data-testid="business-crm-toast"
          className="fixed bottom-6 left-1/2 z-[90] flex -translate-x-1/2 items-center gap-2 rounded-xl bg-slate-900 px-5 py-3 text-sm font-medium text-white shadow-lg"
        >
          {toast}
        </div>
      ) : null}
    </main>
  );
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value?.trim())))].sort();
}
