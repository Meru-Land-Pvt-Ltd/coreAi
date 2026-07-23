"use client";

import React from "react";

export function InfoTooltip({ content }: { content: string }) {
  if (!content) return null;
  return (
    <span className="relative group inline-block ml-1.5 cursor-help align-middle">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3.5 h-3.5 text-slate-400 hover:text-slate-600 transition-colors inline-block"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4" />
        <path d="M12 8h.01" />
      </svg>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-64 -translate-x-1/2 rounded-lg bg-slate-900 p-2 text-xs font-normal text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity duration-200 invisible group-hover:visible whitespace-normal leading-normal text-center">
        {content}
      </span>
    </span>
  );
}
