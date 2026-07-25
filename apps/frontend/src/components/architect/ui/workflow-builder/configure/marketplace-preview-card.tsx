import type { AgentConfigureData } from "@coreai/shared";
import { BuilderIcon } from "../icons";

/* eslint-disable @next/next/no-img-element -- icons/screenshots can be data URLs, which next/image does not support */

export function MarketplacePreviewCard({
  configure,
  architectName,
  showPrice = true
}: {
  configure: AgentConfigureData;
  architectName: string;
  showPrice?: boolean;
}) {
  const name = configure.basics.agentName.trim() || "Your agent";
  const tagline = configure.basics.tagline.trim() || "Your tagline appears here";
  const price = Math.max(0, Math.round(configure.pricing.price));
  const priceLabel =
    configure.pricing.pricingModel === "free"
      ? "Free"
      : configure.pricing.pricingModel === "subscription"
        ? `$${price.toLocaleString("en-US")}/mo`
        : `$${price.toLocaleString("en-US")}`;
  const cover = configure.media.screenshotUrls[0] ?? null;

  return (
    <div
      className="lift-card shadow-soft w-full overflow-visible rounded-2xl border border-gray-100 bg-white"
      data-testid="configure-preview-card"
    >
      <div className="relative z-0 h-24 overflow-hidden rounded-t-2xl">
        {cover ? (
          <img src={cover} alt="Listing cover" className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div
            className="absolute inset-0 bg-gradient-to-br from-slate-50 to-slate-100"
            data-testid="configure-preview-default-cover"
          />
        )}
        <span className="absolute right-2.5 top-2.5 z-10 rounded-full bg-white/90 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-600 shadow-sm backdrop-blur">
          {configure.basics.category || "Category"}
        </span>
      </div>

      <div className="relative z-10 px-4 pb-4 pt-0">
        <div
          className="shadow-amber-sm relative z-10 -mt-6 mb-2.5 flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 ring-4 ring-white"
          data-testid="configure-preview-icon"
        >
          {configure.basics.iconUrl ? (
            <img src={configure.basics.iconUrl} alt="Agent icon" className="h-full w-full object-cover" />
          ) : (
            <BuilderIcon name="message" className="h-6 w-6 text-white" />
          )}
        </div>

        <h4
          className="truncate text-[15px] font-bold leading-tight tracking-tight text-slate-900"
          data-testid="configure-preview-name"
        >
          {name}
        </h4>
        <p
          className="mt-1 text-[12.5px] leading-snug text-slate-500"
          style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
          data-testid="configure-preview-tagline"
        >
          {tagline}
        </p>

        <p className="mt-1.5 truncate text-[11px] text-slate-400">
          by <span className="font-medium text-slate-600">{architectName}</span>
        </p>

        <div className="mt-3.5 flex items-center justify-between border-t border-gray-50 pt-3">
          {showPrice ? (
            <span className="text-[16px] font-extrabold leading-none text-slate-900" data-testid="configure-preview-price">
              {priceLabel}
            </span>
          ) : (
            <span />
          )}
          <span className="shadow-amber-sm inline-flex flex-none cursor-default select-none items-center gap-1 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-white">
            Install
          </span>
        </div>
      </div>
    </div>
  );
}
