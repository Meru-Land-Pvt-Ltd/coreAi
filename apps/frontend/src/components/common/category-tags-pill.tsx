"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";

const MAX_VISIBLE = 3;
const FIT_BUFFER_PX = 10;

function buildLineText(labels: string[], limit: number): string {
  const visible = labels.slice(0, limit);
  const extra = Math.max(0, labels.length - limit);
  if (extra > 0) {
    return `${visible.join(" · ")} · +${extra}`;
  }
  return visible.join(" · ");
}

function readAvailableWidth(root: HTMLElement, parent: HTMLElement): number {
  const parentStyle = getComputedStyle(parent);
  const gap = Number.parseFloat(parentStyle.columnGap || parentStyle.gap || "0") || 0;
  let siblingsWidth = 0;
  const kids = Array.from(parent.children);
  for (const child of kids) {
    if (child === root) continue;
    siblingsWidth += (child as HTMLElement).getBoundingClientRect().width;
  }
  const gaps = Math.max(0, kids.length - 1) * gap;
  return Math.max(0, parent.getBoundingClientRect().width - siblingsWidth - gaps - FIT_BUFFER_PX);
}

function measurePillWidth(text: string, className: string): number {
  const probe = document.createElement("span");
  probe.className = className;
  probe.textContent = text;
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.left = "-99999px";
  probe.style.top = "0";
  probe.style.whiteSpace = "nowrap";
  probe.style.width = "max-content";
  probe.style.maxWidth = "none";
  document.body.appendChild(probe);
  const width = probe.getBoundingClientRect().width;
  document.body.removeChild(probe);
  return width;
}

/**
 * Content-sized category chip. Shows up to 3 full labels on one line;
 * if they do not fit, drops to 2 or 1 with +N (rest on hover). Avoids clipping words.
 */
export function CategoryTagsPill({
  labels,
  testId,
  moreTestId,
  tooltipTestId,
  emptyLabel,
  compact = false,
  className = ""
}: {
  labels: string[];
  testId: string;
  moreTestId?: string;
  tooltipTestId?: string;
  emptyLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const labelsKey = labels.join("\u0000");
  const [visibleLimit, setVisibleLimit] = useState(1);
  const [truncateSingle, setTruncateSingle] = useState(false);

  const measureClass = useMemo(
    () =>
      `inline-flex items-center whitespace-nowrap rounded-full border border-amber-100 bg-amber-50 px-2.5 font-semibold text-amber-700 ${
        compact ? "py-0.5 text-[11px]" : "py-1 text-xs"
      }`,
    [compact]
  );

  const lineText = useMemo(
    () => buildLineText(labels, visibleLimit),
    [labels, visibleLimit]
  );
  const hiddenLabels = labels.slice(visibleLimit);
  const extraCount = hiddenLabels.length;
  const showTooltip = extraCount > 0 || truncateSingle;

  useLayoutEffect(() => {
    if (labels.length === 0) return;

    const root = rootRef.current;
    const parent = root?.parentElement;
    if (!root || !parent) return;

    const fit = () => {
      const available = readAvailableWidth(root, parent);
      if (available <= 0) {
        setVisibleLimit(1);
        setTruncateSingle(true);
        return;
      }

      const maxTry = Math.min(MAX_VISIBLE, labels.length);
      let chosen = 1;
      let needsTruncate = false;

      for (let limit = maxTry; limit >= 1; limit -= 1) {
        const needed = measurePillWidth(buildLineText(labels, limit), measureClass);
        if (needed <= available) {
          chosen = limit;
          needsTruncate = false;
          break;
        }
        if (limit === 1) {
          chosen = 1;
          needsTruncate = needed > available;
        }
      }

      setVisibleLimit((prev) => (prev === chosen ? prev : chosen));
      setTruncateSingle((prev) => (prev === needsTruncate ? prev : needsTruncate));
    };

    fit();
    const frame = window.requestAnimationFrame(fit);
    const observer = new ResizeObserver(fit);
    observer.observe(parent);
    if (parent.parentElement) observer.observe(parent.parentElement);
    window.addEventListener("resize", fit);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, [labelsKey, labels, compact, measureClass]);

  const pillClass = `${measureClass} ${truncateSingle ? "min-w-0 max-w-full truncate" : "shrink-0"}`;

  if (labels.length === 0) {
    if (!emptyLabel) return null;
    return (
      <span className={`${measureClass} font-medium shrink-0 ${className}`} data-testid={testId}>
        {emptyLabel}
      </span>
    );
  }

  const tooltipLabels =
    hiddenLabels.length > 0 ? hiddenLabels : truncateSingle ? labels : [];

  return (
    <div
      ref={rootRef}
      className={`group/tags relative inline-flex min-w-0 ${truncateSingle ? "max-w-full" : "shrink-0"} ${className}`}
      data-testid={testId}
    >
      <span
        className={pillClass}
        title={
          showTooltip
            ? (hiddenLabels.length > 0 ? hiddenLabels : labels).join(", ")
            : undefined
        }
        data-testid={extraCount > 0 ? moreTestId : undefined}
      >
        {lineText}
      </span>
      {showTooltip && tooltipLabels.length > 0 ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-0 top-full z-20 mt-1.5 hidden w-max max-w-[min(100vw,18rem)] rounded-xl border border-amber-100 bg-white px-3 py-2 shadow-lg group-hover/tags:block"
          data-testid={tooltipTestId}
        >
          <div className="flex flex-wrap gap-1.5">
            {tooltipLabels.map((label, index) => (
              <span
                key={`${label}-${index}`}
                className="rounded-full border border-amber-100 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
