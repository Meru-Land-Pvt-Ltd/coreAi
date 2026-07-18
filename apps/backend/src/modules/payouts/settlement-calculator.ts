export const CALCULATION_VERSION = 1;

export const ARCHITECT_SHARE_BPS = 7000;

export type MarketplaceSettlement = {
  grossAmountMinor: number;
  platformCommissionMinor: number;
  architectGrossMinor: number;
  stripeFeeTreatment: "PLATFORM_ABSORBS";
  architectNetMinor: number;
  calculationVersion: number;
};

export function calculateMarketplaceSettlement(params: {
  grossAmountMinor: number;
  currency: string;
}): MarketplaceSettlement {
  const gross = params.grossAmountMinor;

  if (!Number.isSafeInteger(gross) || gross < 0) {
    throw new Error(`Settlement gross must be a non-negative integer, got ${gross}`);
  }

  const architectGrossMinor = Math.floor((gross * ARCHITECT_SHARE_BPS) / 10_000);
  const platformCommissionMinor = gross - architectGrossMinor;

  if (architectGrossMinor < 0 || platformCommissionMinor < 0 || platformCommissionMinor > gross) {
    throw new Error(`Settlement math produced an impossible split for gross ${gross}`);
  }

  return {
    grossAmountMinor: gross,
    platformCommissionMinor,
    architectGrossMinor,
    stripeFeeTreatment: "PLATFORM_ABSORBS",
    architectNetMinor: architectGrossMinor,
    calculationVersion: CALCULATION_VERSION
  };
}

export function architectShareOfRefund(params: {
  refundAmountMinor: number;
  alreadyAdjustedMinor: number;
  architectGrossMinor: number;
}): number {
  const { refundAmountMinor, alreadyAdjustedMinor, architectGrossMinor } = params;
  if (!Number.isSafeInteger(refundAmountMinor) || refundAmountMinor < 0) {
    throw new Error(`Refund amount must be a non-negative integer, got ${refundAmountMinor}`);
  }
  const share = Math.floor((refundAmountMinor * ARCHITECT_SHARE_BPS) / 10_000);
  const remaining = Math.max(0, architectGrossMinor - alreadyAdjustedMinor);
  return Math.min(share, remaining);
}
