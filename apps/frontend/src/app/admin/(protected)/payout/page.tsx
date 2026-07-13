"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getAdminPayoutSales,
  getAdminPayoutSummary,
  updateAdminPayoutSaleStatus,
  type AdminPayoutSale,
  type AdminPayoutSummary
} from "@/components/admin/features/api";

function formatUsd(cents: number) {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function statusClass(status: AdminPayoutSale["architectEarningStatus"]) {
  if (status === "PENDING") return "bg-amber-50 text-amber-700";
  if (status === "APPROVED") return "bg-green-50 text-green-700";
  return "bg-red-50 text-red-700";
}

const STATUS_FILTERS = ["all", "PENDING", "APPROVED", "REJECTED"] as const;

export default function AdminPayoutPage() {
  const [summary, setSummary] = useState<AdminPayoutSummary | null>(null);
  const [rows, setRows] = useState<AdminPayoutSale[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("PENDING");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [limit] = useState(20);
  const [loading, setLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<AdminPayoutSale | null>(null);
  const [message, setMessage] = useState("");

  const loadSummary = useCallback(async () => {
    const result = await getAdminPayoutSummary();
    if (result.success && result.data) {
      setSummary(result.data);
    }
  }, []);

  const loadSales = useCallback(async () => {
    setLoading(true);
    const result = await getAdminPayoutSales({
      search: search.trim(),
      status: statusFilter === "all" ? undefined : statusFilter,
      page,
      limit
    });

    if (result.success && result.data) {
      setRows(result.data.items);
      setTotal(result.data.total);
    }

    setLoading(false);
  }, [limit, page, search, statusFilter]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    void loadSales();
  }, [loadSales]);

  async function reviewSale(paymentId: string, status: "APPROVED" | "REJECTED") {
    setActingId(paymentId);
    setMessage("");

    const result = await updateAdminPayoutSaleStatus(paymentId, status);
    if (!result.success) {
      setMessage(result.error ?? "Could not update payout status.");
      setActingId(null);
      return;
    }

    setMessage(status === "APPROVED" ? "Architect earnings approved." : "Architect earnings rejected.");
    setSelectedSale(null);
    setActingId(null);
    await Promise.all([loadSummary(), loadSales()]);
  }

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900" data-testid="admin-payout-title">
          Architect Payouts
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Review marketplace sales, approve architect earnings, and mark rejected payouts.
        </p>
      </header>

      {summary ? (
        <section className="mb-6 grid gap-4 md:grid-cols-3" data-testid="admin-payout-summary">
          <SummaryCard
            label="Pending review"
            value={String(summary.pendingSalesCount)}
            hint={formatUsd(summary.pendingEarningsCents)}
            testId="admin-payout-pending"
          />
          <SummaryCard
            label="Approved earnings"
            value={String(summary.approvedSalesCount)}
            hint={formatUsd(summary.approvedEarningsCents)}
            testId="admin-payout-approved"
          />
          <SummaryCard
            label="Rejected"
            value={String(summary.rejectedSalesCount)}
            hint={formatUsd(summary.rejectedEarningsCents)}
            testId="admin-payout-rejected"
          />
        </section>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void loadSales();
        }}
        className="mb-4 flex flex-wrap gap-2"
      >
        <input
          data-testid="admin-payout-search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search architect, agent, or buyer"
          className="w-full max-w-md rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        />
        <select
          data-testid="admin-payout-status-filter"
          value={statusFilter}
          onChange={(event) => {
            setStatusFilter(event.target.value as (typeof STATUS_FILTERS)[number]);
            setPage(1);
          }}
          className="rounded-xl border border-orange-200 bg-white px-4 py-2 text-sm outline-none focus:border-orange-400"
        >
          {STATUS_FILTERS.map((status) => (
            <option key={status} value={status}>
              {status === "all" ? "All statuses" : status}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-xl bg-orange-500 px-4 py-2 text-sm font-bold text-white">
          Search
        </button>
      </form>

      {message ? (
        <p data-testid="admin-payout-message" className="mb-3 text-sm font-semibold text-orange-700">
          {message}
        </p>
      ) : null}

      {loading ? (
        <p data-testid="admin-payout-loading" className="text-sm font-semibold text-orange-700">
          Loading payout sales…
        </p>
      ) : rows.length === 0 ? (
        <p data-testid="admin-payout-empty" className="text-sm font-semibold text-slate-500">
          No payout sales found.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-orange-100 bg-white">
          <table data-testid="admin-payout-table" className="w-full text-left text-sm">
            <thead className="border-b border-orange-100 text-xs uppercase tracking-wider text-slate-400">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Architect</th>
                <th className="px-4 py-3">Agent</th>
                <th className="px-4 py-3">Buyer</th>
                <th className="px-4 py-3">Gross</th>
                <th className="px-4 py-3">Architect share</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <tr key={sale.paymentId} className="border-b border-orange-50" data-testid={`admin-payout-row-${sale.paymentId}`}>
                  <td className="px-4 py-3 text-slate-500">{new Date(sale.date).toLocaleDateString()}</td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-slate-900">{sale.architect.fullName ?? "—"}</p>
                    <p className="text-xs text-slate-500">{sale.architect.email}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{sale.listingName}</td>
                  <td className="px-4 py-3">
                    <p className="text-slate-700">{sale.businessName}</p>
                    <p className="text-xs text-slate-500">{sale.buyerEmail}</p>
                  </td>
                  <td className="px-4 py-3 font-mono text-slate-700">{formatUsd(sale.grossCents)}</td>
                  <td className="px-4 py-3 font-mono font-semibold text-green-700">{formatUsd(sale.earningsCents)}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${statusClass(sale.architectEarningStatus)}`}>
                      {sale.architectEarningStatus}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        data-testid={`admin-payout-details-${sale.paymentId}`}
                        onClick={() => setSelectedSale(sale)}
                        className="rounded-lg border border-orange-200 px-3 py-1.5 text-xs font-semibold text-orange-800 hover:bg-orange-50"
                      >
                        Details
                      </button>
                      {sale.architectEarningStatus === "PENDING" ? (
                        <>
                          <button
                            type="button"
                            disabled={actingId === sale.paymentId}
                            data-testid={`admin-payout-approve-${sale.paymentId}`}
                            onClick={() => void reviewSale(sale.paymentId, "APPROVED")}
                            className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            disabled={actingId === sale.paymentId}
                            data-testid={`admin-payout-reject-${sale.paymentId}`}
                            onClick={() => void reviewSale(sale.paymentId, "REJECTED")}
                            className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                          >
                            Reject
                          </button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-sm text-slate-500" data-testid="admin-payout-pagination">
          Page {page} of {totalPages} · {total} sales
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            data-testid="admin-payout-prev-page"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            className="rounded-lg border border-orange-200 px-3 py-1.5 text-sm font-semibold text-orange-800 disabled:opacity-40"
          >
            Prev
          </button>
          <button
            type="button"
            data-testid="admin-payout-next-page"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
            className="rounded-lg border border-orange-200 px-3 py-1.5 text-sm font-semibold text-orange-800 disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>

      {selectedSale ? (
        <PayoutDetailsModal
          sale={selectedSale}
          acting={actingId === selectedSale.paymentId}
          onClose={() => setSelectedSale(null)}
          onApprove={() => void reviewSale(selectedSale.paymentId, "APPROVED")}
          onReject={() => void reviewSale(selectedSale.paymentId, "REJECTED")}
        />
      ) : null}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  hint,
  testId
}: {
  label: string;
  value: string;
  hint: string;
  testId: string;
}) {
  return (
    <div className="rounded-2xl border border-orange-100 bg-white p-5" data-testid={testId}>
      <p className="text-sm font-semibold text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black text-slate-900">{value}</p>
      <p className="mt-1 text-sm font-semibold text-orange-700">{hint}</p>
    </div>
  );
}

function PayoutDetailsModal({
  sale,
  acting,
  onClose,
  onApprove,
  onReject
}: {
  sale: AdminPayoutSale;
  acting: boolean;
  onClose: () => void;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" data-testid={`admin-payout-modal-${sale.paymentId}`}>
      <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Payout details</h2>
            <p className="mt-1 text-sm text-slate-500">{sale.listingName} sold to {sale.businessName}</p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-gray-100">
            ×
          </button>
        </div>

        <div className="mt-5 space-y-3 text-sm">
          <DetailRow label="Architect" value={`${sale.architect.fullName ?? "—"} (${sale.architect.email})`} />
          <DetailRow label="Buyer" value={`${sale.businessName} (${sale.buyerEmail})`} />
          <DetailRow label="Gross sale" value={formatUsd(sale.grossCents)} />
          <DetailRow label={`Architect share (${sale.architectSharePercent}%)`} value={formatUsd(sale.earningsCents)} />
          <DetailRow label="Purchase status" value={sale.purchaseStatus} />
          <DetailRow label="Payout status" value={sale.architectEarningStatus} />
          {sale.reviewedAt ? <DetailRow label="Reviewed at" value={new Date(sale.reviewedAt).toLocaleString()} /> : null}
          {sale.architect.payoutMethod ? (
            <div className="rounded-xl border border-orange-100 bg-orange-50 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-orange-700">Payout method</p>
              <p className="mt-2 font-semibold text-slate-900">{sale.architect.payoutMethod.bankName}</p>
              <p className="text-slate-600">{sale.architect.payoutMethod.accountHolderName}</p>
              <p className="font-mono text-xs text-slate-500">Account •••• {sale.architect.payoutMethod.accountLast4}</p>
              <p className="font-mono text-xs text-slate-500">IFSC {sale.architect.payoutMethod.ifscCode}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-amber-800">
              Architect has not added a payout method yet.
            </p>
          )}
        </div>

        {sale.architectEarningStatus === "PENDING" ? (
          <div className="mt-6 flex justify-end gap-3">
            <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700">
              Close
            </button>
            <button
              type="button"
              disabled={acting}
              data-testid={`admin-payout-modal-reject-${sale.paymentId}`}
              onClick={onReject}
              className="rounded-xl border border-red-200 px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
            >
              Reject
            </button>
            <button
              type="button"
              disabled={acting}
              data-testid={`admin-payout-modal-approve-${sale.paymentId}`}
              onClick={onApprove}
              className="rounded-xl bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {acting ? "Saving…" : "Approve & mark paid"}
            </button>
          </div>
        ) : (
          <div className="mt-6 flex justify-end">
            <button type="button" onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-slate-700">
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 pb-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-semibold text-slate-800">{value}</span>
    </div>
  );
}
