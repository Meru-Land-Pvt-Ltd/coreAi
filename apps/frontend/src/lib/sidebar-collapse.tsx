"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * ONE COLLAPSE, THREE SHELLS.
 *
 * The founder's ruling, 2026-08-28: the admin, the business and the
 * architect all lose a fixed 256 pixels to a sidebar they are not reading,
 * on a canvas where every pixel is working space. He pointed at the control
 * he wanted — a single square button at the top-left of the content, the one
 * every serious product has.
 *
 * Written once and used by all three. Three copies of the same behaviour is
 * how a platform ends up with three sidebars that collapse three different
 * ways, and this codebase has spent a day paying for exactly that mistake.
 *
 * The choice is per shell and remembered, because an admin's habit and an
 * architect's habit are not the same habit.
 */

export type SidebarShell = "admin" | "business" | "architect";

const KEY = (shell: SidebarShell) => `triven.sidebar.collapsed.${shell}`;

export function useSidebarCollapsed(shell: SidebarShell) {
  const [collapsed, setCollapsed] = useState(false);

  /* Read after mount, never during render: the server has no localStorage,
     and guessing here is what makes a sidebar flicker on every page load. */
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(KEY(shell)) === "1");
    } catch {
      /* A browser refusing storage simply gets the open sidebar. */
    }
  }, [shell]);

  const toggle = useCallback(() => {
    setCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(KEY(shell), next ? "1" : "0");
      } catch {
        /* Their preference is not worth an error. */
      }
      return next;
    });
  }, [shell]);

  return { collapsed, toggle };
}

/**
 * The button itself. Deliberately quiet — it sits beside a page title and
 * must never compete with it.
 */
export function SidebarCollapseButton({
  collapsed,
  onToggle,
  shell
}: {
  collapsed: boolean;
  onToggle: () => void;
  shell: SidebarShell;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid={`${shell}-sidebar-toggle`}
      aria-label={collapsed ? "Show the menu" : "Hide the menu"}
      aria-pressed={collapsed}
      title={collapsed ? "Show the menu" : "Hide the menu"}
      className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg border border-gray-200 bg-white text-slate-500 transition hover:border-slate-300 hover:text-slate-800 lg:grid"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="9" y1="4" x2="9" y2="20" />
        {/* The chevron points the way it will move. */}
        <polyline
          points={collapsed ? "13,9 16,12 13,15" : "16,9 13,12 16,15"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
