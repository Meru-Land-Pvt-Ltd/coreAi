"use client";

import { useState, useRef, useEffect } from "react";

interface ExpandableTextProps {
  text: string;
  className?: string;
  clampLines?: number;
}

export function ExpandableText({ text, className = "", clampLines = 3 }: ExpandableTextProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Reset expanded state if the text changes
    setIsExpanded(false);
  }, [text]);

  useEffect(() => {
    if (!isExpanded && textRef.current) {
      const hasMore = textRef.current.scrollHeight > textRef.current.clientHeight;
      setHasOverflow(hasMore);
    }
  }, [text, isExpanded]);

  const lineClampClass = isExpanded
    ? "line-clamp-none"
    : clampLines === 3
    ? "line-clamp-3"
    : clampLines === 2
    ? "line-clamp-2"
    : "line-clamp-3";

  return (
    <div className="flex flex-col items-start w-full">
      <div
        ref={textRef}
        className={`${className} ${lineClampClass} transition-all duration-200`}
        dangerouslySetInnerHTML={{ __html: text }}
      />
      {hasOverflow && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="mt-1.5 text-sm font-semibold text-amber-600 transition hover:text-amber-700 focus:outline-none"
        >
          {isExpanded ? "View less" : "View more"}
        </button>
      )}
    </div>
  );
}
