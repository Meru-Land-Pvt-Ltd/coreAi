import type { Route } from "next";
import Link from "next/link";

export function CoreFooter() {
    return (
        <footer id="footer" className="scroll-mt-24 border-t border-gray-200 bg-gray-50 px-6 py-16">
            <div className="mx-auto max-w-7xl">
                <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
                    <div className="col-span-2 md:col-span-1">
                        <Link data-testid="footer-core-link" href={"/#top" as Route} className="flex items-center gap-2.5" aria-label="CORE home">
                            <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                                <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
                                <circle cx="14" cy="14" r="4" fill="#fbbf24" />
                            </svg>

                            <span className="text-xl font-extrabold tracking-tight text-amber-500" data-testid="common-footer-core-text">
                                CORE
                            </span>
                        </Link>

                        <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500" data-testid="common-footer-the-ai-agent-marketplace-where-businesses-and-text">
                            The AI agent marketplace where businesses and architects build the future of work together.
                        </p>
                    </div>

                    <FooterColumn
                        title="Product"
                        links={[
                            { label: "Platform", href: "/#platform" },
                            { label: "Pricing", href: "/pricing" }
                        ]}
                    />

                    <FooterColumn
                        title="Company"
                        links={[
                            { label: "About", href: "/about" },
                            { label: "Contact Us", href: "/contactus" }
                        ]}
                    />

                    <FooterColumn
                        title="Legal"
                        links={[
                            { label: "Privacy", href: "/privacy", newTab: true },
                            { label: "Terms", href: "/terms", newTab: true },
                            { label: "Help Center", href: "/contact", newTab: true }
                        ]}
                    />

                    <FooterColumn
                        title="Connect"
                        links={[
                            { label: "Email", href: "mailto:hello@usecore.ai" }
                        ]}
                    />
                </div>

                <div className="mt-12 border-t border-gray-200 pt-8">
                    <p className="text-sm text-slate-500" data-testid="common-footer-2026-core-all-rights-reserved-text">
                        © 2026 CORE. All rights reserved.
                    </p>
                </div>
            </div>
        </footer>
    );
}

function FooterColumn({
    title,
    links
}: {
    title: string;
    links: {
        label: string;
        href: string;
        newTab?: boolean;
    }[];
}) {
    return (
        <div>
            <h4 className="text-sm font-semibold text-slate-900" data-testid="common-footer-title-heading">{title}</h4>

            <ul className="mt-4 space-y-3 text-sm">
                {links.map((link) => (
                    <li key={link.label} data-testid="common-footer-link-starts-with-mailto-link-label-link-item">
                        {link.href.startsWith("mailto:") ? (
                            <a data-testid={`footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-link`}
                                href={link.href}
                                className="text-slate-500 transition hover:text-amber-600"
                            >
                                {link.label}
                            </a>
                        ) : link.newTab ? (
                            <a data-testid={`footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-link`}
                                href={link.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-500 transition hover:text-amber-600"
                            >
                                {link.label}
                            </a>
                        ) : (
                            <Link data-testid={`footer-${link.label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-link`}
                                href={link.href as any}
                                className="text-slate-500 transition hover:text-amber-600"
                            >
                                {link.label}
                            </Link>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}