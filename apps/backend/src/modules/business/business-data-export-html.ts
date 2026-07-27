export type ExportField = {
  label: string;
  value: string;
};

export type ExportStat = {
  label: string;
  value: string;
  note?: string;
};

export type ExportCell =
  | string
  | {
      text: string;
      href?: string;
      badge?: boolean;
    };

export type ExportTable = {
  title: string;
  description?: string;
  columns: string[];
  rows: ExportCell[][];
  emptyMessage: string;
};

export type ExportCard = {
  title: string;
  badge?: string;
  description?: string;
  imageSrc?: string;
  imageAlt?: string;
  fields: ExportField[];
  tags?: string[];
};

export type ExportPageSection = {
  title: string;
  description?: string;
  fields?: ExportField[];
  tables?: ExportTable[];
  cards?: ExportCard[];
};

type ExportPageOptions = {
  eyebrow: string;
  title: string;
  intro: string;
  generatedAt: Date;
  homeHref: string;
  stats?: ExportStat[];
  sections: ExportPageSection[];
};

type ExportHomeCategory = {
  href: string;
  number: string;
  title: string;
  description: string;
  detail: string;
};

const MAX_EXPORT_IMAGE_BYTES = 2 * 1024 * 1024;

export type DecodedExportImage = {
  bytes: Buffer;
  extension: "png" | "jpg" | "webp";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
};

export function escapeExportHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatExportDate(value: Date | string | null | undefined): string {
  if (!value) return "Not provided";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not provided";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short"
  }).format(date);
}

export function formatExportMoneyFromCents(value: number, currency = "usd"): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(value / 100);
  } catch {
    return `$${(value / 100).toFixed(2)}`;
  }
}

export function formatExportMoneyFromMicroUsd(value: number): string {
  return formatExportMoneyFromCents(Math.round(value / 10_000), "usd");
}

export function formatExportStatus(value: string | null | undefined): string {
  const normalized = (value ?? "").trim().replace(/[_-]+/g, " ").toLowerCase();
  if (!normalized) return "Not available";
  return normalized.replace(/\b\w/g, (character) => character.toUpperCase());
}

export function formatExportTrend(current: number, previous: number): string {
  if (previous === 0) return current > 0 ? "+100%" : "0%";
  const percentage = Math.round(((current - previous) / previous) * 100);
  return `${percentage > 0 ? "+" : ""}${percentage}%`;
}

function hasPngSignature(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  );
}

function hasJpegSignature(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function hasWebpSignature(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  );
}

/**
 * Decodes only locally stored raster data URLs. Remote URLs are intentionally
 * ignored so a data export can never make a server-side request to an
 * untrusted image location.
 */
export function decodeEmbeddedExportImage(
  value: string | null | undefined,
  maxBytes = MAX_EXPORT_IMAGE_BYTES
): DecodedExportImage | null {
  if (!value || maxBytes <= 0) return null;

  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value.trim());
  if (!match) return null;

  const mimeType = match[1] as DecodedExportImage["mimeType"];
  const base64 = match[2]!;
  if (base64.length % 4 !== 0) return null;

  const estimatedBytes = Math.floor((base64.length * 3) / 4);
  if (estimatedBytes <= 0 || estimatedBytes > maxBytes) return null;

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length <= 0 || bytes.length > maxBytes) return null;

  if (mimeType === "image/png" && hasPngSignature(bytes)) {
    return { bytes, extension: "png", mimeType };
  }
  if (mimeType === "image/jpeg" && hasJpegSignature(bytes)) {
    return { bytes, extension: "jpg", mimeType };
  }
  if (mimeType === "image/webp" && hasWebpSignature(bytes)) {
    return { bytes, extension: "webp", mimeType };
  }

  return null;
}

