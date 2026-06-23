import type { Context } from "hono";

export function successResponse<T>(
  c: Context,
  data: T,
  message = "Success",
  status: 200 | 201 = 200
) {
  return c.json(
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
  status: 400 | 401 | 403 | 404 | 409 | 422 | 500 = 400,
  code = "REQUEST_ERROR"
) {
  return c.json(
    {
      success: false,
      error,
      code
    },
    status
  );
}