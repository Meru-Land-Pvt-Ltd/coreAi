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

/*
 * THE BUTTON IS NOT SHARED, AND THAT IS DELIBERATE.
 *
 * The first attempt put one generic button in all three shells, floated at
 * the top-left of the content — and on the builder it landed underneath the
 * fixed top strip, invisible. The founder was right twice over: it must sit
 * on each sidebar's own edge, and it must look like the sidebar it belongs
 * to, not like a stranger dropped into three different designs.
 *
 * So only the MEMORY is shared. What the collapse looks like belongs to each
 * side, because each side already has a design and it is not ours to
 * flatten.
 */
