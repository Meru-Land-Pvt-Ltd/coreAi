import axios from "axios";

// NEXT_PUBLIC_API_URL must be set per environment (e.g. https://triven.ai/api in
// production). The localhost fallback exists only so a bare local checkout runs.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  /** HTTP status of a failed response (when available) — useful for diagnostics. */
  status?: number;
  data?: T;
};

type ApiErrorPayload<T> = Partial<ApiResponse<T>> & {
  message?: unknown;
  error?: unknown;
  code?: unknown;
};

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json"
  },
  timeout: 15000
});

apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("coreai-token");

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }

  return config;
});

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeAxiosError<T>(error: unknown): ApiResponse<T> {
  if (axios.isAxiosError<ApiErrorPayload<T>>(error)) {
    const responseData = error.response?.data;
    const serverError = stringValue(responseData?.error);
    const serverMessage = stringValue(responseData?.message);
    const code = stringValue(responseData?.code);

    return {
      success: false,
      error:
        serverError ??
        serverMessage ??
        stringValue(error.message) ??
        "Something went wrong while connecting to server",
      code: code ?? "API_ERROR",
      status: error.response?.status
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : "Unexpected error occurred",
    code: "UNKNOWN_ERROR"
  };
}

export async function apiPost<T>(
  path: string,
  body: object
): Promise<ApiResponse<T>> {
  try {
    const response = await apiClient.post<ApiResponse<T>>(path, body);
    return response.data;
  } catch (error) {
    return normalizeAxiosError<T>(error);
  }
}

export async function apiGet<T>(
  path: string,
  token?: string
): Promise<ApiResponse<T>> {
  try {
    const response = await apiClient.get<ApiResponse<T>>(path, {
      headers: token
        ? {
            Authorization: `Bearer ${token}`
          }
        : undefined
    });

    return response.data;
  } catch (error) {
    return normalizeAxiosError<T>(error);
  }
}

export async function apiPatch<T>(
  path: string,
  body: object
): Promise<ApiResponse<T>> {
  try {
    const response = await apiClient.patch<ApiResponse<T>>(path, body);
    return response.data;
  } catch (error) {
    return normalizeAxiosError<T>(error);
  }
}

export async function apiDelete<T>(path: string): Promise<ApiResponse<T>> {
  try {
    const response = await apiClient.delete<ApiResponse<T>>(path);
    return response.data;
  } catch (error) {
    return normalizeAxiosError<T>(error);
  }
}

export async function apiPut<T>(
  path: string,
  body: object
): Promise<ApiResponse<T>> {
  try {
    const response = await apiClient.put<ApiResponse<T>>(path, body);
    return response.data;
  } catch (error) {
    return normalizeAxiosError<T>(error);
  }
}
