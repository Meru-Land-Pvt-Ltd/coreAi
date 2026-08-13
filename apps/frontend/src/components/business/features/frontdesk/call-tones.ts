import type { PillTone } from "./ui";

export function outcomeTone(outcome: string | null): PillTone {
  const value = (outcome ?? "").toUpperCase();
  if (["BOOKED", "COMPLETED", "RESOLVED", "APPOINTMENT_BOOKED"].includes(value)) return "green";
  if (["MISSED", "FAILED", "ABANDONED", "NO_ANSWER"].includes(value)) return "red";
  if (["ESCALATED", "CALLBACK", "FOLLOW_UP", "TRANSFERRED"].includes(value)) return "amber";
  return "slate";
}

export function sentimentTone(sentiment: string | null): PillTone {
  const value = (sentiment ?? "").toUpperCase();
  if (value === "POSITIVE") return "green";
  if (value === "NEGATIVE") return "red";
  return "slate";
}

export function handoffTone(status: string | null): PillTone {
  const value = (status ?? "").toUpperCase();
  if (value === "CONNECTED" || value === "RESOLVED") return "green";
  if (value === "FAILED" || value === "NO_ANSWER") return "red";
  return "amber";
}
