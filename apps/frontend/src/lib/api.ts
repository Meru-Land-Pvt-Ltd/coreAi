import axios, { AxiosError } from "axios";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8787";

export type ApiResponse<T> = {
  success: boolean;
  message?: string;
  error?: string;
  code?: string;
  data?: T;
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

function normalizeAxiosError<T>(error: unknown): ApiResponse<T> {
  if (error instanceof AxiosError) {
    const responseData = error.response?.data as Partial<ApiResponse<T>> | undefined;

    return {
      success: false,
      error:
        responseData?.error ??
        error.message ??
        "Something went wrong while connecting to server",
      code: responseData?.code ?? "API_ERROR"
    };
  }

  return {
    success: false,
    error: "Unexpected error occurred",
    code: "UNKNOWN_ERROR"
  };
}

export async function apiPost<T>(
  path: string,
  body: Record<string, unknown>
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
  body: Record<string, unknown>
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
  body: Record<string, unknown>
): Promise<ApiResponse<T>> {
  try {
    const response = await apiClient.put<ApiResponse<T>>(path, body);
    return response.data;
  } catch (error) {
    return normalizeAxiosError<T>(error);
  }
}