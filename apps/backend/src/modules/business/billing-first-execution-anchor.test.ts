import { describe, expect, it } from "vitest";
import {
  agentBillingAnchorAt,
  agentBillingPeriodFor,
  type AgentBillingAnchorPayment
} from "./agent-payment-scope";
import { overdueReminderDueNow } from "./billing-cycle";

/**
 * The billing clock starts when the agent starts working.
 *
 * A subscription bought on the 1st but first used on the 10th renews on the
 * 40th day; execution charges accrue PENDING from the first execution and the
 * invoice falls due 30 days later — not 30 days after checkout. Overdue bills
 * are dunned the moment they are overdue and every 7 days after, including
 * after suspension, until paid.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const PURCHASE_AT = new Date("2026-08-01T10:00:00.000Z");
const FIRST_EXECUTION_AT = new Date("2026-08-10T15:30:00.000Z");

const paidPurchase: AgentBillingAnchorPayment = {
  status: "SUCCEEDED",
  invoiceKind: "PURCHASE",
  createdAt: PURCHASE_AT,
  paidAt: PURCHASE_AT,
  periodStart: PURCHASE_AT,
  periodEnd: new Date(PURCHASE_AT.getTime() + 30 * DAY_MS),
  dueAt: null
};

describe("first-execution billing anchor", () => {
  it("anchors on the first execution, beating the paid purchase anniversary", () => {
    const anchor = agentBillingAnchorAt({
      agentCreatedAt: PURCHASE_AT,
      referenceAt: new Date("2026-09-01T00:00:00.000Z"),
      payments: [paidPurchase],
      firstExecutionAt: FIRST_EXECUTION_AT
    });

    expect(anchor).toEqual(FIRST_EXECUTION_AT);
  });

  it("falls back to the payment chain while the agent has never executed", () => {
    const anchor = agentBillingAnchorAt({
      agentCreatedAt: PURCHASE_AT,
      referenceAt: new Date("2026-09-01T00:00:00.000Z"),
      payments: [paidPurchase],
      firstExecutionAt: null
    });

    expect(anchor).toEqual(PURCHASE_AT);
  });

  it("never moves the grid backward: an execution before the payment anchor is ignored", () => {
    // Backfilled history attributed before the entitlement must not resurrect
    // a grid earlier than the purchase.
    const anchor = agentBillingAnchorAt({
      agentCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
      referenceAt: new Date("2026-09-01T00:00:00.000Z"),
      payments: [paidPurchase],
      firstExecutionAt: new Date("2026-07-15T00:00:00.000Z")
    });

    expect(anchor).toEqual(PURCHASE_AT);
  });

  it("keeps a migrated subscriber on the purchase grid its paid renewals were cut on", () => {
    // Pre-migration agent: renewals live on the purchase-anniversary grid. A
    // first execution off that grid must NOT re-anchor — that would generate a
    // renewal overlapping an already-paid window, get it auto-canceled, and
    // permanently block future renewals on its unique invoiceKey.
    const paidRenewal: AgentBillingAnchorPayment = {
      status: "SUCCEEDED",
      invoiceKind: "SUBSCRIPTION_RENEWAL",
      createdAt: new Date(PURCHASE_AT.getTime() + 30 * DAY_MS),
      paidAt: new Date(PURCHASE_AT.getTime() + 30 * DAY_MS),
      periodStart: new Date(PURCHASE_AT.getTime() + 30 * DAY_MS),
      periodEnd: new Date(PURCHASE_AT.getTime() + 60 * DAY_MS),
      dueAt: new Date(PURCHASE_AT.getTime() + 30 * DAY_MS)
    };

    const anchor = agentBillingAnchorAt({
      agentCreatedAt: PURCHASE_AT,
      referenceAt: new Date("2026-11-01T00:00:00.000Z"),
      payments: [paidPurchase, paidRenewal],
      firstExecutionAt: FIRST_EXECUTION_AT
    });

    expect(anchor).toEqual(PURCHASE_AT);
  });

  it("keeps a new agent on the first-execution grid once its renewals are cut on it", () => {
    // Post-migration agent: renewal #1 was created on the first-execution
    // grid. The anchor must stay there — flipping back to the purchase grid
    // would overlap the paid renewal.
    const renewalOnExecutionGrid: AgentBillingAnchorPayment = {
      status: "SUCCEEDED",
      invoiceKind: "SUBSCRIPTION_RENEWAL",
      createdAt: new Date(FIRST_EXECUTION_AT.getTime() + 30 * DAY_MS),
      paidAt: new Date(FIRST_EXECUTION_AT.getTime() + 30 * DAY_MS),
      periodStart: new Date(FIRST_EXECUTION_AT.getTime() + 30 * DAY_MS),
      periodEnd: new Date(FIRST_EXECUTION_AT.getTime() + 60 * DAY_MS),
      dueAt: new Date(FIRST_EXECUTION_AT.getTime() + 30 * DAY_MS)
    };

    const anchor = agentBillingAnchorAt({
      agentCreatedAt: PURCHASE_AT,
      referenceAt: new Date("2026-11-01T00:00:00.000Z"),
      payments: [paidPurchase, renewalOnExecutionGrid],
      firstExecutionAt: FIRST_EXECUTION_AT
    });

    expect(anchor).toEqual(FIRST_EXECUTION_AT);
  });

  it("keeps trial agents payment-anchored — trial time is not counted and post-trial debts already exist", () => {
    const trialEnd = new Date("2026-08-15T10:00:00.000Z");
    const trialPayment: AgentBillingAnchorPayment = {
      status: "COMPLETED",
      invoiceKind: "TRIAL",
      createdAt: PURCHASE_AT,
      paidAt: null,
      periodStart: PURCHASE_AT,
      periodEnd: trialEnd,
      dueAt: null
    };
    const firstPostTrialExecution = new Date(trialEnd.getTime() + 2 * 60 * 60 * 1000);

    const anchor = agentBillingAnchorAt({
      agentCreatedAt: PURCHASE_AT,
      referenceAt: new Date("2026-09-01T00:00:00.000Z"),
      payments: [trialPayment],
      firstExecutionAt: firstPostTrialExecution
    });

    expect(anchor).toEqual(trialEnd);
  });

  it("puts the first usage cycle at firstExecution..+30d, due at cycle end, grace +7d", () => {
    const period = agentBillingPeriodFor(FIRST_EXECUTION_AT, FIRST_EXECUTION_AT);

    expect(period.start).toEqual(FIRST_EXECUTION_AT);
    expect(period.end).toEqual(
      new Date(FIRST_EXECUTION_AT.getTime() + 30 * DAY_MS)
    );
    expect(period.dueAt).toEqual(period.end);
    expect(period.graceEndsAt).toEqual(
      new Date(period.end.getTime() + 7 * DAY_MS)
    );
  });

  it("keys later executions into 30-day cycles counted from the first execution", () => {
    const laterExecution = new Date(
      FIRST_EXECUTION_AT.getTime() + 45 * DAY_MS
    );
    const period = agentBillingPeriodFor(FIRST_EXECUTION_AT, laterExecution);

    expect(period.start).toEqual(
      new Date(FIRST_EXECUTION_AT.getTime() + 30 * DAY_MS)
    );
    expect(period.end).toEqual(
      new Date(FIRST_EXECUTION_AT.getTime() + 60 * DAY_MS)
    );
  });
});

describe("overdue dunning cadence (every 7 days until paid)", () => {
  const dueAt = new Date("2026-08-20T00:00:00.000Z");

  it("emails immediately when a bill goes overdue with no prior reminder", () => {
    expect(overdueReminderDueNow(null, dueAt, dueAt)).toBe(true);
  });

  it("emails immediately when the only prior reminder predates the due date (stale pre-due reminder)", () => {
    const preDueReminder = new Date(dueAt.getTime() - 1 * DAY_MS);
    expect(overdueReminderDueNow(preDueReminder, dueAt, dueAt)).toBe(true);
  });

  it("does not re-email within 7 days of the last overdue reminder", () => {
    const lastReminder = new Date(dueAt.getTime() + 1 * DAY_MS);
    const now = new Date(lastReminder.getTime() + 6 * DAY_MS);
    expect(overdueReminderDueNow(lastReminder, dueAt, now)).toBe(false);
  });

  it("emails again exactly 7 days after the last reminder — and keeps going after suspension", () => {
    const lastReminder = new Date(dueAt.getTime() + 1 * DAY_MS);
    const day7 = new Date(lastReminder.getTime() + 7 * DAY_MS);
    // Day 8+ of overdue is past graceEndsAt, i.e. the agent is suspended by
    // now; the cadence must not stop.
    const day14 = new Date(lastReminder.getTime() + 14 * DAY_MS);

    expect(overdueReminderDueNow(lastReminder, dueAt, day7)).toBe(true);
    expect(overdueReminderDueNow(day7, dueAt, day14)).toBe(true);
  });
});
