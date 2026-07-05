import type { Context } from "hono";
import type { ApiErrorStatus } from "./error-utils";

export type ApiSuccessBody<T> = {
  success: true;
  message: string;
  data: T;
};

export type ApiErrorBody = {
  success: false;
  error: string;
  code: string;
};

export function successResponse<T>(
  c: Context,
  data: T,
  message = "Success",
  status: 200 | 201 = 200
) {
  return c.json<ApiSuccessBody<T>>(
    {
      success: true,
      message,
      data
    },
    status
  );
}

export function errorResponse(
  c: Context,
  error: string,
  status: ApiErrorStatus = 400,
  code = "REQUEST_ERROR"
) {
  return c.json<ApiErrorBody>(
    {
      success: false,
      error,
      code
    },
    status
  );
}