function renderFieldGrid(fields: ExportField[]): string {
  if (fields.length === 0) {
    return '<p class="empty">No information is available in this section.</p>';
  }

  return `<dl class="field-grid">${fields
    .map(
      (field) => `<div class="field">
<dt>${escapeExportHtml(field.label)}</dt>
<dd>${escapeExportHtml(field.value || "Not provided")}</dd>
</div>`
    )
    .join("")}</dl>`;
}

function renderCell(cell: ExportCell): string {
  if (typeof cell === "string") return escapeExportHtml(cell);

  const text = escapeExportHtml(cell.text);
  const content = cell.href
    ? `<a href="${escapeExportHtml(cell.href)}">${text}</a>`
    : text;
  return cell.badge ? `<span class="badge">${content}</span>` : content;
}

function renderTable(table: ExportTable): string {
  const rows =
    table.rows.length > 0
      ? `<div class="table-scroll"><table>
<thead><tr>${table.columns.map((column) => `<th>${escapeExportHtml(column)}</th>`).join("")}</tr></thead>
<tbody>${table.rows
  .map(
    (row) =>
      `<tr>${table.columns
        .map((_, index) => `<td>${renderCell(row[index] ?? "")}</td>`)
        .join("")}</tr>`
  )
  .join("")}</tbody>
</table></div>`
      : `<p class="empty">${escapeExportHtml(table.emptyMessage)}</p>`;

  return `<div class="subsection">
<h3>${escapeExportHtml(table.title)}</h3>
${table.description ? `<p class="muted">${escapeExportHtml(table.description)}</p>` : ""}
${rows}
</div>`;
}

function renderCard(card: ExportCard): string {
  return `<article class="data-card">
<div class="card-heading">
${
  card.imageSrc
    ? `<img class="avatar" src="${escapeExportHtml(card.imageSrc)}" alt="${escapeExportHtml(
        card.imageAlt ?? ""
      )}" />`
    : '<div class="avatar avatar-placeholder" aria-hidden="true">AI</div>'
}
<div><h3>${escapeExportHtml(card.title)}</h3>${
    card.badge ? `<span class="badge">${escapeExportHtml(card.badge)}</span>` : ""
  }</div>
</div>
${card.description ? `<p class="card-copy">${escapeExportHtml(card.description)}</p>` : ""}
${renderFieldGrid(card.fields)}
${
  card.tags?.length
    ? `<div class="tags">${card.tags.map((tag) => `<span>${escapeExportHtml(tag)}</span>`).join("")}</div>`
    : ""
}
</article>`;
}

function renderSection(section: ExportPageSection): string {
  return `<section class="panel">
<div class="section-heading"><h2>${escapeExportHtml(section.title)}</h2>${
    section.description ? `<p>${escapeExportHtml(section.description)}</p>` : ""
  }</div>
${section.fields ? renderFieldGrid(section.fields) : ""}
${section.cards?.length ? `<div class="card-grid">${section.cards.map(renderCard).join("")}</div>` : ""}
${section.tables?.map(renderTable).join("") ?? ""}
</section>`;
}

function exportStyles(): string {
  return `
