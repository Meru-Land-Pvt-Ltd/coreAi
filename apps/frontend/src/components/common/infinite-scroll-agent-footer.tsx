import type { RefObject } from "react";

type InfiniteScrollAgentFooterProps = {
  visibleCount: number;
  loadedCount: number;
  hasMore: boolean;
  isLoadingMore: boolean;
  sentinelRef: RefObject<HTMLDivElement | null>;
  view?: "grid" | "list";
  countTestId?: string;
  loadingTestId?: string;
  sentinelTestId?: string;
  skeletonLayout?: "marketplace" | "my-agents";
};

function skeletonContainerClass(view: "grid" | "list", layout: "marketplace" | "my-agents") {
  if (layout === "my-agents") {
    return view === "list"
      ? "mt-6 grid grid-cols-1 gap-5 view-list"
      : "mt-6 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3";
  }
  return view === "grid"
    ? "mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3"
    : "mt-6 flex flex-col gap-4";
}

function skeletonItemClass(view: "grid" | "list", layout: "marketplace" | "my-agents") {
  if (layout === "my-agents") {
    return view === "list"
      ? "h-32 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm"
      : "h-72 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm";
  }
  return view === "grid"
    ? "h-72 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm"
    : "h-32 animate-pulse rounded-2xl border border-gray-100 bg-white shadow-sm";
}

export function InfiniteScrollLoadMoreSkeleton({
  view = "grid",
  loadingTestId = "marketplace-loading-more",
  skeletonLayout = "marketplace",
}: Pick<InfiniteScrollAgentFooterProps, "view" | "loadingTestId" | "skeletonLayout">) {
  return (
    <div className={skeletonContainerClass(view, skeletonLayout)} data-testid={loadingTestId}>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className={skeletonItemClass(view, skeletonLayout)} />
      ))}
    </div>
  );
}

export function InfiniteScrollAgentFooter({
  visibleCount,
  loadedCount,
  hasMore,
  isLoadingMore,
  sentinelRef,
  view = "grid",
  countTestId = "marketplace-showing-agents-count",
  loadingTestId = "marketplace-loading-more",
  sentinelTestId = "marketplace-load-more-sentinel",
  skeletonLayout = "marketplace",
}: InfiniteScrollAgentFooterProps) {
  if (loadedCount <= 0) return null;

  return (
    <>
      {isLoadingMore ? (
        <InfiniteScrollLoadMoreSkeleton
          view={view}
          loadingTestId={loadingTestId}
          skeletonLayout={skeletonLayout}
        />
      ) : null}

      <div className="mt-10 flex flex-col items-center gap-3">
        {!hasMore && !isLoadingMore ? (
          <p className="text-center text-sm text-slate-400" data-testid={countTestId}>
            Showing {visibleCount} of {loadedCount} agents
          </p>
        ) : null}
        {hasMore ? (
          <div
            ref={sentinelRef}
            className="h-1 w-full"
            aria-hidden
            data-testid={sentinelTestId}
          />
        ) : null}
      </div>
    </>
  );
}
