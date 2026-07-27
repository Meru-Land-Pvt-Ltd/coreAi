import { apiUpload, type ApiResponse } from "@/lib/api";

export type SupportIssueInput = {
  /** The written issue description. May be empty when a document/voice is attached. */
  issue: string;
  name?: string;
  email?: string;
  document?: File | null;
  voice?: Blob | null;
  voiceName?: string;
  voiceDurationSec?: number;
};

/**
 * Submit a public "Need Help" request. Sent as multipart/form-data so the
 * optional document and recorded voice message ride along with the text.
 */
export function submitSupportIssue(
  input: SupportIssueInput
): Promise<ApiResponse<{ issue: { id: string; createdAt: string } }>> {
  const form = new FormData();
  form.append("issue", input.issue ?? "");

  if (input.name?.trim()) form.append("name", input.name.trim());
  if (input.email?.trim()) form.append("email", input.email.trim());
  if (input.document) form.append("document", input.document, input.document.name);
  if (input.voice) form.append("voice", input.voice, input.voiceName ?? "voice-message.webm");
  if (typeof input.voiceDurationSec === "number") {
    form.append("voiceDurationSec", String(Math.max(0, Math.round(input.voiceDurationSec))));
  }

  return apiUpload<{ issue: { id: string; createdAt: string } }>("/support/issues", form);
}