:root{color-scheme:light;--ink:#172033;--muted:#64748b;--line:#e5e7eb;--soft:#f8fafc;--amber:#d97706;--amber-soft:#fff7ed}
*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:var(--ink);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}
a{color:#b45309;font-weight:700;text-decoration:none}a:hover{text-decoration:underline}.shell{width:min(1160px,calc(100% - 32px));margin:0 auto;padding:28px 0 56px}
.topbar{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:24px}.brand{font-weight:900;letter-spacing:-.03em}.back{font-size:14px}
.hero{padding:34px;border:1px solid #fed7aa;border-radius:24px;background:linear-gradient(135deg,#fff 0%,var(--amber-soft) 100%);box-shadow:0 18px 50px rgba(15,23,42,.06)}
.eyebrow{margin:0 0 8px;color:var(--amber);font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.hero h1{margin:0;font-size:clamp(30px,5vw,48px);line-height:1.08;letter-spacing:-.045em}
.intro{max-width:760px;margin:14px 0 0;color:#475569;font-size:16px}.generated{margin-top:18px;color:var(--muted);font-size:13px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:14px;margin-top:22px}.stat{padding:18px;border:1px solid var(--line);border-radius:16px;background:#fff}
.stat-label{color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.stat-value{display:block;margin-top:5px;font-size:26px;font-weight:900;letter-spacing:-.03em}.stat-note{display:block;margin-top:2px;color:var(--muted);font-size:12px}
.panel{margin-top:20px;padding:28px;border:1px solid var(--line);border-radius:20px;background:#fff;box-shadow:0 10px 30px rgba(15,23,42,.04)}.section-heading{margin-bottom:20px}.section-heading h2,.subsection h3,.data-card h3{margin:0}.section-heading p,.muted{margin:6px 0 0;color:var(--muted)}
.field-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px;margin:0}.field{min-width:0;padding:14px;border-radius:14px;background:var(--soft)}dt{color:var(--muted);font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em}dd{margin:5px 0 0;overflow-wrap:anywhere;font-weight:700}
.subsection+.subsection{margin-top:28px}.table-scroll{margin-top:14px;overflow:auto;border:1px solid var(--line);border-radius:14px}table{width:100%;border-collapse:collapse;font-size:14px}th{padding:11px 13px;background:var(--soft);color:#475569;text-align:left;white-space:nowrap}td{padding:12px 13px;border-top:1px solid var(--line);vertical-align:top;min-width:110px}.empty{padding:18px;border:1px dashed #cbd5e1;border-radius:14px;background:var(--soft);color:var(--muted)}
.card-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.data-card{padding:20px;border:1px solid var(--line);border-radius:18px}.card-heading{display:flex;align-items:center;gap:13px;margin-bottom:14px}.avatar{width:58px;height:58px;flex:0 0 auto;border-radius:15px;border:1px solid var(--line);background:#fff;object-fit:cover}.avatar-placeholder{display:grid;place-items:center;background:linear-gradient(135deg,#fbbf24,#d97706);color:#fff;font-weight:900}.card-copy{color:var(--muted)}
.badge{display:inline-flex;margin-top:5px;padding:3px 9px;border-radius:999px;background:#fef3c7;color:#92400e;font-size:12px;font-weight:800}.tags{display:flex;flex-wrap:wrap;gap:7px;margin-top:14px}.tags span{padding:4px 9px;border-radius:999px;background:#f1f5f9;color:#475569;font-size:12px;font-weight:700}
.category-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:15px;margin-top:24px}.category{display:block;padding:22px;border:1px solid var(--line);border-radius:18px;background:#fff;color:var(--ink);transition:transform .15s ease,border-color .15s ease}.category:hover{transform:translateY(-2px);border-color:#f59e0b;text-decoration:none}.category-number{color:var(--amber);font-size:12px;font-weight:900}.category h2{margin:10px 0 7px;font-size:19px}.category p{margin:0;color:var(--muted);font-weight:500}.category-detail{display:block;margin-top:14px;color:#92400e;font-size:12px;font-weight:800}
.notice{margin-top:20px;padding:18px;border:1px solid #fde68a;border-radius:16px;background:#fffbeb;color:#78350f}.footer{margin-top:28px;color:#94a3b8;font-size:12px;text-align:center}
@media(max-width:640px){.shell{width:min(100% - 20px,1160px);padding-top:14px}.hero,.panel{padding:20px;border-radius:17px}.topbar{align-items:flex-start;flex-direction:column}.card-grid{grid-template-columns:1fr}}
`;
}

function documentShell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" />
<title>${escapeExportHtml(title)}</title>
<style>${exportStyles()}</style>
</head>
<body>${body}</body>
</html>`;
}

export function renderBusinessExportPage(options: ExportPageOptions): string {
  const stats = options.stats?.length
    ? `<div class="stats">${options.stats
        .map(
          (stat) => `<div class="stat"><span class="stat-label">${escapeExportHtml(
            stat.label
          )}</span><strong class="stat-value">${escapeExportHtml(stat.value)}</strong>${
            stat.note ? `<span class="stat-note">${escapeExportHtml(stat.note)}</span>` : ""
          }</div>`
        )
        .join("")}</div>`
    : "";

  return documentShell(
    options.title,
    `<main class="shell">
<div class="topbar"><div class="brand">Triven data export</div><a class="back" href="${escapeExportHtml(
      options.homeHref
    )}">← Back to Start Here</a></div>
<header class="hero">
<p class="eyebrow">${escapeExportHtml(options.eyebrow)}</p>
<h1>${escapeExportHtml(options.title)}</h1>
<p class="intro">${escapeExportHtml(options.intro)}</p>
<p class="generated">Export generated ${escapeExportHtml(formatExportDate(options.generatedAt))}</p>
${stats}
</header>
${options.sections.map(renderSection).join("")}
<p class="footer">Triven AI Agent Platform · Private account export</p>
</main>`
  );
}

export function renderBusinessExportHome(options: {
  businessName: string;
  generatedAt: Date;
  categories: ExportHomeCategory[];
  skippedImages: string[];
}): string {
  const imageNotice =
    options.skippedImages.length > 0
      ? `<div class="notice"><strong>Some images could not be copied.</strong><br />${escapeExportHtml(
          options.skippedImages.join(" ")
        )}</div>`
      : "";

  return documentShell(
    "Start Here - Triven data export",
    `<main class="shell">
<div class="topbar"><div class="brand">Triven</div></div>
<header class="hero">
<p class="eyebrow">Private account export</p>
<h1>Your ${escapeExportHtml(options.businessName)} data</h1>
<p class="intro">Start here, then open any section below. This export contains only your profile, dashboard, My Agents, and billing and usage information.</p>
<p class="generated">Export generated ${escapeExportHtml(formatExportDate(options.generatedAt))}</p>
</header>
<div class="category-grid">${options.categories
  .map(
    (category) => `<a class="category" href="${escapeExportHtml(category.href)}">
<span class="category-number">${escapeExportHtml(category.number)}</span>
<h2>${escapeExportHtml(category.title)}</h2>
<p>${escapeExportHtml(category.description)}</p>
<span class="category-detail">${escapeExportHtml(category.detail)} →</span>
</a>`
  )
  .join("")}</div>
${imageNotice}
<section class="panel"><div class="section-heading"><h2>What is not included</h2><p>To keep this export simple and focused, it does not contain raw conversations, email or SMS logs, login history, integrations, knowledge-base content, passwords, tokens, or agent source code.</p></div></section>
<p class="footer">Triven AI Agent Platform · Keep this ZIP private because it contains account and billing information.</p>
</main>`
  );
}

export function buildBusinessExportReadme(options: {
  businessName: string;
  generatedAt: Date;
  skippedImages: string[];
}): string {
  return [
    "TRIVEN BUSINESS DATA EXPORT",
    "===========================",
    "",
    `Business: ${options.businessName}`,
    `Generated: ${formatExportDate(options.generatedAt)}`,
    "",
    "HOW TO VIEW YOUR DATA",
    "1. Extract (unzip) this ZIP file.",
    "2. Open start-here.html in any modern web browser.",
    "3. Use the four section cards to browse your exported data.",
    "",
    "FOLDERS",
    "01-profile             Your account and business profile",
    "02-dashboard           The information shown on your dashboard",
    "03-my-agents           Your purchased and installed agents",
    "04-billing-and-usage   Billing summaries, usage, and invoice PDFs",
    "",
    "Images are included as normal PNG, JPG, or WEBP files when a safe embedded",
    "copy was available. Base64 image text is never written into this export.",
    ...(options.skippedImages.length
      ? ["", "IMAGE NOTES", ...options.skippedImages.map((message) => `- ${message}`)]
      : []),
    "",
    "Keep this archive private because it contains personal and billing information.",
    ""
  ].join("\n");
}
