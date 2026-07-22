import { apiClient, apiPost, type ApiResponse } from "@/lib/api";

export const DPA_FILE_NAME = "Triven_Data_Processing_Agreement_v1.1_PreSigned.pdf";

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
    const response = await apiClient.get<Blob>("/legal/dpa.pdf?v=1.1-branded-2", {
      responseType: "blob"
    });
    const url = URL.createObjectURL(response.data);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = DPA_FILE_NAME;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return { success: true } as ApiResponse<never>;
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not download the DPA"
    };
  }
}
