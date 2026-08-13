"use client";

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

const FRONT_DESK_LINKS = [
  // [DISABLED:non-handoff] Only human-handoff pages stay linked; the other
  // pages exist but their backend routes are disabled. Re-enable by
  // uncommenting the entries below together with the backend mounts.
  { key: "inbox", label: "Inbox", href: "/business/inbox" },
  { key: "team", label: "Team", href: "/business/team" }
  // { key: "customers", label: "Customers", href: "/business/customers" },
  // { key: "rules", label: "Rules", href: "/business/rules" },
  // { key: "quality", label: "Quality", href: "/business/quality" },
  // { key: "calls", label: "Calls", href: "/business/calls" },
  // { key: "knowledge-gaps", label: "Knowledge Gaps", href: "/business/knowledge-gaps" }
] as const;

/**
 * Horizontal pill navigation linking the buyer front-desk pages to each other.
 * Rendered at the top of each front-desk page — the main sidebar is not
 * modified (visual-UI rule), so this keeps the new pages interlinked.
 */
export function FrontDeskNav() {
  const pathname = usePathname() ?? "";

  return (
    <nav aria-label="Front desk" className="mb-4 overflow-x-auto sm:mb-6" data-testid="frontdesk-nav">
      <div className="flex w-max gap-1 rounded-xl bg-gray-50 p-1">
        {FRONT_DESK_LINKS.map((link) => {
          const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.key}
              href={link.href as Route}
              data-testid={`frontdesk-nav-${link.key}`}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors ${
                active
                  ? "bg-amber-50 font-semibold text-amber-700"
                  : "font-medium text-slate-500 hover:text-slate-700"
              }`}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
