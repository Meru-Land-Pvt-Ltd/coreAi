import Stripe from "stripe";
import { env } from "../config/env";

let cachedStripe: Stripe | null = null;

export function isBillingEnabled(): boolean {
  const secret = env.STRIPE_SECRET_KEY;
  const price = env.STRIPE_PRICE_ID_AI_RECEPTIONIST_MONTHLY;
  return Boolean(
    secret &&
      !secret.includes("xxx") &&
      price &&
      !price.includes("xxx")
  );
}

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("Stripe is not configured. Set STRIPE_SECRET_KEY.");
  }
  if (!cachedStripe) {
    cachedStripe = new Stripe(env.STRIPE_SECRET_KEY);
  }
  return cachedStripe;
}
