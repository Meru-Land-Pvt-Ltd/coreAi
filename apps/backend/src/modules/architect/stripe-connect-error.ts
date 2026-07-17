export type StripeConnectConfigurationError = {
  message: string;
  status: 503;
  code: "STRIPE_CONNECT_NOT_ACTIVATED";
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Stripe could not complete the request";
}

export function stripeConnectConfigurationError(error: unknown): StripeConnectConfigurationError | null {
  const message = errorMessage(error);

  if (/signed up for Connect|activate(?:d)? Stripe Connect|Connect platform account/i.test(message)) {
    return {
      message: "Payouts are temporarily unavailable because Stripe Connect is not configured. Contact platform support.",
      status: 503,
      code: "STRIPE_CONNECT_NOT_ACTIVATED"
    };
  }

  return null;
}
