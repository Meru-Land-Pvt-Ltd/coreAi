-- Each agent carries its own Stripe price, so an architect's price is the price charged.
ALTER TABLE "AgentListing" ADD COLUMN "stripeProductId" TEXT;
ALTER TABLE "AgentListing" ADD COLUMN "stripePriceId" TEXT;
ALTER TABLE "AgentListing" ADD COLUMN "stripePriceCents" INTEGER;
