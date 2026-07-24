import Stripe from "stripe";
import { env } from "../../config/env";

let stripeClient: Stripe | null = null;

export function isStripeConfigured() {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function getStripeClient(): Stripe | null {
  if (!env.STRIPE_SECRET_KEY) {
    return null;
  }

  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY);
  }

  return stripeClient;
}

export async function attachOrReusePaymentMethod(
  stripe: NonNullable<ReturnType<typeof getStripeClient>>,
  paymentMethodId: string,
  customerId: string
) {
  const method = await stripe.paymentMethods.retrieve(paymentMethodId);
  const attachedCustomerId =
    typeof method.customer === "string" ? method.customer : method.customer?.id ?? null;

  if (attachedCustomerId === customerId) return method;
  if (attachedCustomerId) {
    throw new Error("Payment method belongs to a different customer");
  }

  return stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
}
