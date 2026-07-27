type AgentInvoiceAmount = {
  amountCents: number;
  status: string;
  invoiceKind?: string | null;
  invoiceType?: string | null;
};

type ExecutionInvoiceAmount = {
  amountCents: number;
  status: string;
};

const OUTSTANDING_AGENT_STATUSES = new Set([
  "PENDING",
  "PROCESSING",
  "OPEN",
  "OVERDUE"
]);
const SUBSCRIPTION_INVOICE_KINDS = new Set([
  "POST_TRIAL",
  "SUBSCRIPTION_RENEWAL"
]);
const OUTSTANDING_EXECUTION_STATUSES = new Set([
  "PENDING",
  "OPEN",
  "OVERDUE"
]);

export function outstandingSubscriptionCents(
  invoices: AgentInvoiceAmount[]
) {
  return invoices.reduce((sum, invoice) => {
    const status = invoice.status.toUpperCase();
    const kind = (invoice.invoiceKind ?? invoice.invoiceType)?.toUpperCase();
    return OUTSTANDING_AGENT_STATUSES.has(status) &&
      Boolean(kind && SUBSCRIPTION_INVOICE_KINDS.has(kind))
      ? sum + invoice.amountCents
      : sum;
  }, 0);
}

export function outstandingExecutionCents(
  invoices: ExecutionInvoiceAmount[]
) {
  return invoices.reduce(
    (sum, invoice) =>
      OUTSTANDING_EXECUTION_STATUSES.has(invoice.status.toUpperCase())
        ? sum + invoice.amountCents
        : sum,
    0
  );
}
