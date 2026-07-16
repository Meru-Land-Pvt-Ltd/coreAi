import { apiClient, apiPost, type ApiResponse } from "@/lib/api";

export type SignedDpaRequest = {
  fullName?: string;
  company?: string;
  email?: string;
  industry?: string;
  requirements?: string;
};

export function requestSignedDpa(details: SignedDpaRequest = {}) {
  return apiPost<{ requestedAt: string }>("/legal/dpa/requests", details);
}

export async function downloadDpaPdf(): Promise<ApiResponse<never>> {
  try {
    const response = await apiClient.get<Blob>("/legal/dpa.pdf", { responseType: "blob" });
    const url = URL.createObjectURL(response.data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "triven-data-processing-agreement.pdf";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    return { success: true } as ApiResponse<never>;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not download the DPA"
    };
  }
}
