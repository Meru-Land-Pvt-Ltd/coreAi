import type { ApiErrorStatus } from "./error-utils";

export class AppError extends Error {
  public readonly statusCode: ApiErrorStatus;
  public readonly code: string;

  constructor(message: string, statusCode: ApiErrorStatus = 500, code = "APP_ERROR") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}
