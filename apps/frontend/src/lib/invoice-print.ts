import { apiClient } from "@/lib/api";

function authHeaders(): HeadersInit | undefined {
  const token =
    localStorage.getItem("coreai-token") || localStorage.getItem("coreai_token");
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function fetchPdfBlob(path: string): Promise<Blob> {
  const base = apiClient.defaults.baseURL ?? "";
  const response = await fetch(`${base}${path}`, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error("FETCH_FAILED");
  }

  return response.blob();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Download invoice PDF — fetches from backend, no DOM/style changes on the page. */
export async function downloadInvoicePdf(invoiceId: string, filename: string): Promise<void> {
  const blob = await fetchPdfBlob(`/payments/invoice/${invoiceId}/pdf`);
  triggerBlobDownload(blob, filename);
}

/**
 * A monthly usage bill. These are a different record from an agent purchase
 * and live behind a different address — "Download all invoices" used to walk
 * the purchases only and skip every one of these without saying so.
 */
export async function downloadUsageInvoicePdf(
  invoiceId: string,
  filename: string
): Promise<void> {
  const blob = await fetchPdfBlob(`/business/billing/usage-invoices/${invoiceId}/pdf`);
  triggerBlobDownload(blob, filename);
}
