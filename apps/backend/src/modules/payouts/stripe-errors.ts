import Stripe from "stripe";

export type NormalizedStripeError = {
  code: string;
  userMessage: string;
  internalMessage: string;
  retryable: boolean;
  httpStatus: 402 | 409 | 422 | 429 | 500 | 503;
  stripeType: string | null;
  stripeCode: string | null;
  stripeRequestId: string | null;
};

const CONNECT_NOT_ACTIVATED_PATTERN =
  /signed up for Connect|activate(?:d)? Stripe Connect|Connect platform account/i;

export function normalizeStripeError(error: unknown, operation: string): NormalizedStripeError {
  const base = {
    stripeType: null as string | null,
    stripeCode: null as string | null,
    stripeRequestId: null as string | null
  };

  if (error instanceof Stripe.errors.StripeError) {
    base.stripeType = error.type;
    base.stripeCode = error.code ?? null;
    base.stripeRequestId = error.requestId ?? null;
    const internalMessage = `[${operation}] ${error.type}${error.code ? `/${error.code}` : ""}: ${error.message}`;

    if (CONNECT_NOT_ACTIVATED_PATTERN.test(error.message)) {
      return {
        code: "STRIPE_CONNECT_NOT_ACTIVATED",
        userMessage:
          "Payouts are temporarily unavailable because Stripe Connect is not configured. Contact platform support.",
        internalMessage,
        retryable: false,
        httpStatus: 503,
        ...base
      };
    }

    switch (error.type) {
      case "StripeAuthenticationError":
      case "StripePermissionError":
        return {
          code: "STRIPE_TEMPORARILY_UNAVAILABLE",
          userMessage: "Payouts are temporarily unavailable. Please contact support.",
          internalMessage,
          retryable: false,
          httpStatus: 503,
          ...base
        };
      case "StripeRateLimitError":
        return {
          code: "STRIPE_RATE_LIMITED",
          userMessage: "Too many requests to the payment service. Please try again in a moment.",
          internalMessage,
          retryable: true,
          httpStatus: 429,
          ...base
        };
      case "StripeConnectionError":
      case "StripeAPIError":
        return {
          code: "STRIPE_TEMPORARILY_UNAVAILABLE",
          userMessage: "The payment service is temporarily unavailable. Please try again shortly.",
          internalMessage,
          retryable: true,
          httpStatus: 503,
          ...base
        };
      case "StripeIdempotencyError":
        return {
          code: "PAYOUT_ALREADY_PROCESSING",
          userMessage: "This request is already being processed. Please refresh and check its status.",
          internalMessage,
          retryable: false,
          httpStatus: 409,
          ...base
        };
      case "StripeCardError":
        return {
          code: "PAYOUT_METHOD_UNAVAILABLE",
          userMessage: "The payout account could not accept this request. Check your payout method in Stripe.",
          internalMessage,
          retryable: false,
          httpStatus: 402,
          ...base
        };
      case "StripeInvalidRequestError": {
        if (error.code === "balance_insufficient") {
          return {
            code: "INSUFFICIENT_AVAILABLE_BALANCE",
            userMessage:
              "The available Stripe balance is not sufficient for this request yet. Please try again after funds settle.",
            internalMessage,
            retryable: true,
            httpStatus: 422,
            ...base
          };
        }
        return {
          code: "PAYOUT_REQUEST_INVALID",
          userMessage: "The payout request could not be processed. Please refresh and try again.",
          internalMessage,
          retryable: false,
          httpStatus: 422,
          ...base
        };
      }
      default:
        return {
          code: "INTERNAL_PAYOUT_ERROR",
          userMessage: "The payout could not be completed. Please try again or contact support.",
          internalMessage,
          retryable: false,
          httpStatus: 500,
          ...base
        };
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    code: "INTERNAL_PAYOUT_ERROR",
    userMessage: "Something went wrong while processing the payout. Please try again.",
    internalMessage: `[${operation}] ${message}`,
    retryable: false,
    httpStatus: 500,
    ...base
  };
}

export function logStripeError(
  normalized: NormalizedStripeError,
  context: Record<string, string | number | boolean | null | undefined>
) {
  console.error("[payouts]", {
    code: normalized.code,
    retryable: normalized.retryable,
    stripeType: normalized.stripeType,
    stripeCode: normalized.stripeCode,
    stripeRequestId: normalized.stripeRequestId,
    internalMessage: normalized.internalMessage,
    ...context
  });
}
