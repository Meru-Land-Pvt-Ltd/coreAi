import { apiClient } from "@/lib/api";

function authHeaders(): HeadersInit | undefined {
  const token =
    localStorage.getItem("coreai-token") || localStorage.getItem("coreai_token");
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

async function fetchInvoiceHtml(invoiceId: string): Promise<string> {
  const base = apiClient.defaults.baseURL ?? "";
  const response = await fetch(`${base}/payments/invoice/${invoiceId}/html`, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error("FETCH_FAILED");
  }

  return response.text();
}

async function fetchInvoicePdfBlob(invoiceId: string): Promise<Blob> {
  const base = apiClient.defaults.baseURL ?? "";
  const response = await fetch(`${base}/payments/invoice/${invoiceId}/pdf`, {
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
  const blob = await fetchInvoicePdfBlob(invoiceId);
  triggerBlobDownload(blob, filename);
}

/** Open invoice in a new tab and show the print dialog — does not affect current page. */
export async function openInvoiceForPrint(invoiceId: string): Promise<void> {
  const printWindow = window.open("about:blank", "_blank");

  if (!printWindow) {
    throw new Error("POPUP_BLOCKED");
  }

  printWindow.document.open();
  printWindow.document.write(
    `<!DOCTYPE html><html><head><title>Invoice</title></head><body style="margin:0;padding:24px;background:#f1f5f9;font-family:system-ui,sans-serif"><p style="color:#64748b;">Preparing invoice…</p></body></html>`
  );
  printWindow.document.close();

  try {
    const html = await fetchInvoiceHtml(invoiceId);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);

    printWindow.location.href = url;

    printWindow.onload = () => {
      printWindow.focus();
      printWindow.print();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    };
  } catch (error) {
    printWindow.close();
    throw error;
  }
}
