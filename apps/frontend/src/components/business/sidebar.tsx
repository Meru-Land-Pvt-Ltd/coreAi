"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { BUSINESS_LOGIN_PATH, BUSINESS_MARKETPLACE_PATH } from "@/lib/routes";


type CoreAiUser = {
    id?: string;
    fullName?: string | null;
    email?: string | null;
    role?: string | null;
    isSuspended?: boolean;
    createdAt?: string | null;
    architectProfile?: unknown;
};

type IconName =
    | "dashboard"
    | "bot"
    | "activity"
    | "card"
    | "settings"
    | "marketplace"
    | "help"
    | "external"
    | "menu"
    | "close";

const businessNavItems = [
    {
        label: "Overview",
        href: "/business/dashboard",
        icon: "dashboard" as IconName
    },
    {
        label: "My Agents",
        href: "/business/dashboard#agents",
        icon: "bot" as IconName,
        count: "3"
    },
    {
        label: "Billing & Usage",
        href: "/business/dashboard#billing",
        icon: "card" as IconName
    },
];

export function BusinessSidebarLayout({ children }: { children: ReactNode }) {
    const pathname = usePathname();
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [locationHash, setLocationHash] = useState("");
    const router = useRouter();
    const [accountMenuOpen, setAccountMenuOpen] = useState(false);

    const [currentUser, setCurrentUser] = useState<CoreAiUser | null>(null);

    useEffect(() => {
        setCurrentUser(readCoreAiUser());
    }, []);

    useEffect(() => {
        const syncHash = () => setLocationHash(window.location.hash);

        syncHash();
        window.addEventListener("hashchange", syncHash);

        return () => window.removeEventListener("hashchange", syncHash);
    }, [pathname]);

    const marketplaceActive = isMarketplaceRoute(pathname);

    const displayName = getDisplayName(currentUser);
    const subtitle = getUserSubtitle(currentUser);
    const initials = getInitials(currentUser);

    function closeSidebar() {
        setSidebarOpen(false);
    }

    function handleLogout() {
        localStorage.clear();
        sessionStorage.clear();
        setAccountMenuOpen(false);
        closeSidebar();
        router.replace(BUSINESS_LOGIN_PATH);
    }


    return (
        <div className="min-h-screen bg-gray-50 text-slate-900">
            {sidebarOpen ? (
                <button
                    type="button"
                    aria-label="Close menu overlay"
                    data-testid="business-sidebar-overlay"
                    onClick={closeSidebar}
                    className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] lg:hidden"
                />
            ) : null}

            <aside
                className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 flex-col border-r border-gray-100 bg-white transition-transform duration-300 ease-out lg:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
                    }`}
                aria-label="Primary"
            >
                <div className="flex items-center gap-3 p-6">
                    <a data-testid="business-sidebar-core-home-link" href={"/business/dashboard" as Route} className="flex items-center gap-2.5" aria-label="CORE home">
                        <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                            <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
                            <circle cx="14" cy="14" r="4" fill="#fbbf24" />
                        </svg>
                        <span className="text-xl font-extrabold tracking-tight text-amber-500" data-testid="business-sidebar-core-text">
                            CORE
                        </span>
                    </a>

                    <span className="ml-auto rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500 lg:hidden" data-testid="business-sidebar-beta-text">
                        Beta
                    </span>

                    <button
                        type="button"
                        onClick={closeSidebar}
                        data-testid="business-sidebar-close"
                        className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-gray-50 lg:hidden"
                        aria-label="Close menu"
                    >
                        <Icon name="close" className="h-5 w-5" />
                    </button>
                </div>

                <nav className="mt-6 flex flex-col gap-1 px-3" aria-label="Sections">
                    {businessNavItems.map((item) => {
                        const active =
                            !marketplaceActive &&
                            isBusinessNavItemActive(item, pathname, locationHash);

                        return (
                            <Link data-testid="business-sidebar-link"
                                key={item.label}
                                href={item.href as any}
                                onClick={closeSidebar}
                                className={`group flex items-center gap-3 rounded-r-lg border-l-[3px] px-4 py-2.5 text-left transition-colors duration-300 ${active
                                    ? "border-amber-500 bg-amber-50 font-semibold text-amber-700"
                                    : "border-transparent text-slate-600 hover:bg-gray-50"
                                    }`}
                                aria-current={active ? "page" : undefined}
                            >
                                <Icon name={item.icon} className="h-5 w-5" />
                                <span data-testid="business-sidebar-label-text">{item.label}</span>

                                {item.count ? (
                                    <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500" data-testid="business-sidebar-count-text">
                                        {item.count}
                                    </span>
                                ) : null}
                            </Link>
                        );
                    })}
                </nav>

                <div className="mx-4 my-4 border-t border-gray-100" />

                <div className="flex flex-col gap-1 px-3">
                    <Link data-testid="business-sidebar-marketplace-link"
                        href={BUSINESS_MARKETPLACE_PATH}
                        onClick={closeSidebar}
                        aria-current={marketplaceActive ? "page" : undefined}
                        className={`flex items-center gap-3 rounded-r-lg border-l-[3px] px-4 py-2.5 text-sm transition-colors duration-300 ${marketplaceActive
                            ? "border-amber-500 bg-amber-50 font-semibold text-amber-700"
                            : "border-transparent text-slate-500 hover:bg-gray-50 hover:text-slate-700"
                            }`}
                    >
                        <Icon name="marketplace" className="h-[18px] w-[18px]" />
                        <span data-testid="business-sidebar-marketplace-text">Marketplace</span>
                        <Icon name="external" className="ml-auto h-3.5 w-3.5 text-slate-400" />
                    </Link>

                </div>

                <div className="mt-auto border-t border-gray-100 p-4">
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-sm font-bold text-amber-700" data-testid="business-sidebar-initials-text">
                            {initials}
                        </span>

                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-900" data-testid="business-sidebar-display-text">
                                {displayName}
                            </p>
                            <p className="truncate text-xs text-slate-500" data-testid="business-sidebar-subtitle-text">{subtitle}</p>
                        </div>

                        <div className="relative">
                            <button
                                type="button"
                                onClick={() => setAccountMenuOpen((open) => !open)}
                                data-testid="business-account-menu-toggle"
                                className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-gray-50 hover:text-slate-600"
                                aria-label="Account settings"
                                aria-haspopup="true"
                                aria-expanded={accountMenuOpen}
                            >
                                <Icon name="settings" className="h-[18px] w-[18px]" />
                            </button>

                            {accountMenuOpen ? (
                                <div className="absolute bottom-full right-0 z-50 mb-2 w-36 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-lg">
                                    <button
                                        type="button"
                                        onClick={handleLogout}
                                        data-testid="business-logout"
                                        className="flex w-full items-center px-3.5 py-2 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
                                    >
                                        Logout
                                    </button>
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            </aside>

            <div className="min-h-screen lg:ml-64">
                <div className="sticky top-0 z-30 flex items-center justify-between border-b border-gray-100 bg-gray-50/90 px-5 py-3 backdrop-blur lg:hidden">
                    <button
                        type="button"
                        onClick={() => setSidebarOpen(true)}
                        data-testid="business-sidebar-open"
                        className="rounded-lg p-2 text-slate-500 transition-colors hover:bg-white hover:text-slate-700"
                        aria-label="Open menu"
                    >
                        <Icon name="menu" className="h-6 w-6" />
                    </button>

                    <span className="text-sm font-bold tracking-tight text-slate-900" data-testid="business-sidebar-core-text-2">CORE</span>

                    <span className="h-10 w-10" />
                </div>

                {children}
            </div>
        </div>
    );
}

function LogoIcon() {
    return (
        <svg
            viewBox="0 0 24 24"
            className="h-5 w-5 text-white"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
        </svg>
    );
}

function Icon({ name, className = "h-5 w-5" }: { name: IconName; className?: string }) {
    const common = {
        className,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.75",
        strokeLinecap: "round" as const,
        strokeLinejoin: "round" as const,
        "aria-hidden": true
    };

    if (name === "dashboard") {
        return (
            <svg {...common}>
                <rect width="7" height="7" x="3" y="3" rx="1.5" />
                <rect width="7" height="7" x="14" y="3" rx="1.5" />
                <rect width="7" height="7" x="14" y="14" rx="1.5" />
                <rect width="7" height="7" x="3" y="14" rx="1.5" />
            </svg>
        );
    }

    if (name === "bot") {
        return (
            <svg {...common}>
                <path d="M12 8V4H8" />
                <rect width="16" height="12" x="4" y="8" rx="2.5" />
                <path d="M2 14h2" />
                <path d="M20 14h2" />
                <path d="M15 13v2" />
                <path d="M9 13v2" />
            </svg>
        );
    }

    if (name === "activity") {
        return (
            <svg {...common}>
                <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
        );
    }

    if (name === "card") {
        return (
            <svg {...common}>
                <rect width="20" height="14" x="2" y="5" rx="2.5" />
                <line x1="2" x2="22" y1="10" y2="10" />
            </svg>
        );
    }

    if (name === "settings") {
        return (
            <svg {...common}>
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
            </svg>
        );
    }

    if (name === "marketplace") {
        return (
            <svg {...common}>
                <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
                <path d="M3 6h18" />
                <path d="M16 10a4 4 0 0 1-8 0" />
            </svg>
        );
    }

    if (name === "help") {
        return (
            <svg {...common}>
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
        );
    }

    if (name === "external") {
        return (
            <svg {...common}>
                <line x1="7" y1="17" x2="17" y2="7" />
                <polyline points="7 7 17 7 17 17" />
            </svg>
        );
    }

    if (name === "menu") {
        return (
            <svg {...common} strokeWidth="2">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
        );
    }

    return (
        <svg {...common} strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
    );
}

function isMarketplaceRoute(pathname: string) {
    return pathname === BUSINESS_MARKETPLACE_PATH || pathname.startsWith(`${BUSINESS_MARKETPLACE_PATH}/`);
}

function isBusinessNavItemActive(
    item: (typeof businessNavItems)[number],
    pathname: string,
    hash: string
) {
    if (pathname !== "/business/dashboard") return false;

    if (item.label === "Overview") return hash === "" || hash === "#";
    if (item.label === "My Agents") return hash === "#agents";
    if (item.label === "Billing & Usage") return hash === "#billing";

    return false;
}

function readCoreAiUser(): CoreAiUser | null {
    if (typeof window === "undefined") return null;

    try {
        const raw = localStorage.getItem("coreai-user");
        return raw ? (JSON.parse(raw) as CoreAiUser) : null;
    } catch {
        return null;
    }
}

function getDisplayName(user: CoreAiUser | null) {
    const fullName = user?.fullName?.trim();

    if (fullName) return fullName;

    if (user?.email) {
        return user.email
            .split("@")[0]
            .replace(/[._-]+/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    return "";
}

function getInitials(user: CoreAiUser | null) {
    const displayName = getDisplayName(user);

    const initials = displayName
        .replace(/[()]/g, "")
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("");

    return initials || "U";
}

function getUserSubtitle(user: CoreAiUser | null) {
    if (user?.email?.trim()) return user.email.trim();
    if (user?.role?.trim()) return formatRole(user.role);
    return "";
}

function formatRole(role: string) {
    return role
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
}