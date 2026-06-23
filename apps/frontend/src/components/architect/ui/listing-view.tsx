"use client";

import { useEffect, useState } from "react";
import {
  ArchitectBadge,
  ArchitectCard,
  ArchitectEmptyState,
  ArchitectPageHeader,
  ArchitectStatusPill,
  formatDate,
  formatMoney
} from "./architect-ui";
import { getArchitectListings } from "../features/api";
import type { ArchitectListing } from "../features/types";

export function ArchitectListingsView() {
  const [listings, setListings] = useState<ArchitectListing[]>([]);
  const [loading, setLoading] = useState(true);

  async function loadListings() {
    const result = await getArchitectListings();

    if (result.success && result.data) {
      setListings(result.data.listings);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadListings();
  }, []);

  return (
    <div>
      <ArchitectPageHeader
        eyebrow="Marketplace"
        title="Your Agent Listings"
        description="Manage AI agents you submitted to the CoreAI marketplace."
        actionLabel="Create Listing"
        actionHref="/architect/listings/new"
      />

      <ArchitectCard>
        {loading ? (
          <p className="text-sm font-bold text-orange-700">Loading listings...</p>
        ) : listings.length ? (
          <div className="grid gap-4 md:grid-cols-2">
            {listings.map((listing) => (
              <article key={listing.id} className="rounded-[28px] bg-orange-50 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black">{listing.name}</h2>
                    <p className="mt-2 text-sm leading-6 text-orange-900/70">
                      {listing.shortDescription}
                    </p>
                  </div>

                  <ArchitectStatusPill status={listing.status} />
                </div>

                <p className="mt-4 text-lg font-black">{formatMoney(listing.priceCents)}</p>

                <div className="mt-4 flex flex-wrap gap-2">
                  {listing.tags.map((tag) => (
                    <ArchitectBadge key={tag}>{tag}</ArchitectBadge>
                  ))}
                </div>

                <p className="mt-4 text-xs font-black uppercase tracking-wide text-orange-600">
                  Created {formatDate(listing.createdAt)}
                </p>
              </article>
            ))}
          </div>
        ) : (
          <ArchitectEmptyState
            title="No listings yet"
            text="Create a marketplace listing from your workflow and submit it for admin review."
            actionLabel="Create Listing"
            actionHref="/architect/listings/new"
          />
        )}
      </ArchitectCard>
    </div>
  );
}