import { apiPost } from "@/lib/api";

export type ContactSubject =
  | "general"
  | "business-support"
  | "architect-support"
  | "partnership"
  | "bug-report";

export function submitContactSubmission(body: {
  name: string;
  email: string;
  subject: ContactSubject;
  message: string;
}) {
  return apiPost<{ submission: { id: string; createdAt: string } }>("/contact/submissions", body);
}
