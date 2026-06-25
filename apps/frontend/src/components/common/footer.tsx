import Link from "next/link";

export function CoreFooter() {
  return (
    <footer id="footer" className="scroll-mt-24 border-t border-gray-200 bg-gray-50 px-6 py-16">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 gap-10 md:grid-cols-5">
          <div className="col-span-2 md:col-span-1">
            <Link href="/#top" className="flex items-center gap-2.5" aria-label="CORE home">
              <svg className="h-7 w-7" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <circle cx="14" cy="14" r="11" stroke="#f59e0b" strokeWidth={2} />
                <circle cx="14" cy="14" r="4" fill="#fbbf24" />
              </svg>

              <span className="text-xl font-extrabold tracking-tight text-amber-500">
                CORE
              </span>
            </Link>

            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              The AI agent marketplace where businesses and architects build the future of work together.
            </p>
          </div>

          <FooterColumn
            title="Product"
            links={[
              { label: "Platform", href: "/#platform" },
              { label: "Pricing", href: "/#assessment" },
              { label: "Docs", href: "/#footer" },
              { label: "API", href: "/#footer" }
            ]}
          />

          <FooterColumn
            title="Company"
            links={[
              { label: "About", href: "/about" },
              { label: "Contact Us", href: "/contactus" },
              { label: "Blog", href: "/blog" },
              { label: "Careers", href: "/careers" }
            ]}
          />

          <FooterColumn
            title="Legal"
            links={[
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
              { label: "Help Center", href: "/contact" }
            ]}
          />

          <FooterColumn
            title="Connect"
            links={[
              { label: "Twitter", href: "#" },
              { label: "LinkedIn", href: "#" },
              { label: "Email", href: "mailto:hello@usecore.ai" }
            ]}
          />
        </div>

        <div className="mt-12 border-t border-gray-200 pt-8">
          <p className="text-sm text-slate-500">
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
  }[];
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-900">{title}</h4>

      <ul className="mt-4 space-y-3 text-sm">
        {links.map((link) => (
          <li key={link.label}>
            {link.href.startsWith("mailto:") ? (
              <a
                href={link.href}
                className="text-slate-500 transition hover:text-amber-600"
              >
                {link.label}
              </a>
            ) : (
              <Link
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