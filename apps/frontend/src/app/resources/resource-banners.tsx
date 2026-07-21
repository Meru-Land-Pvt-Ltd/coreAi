/**
 * Inline help-article banners (no /public SVG fetch — avoids broken <img> SVG loads).
 */
import type { ComponentType, ReactNode } from "react";

type BannerProps = { title?: string };

function Frame({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1200 320"
      className="h-auto w-full"
      role="img"
      aria-label={label}
      data-testid="resources-article-image-el"
    >
      {children}
    </svg>
  );
}

function SetupBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Setup guide banner"}>
      <defs>
        <linearGradient id="rb-setup-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="55%" stopColor="#FEF3C7" />
          <stop offset="100%" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-setup-bg)" />
      <circle cx="1040" cy="40" r="120" fill="#F59E0B" fillOpacity="0.12" />
      <circle cx="180" cy="280" r="90" fill="#FBBF24" fillOpacity="0.14" />
      <rect x="90" y="70" width="420" height="180" rx="20" fill="#FFFFFF" stroke="#FDE68A" strokeWidth="2" />
      <rect x="120" y="100" width="160" height="12" rx="6" fill="#F59E0B" />
      <rect x="120" y="128" width="280" height="10" rx="5" fill="#E2E8F0" />
      <rect x="120" y="150" width="240" height="10" rx="5" fill="#E2E8F0" />
      <rect x="120" y="188" width="110" height="36" rx="10" fill="#F59E0B" />
      <text x="145" y="211" fill="#FFFFFF" fontSize="14" fontWeight="700">
        Go live
      </text>
      <rect x="620" y="70" width="200" height="180" rx="18" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <circle cx="720" cy="140" r="28" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="3" />
      <path d="M710 140h20M720 130v20" stroke="#B45309" strokeWidth="3" strokeLinecap="round" />
      <rect x="860" y="90" width="220" height="140" rx="18" fill="#0F172A" />
      <circle cx="900" cy="130" r="8" fill="#FBBF24" />
      <rect x="920" y="124" width="120" height="8" rx="4" fill="#64748B" />
      <rect x="890" y="160" width="160" height="8" rx="4" fill="#334155" />
      <rect x="890" y="182" width="90" height="8" rx="4" fill="#F59E0B" />
    </Frame>
  );
}

function PhoneBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Phone connection banner"}>
      <defs>
        <linearGradient id="rb-phone-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#F0F9FF" />
          <stop offset="50%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#FFF7ED" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-phone-bg)" />
      <circle cx="200" cy="160" r="70" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="3" />
      <rect x="175" y="125" width="50" height="70" rx="12" fill="#B45309" />
      <circle cx="200" cy="205" r="6" fill="#FEF3C7" />
      <path d="M290 160h180" stroke="#F59E0B" strokeWidth="4" strokeDasharray="10 10" strokeLinecap="round" />
      <polygon points="470,160 450,150 450,170" fill="#F59E0B" />
      <rect x="500" y="70" width="140" height="180" rx="24" fill="#0F172A" />
      <rect x="516" y="92" width="108" height="120" rx="8" fill="#1E293B" />
      <circle cx="570" cy="230" r="10" fill="#F59E0B" />
      <path d="M680 160h160" stroke="#38BDF8" strokeWidth="4" strokeDasharray="10 10" strokeLinecap="round" />
      <polygon points="840,160 820,150 820,170" fill="#38BDF8" />
      <rect x="870" y="90" width="200" height="140" rx="18" fill="#FFFFFF" stroke="#BAE6FD" strokeWidth="2" />
      <text x="900" y="170" fill="#64748B" fontSize="14" fontWeight="600">
        Forwarding phone
      </text>
    </Frame>
  );
}

function MissedCallBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Missed call text-back banner"}>
      <defs>
        <linearGradient id="rb-missed-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF7ED" />
          <stop offset="100%" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-missed-bg)" />
      <rect x="80" y="70" width="280" height="180" rx="20" fill="#FFFFFF" stroke="#FED7AA" strokeWidth="2" />
      <circle cx="140" cy="120" r="24" fill="#FFEDD5" />
      <text x="132" y="128" fill="#C2410C" fontSize="22" fontWeight="800">
        !
      </text>
      <rect x="180" y="108" width="140" height="12" rx="6" fill="#FB923C" />
      <rect x="180" y="132" width="100" height="10" rx="5" fill="#E2E8F0" />
      <text x="120" y="200" fill="#9A3412" fontSize="16" fontWeight="700">
        Missed call
      </text>
      <path d="M390 160h100" stroke="#CBD5E1" strokeWidth="3" />
      <polygon points="490,160 470,150 470,170" fill="#CBD5E1" />
      <rect x="520" y="55" width="300" height="210" rx="22" fill="#0F172A" />
      <rect x="540" y="80" width="200" height="70" rx="14" fill="#1E293B" />
      <text x="560" y="110" fill="#F8FAFC" fontSize="13" fontWeight="600">
        Hi — we missed you!
      </text>
      <text x="560" y="132" fill="#94A3B8" fontSize="12">
        Reply to book or ask a question.
      </text>
      <rect x="540" y="170" width="160" height="50" rx="14" fill="#F59E0B" />
      <text x="560" y="200" fill="#FFFFFF" fontSize="13" fontWeight="700">
        SMS text-back
      </text>
      <path d="M850 160h80" stroke="#34D399" strokeWidth="3" />
      <polygon points="930,160 910,150 910,170" fill="#34D399" />
      <rect x="960" y="90" width="160" height="140" rx="18" fill="#ECFDF5" stroke="#6EE7B7" strokeWidth="2" />
      <text x="990" y="170" fill="#065F46" fontSize="14" fontWeight="700">
        Lead saved
      </text>
    </Frame>
  );
}

function HoursBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Business hours banner"}>
      <defs>
        <linearGradient id="rb-hours-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#EEF2FF" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-hours-bg)" />
      <circle cx="220" cy="160" r="90" fill="#FFFFFF" stroke="#F59E0B" strokeWidth="8" />
      <circle cx="220" cy="160" r="8" fill="#B45309" />
      <line x1="220" y1="160" x2="220" y2="100" stroke="#B45309" strokeWidth="6" strokeLinecap="round" />
      <line x1="220" y1="160" x2="270" y2="180" stroke="#F59E0B" strokeWidth="5" strokeLinecap="round" />
      <rect x="380" y="60" width="720" height="200" rx="20" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="420" y="105" fill="#0F172A" fontSize="22" fontWeight="800">
        Business hours
      </text>
      <rect x="420" y="130" width="200" height="36" rx="10" fill="#ECFDF5" />
      <text x="440" y="153" fill="#047857" fontSize="14" fontWeight="700">
        Mon–Fri · Open
      </text>
      <rect x="640" y="130" width="200" height="36" rx="10" fill="#FFF1F2" />
      <text x="660" y="153" fill="#BE123C" fontSize="14" fontWeight="700">
        Sat–Sun · Closed
      </text>
      <text x="860" y="210" fill="#64748B" fontSize="14" fontWeight="600">
        8:00 – 18:00
      </text>
    </Frame>
  );
}

function BillingBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Billing banner"}>
      <defs>
        <linearGradient id="rb-billing-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ECFDF5" />
          <stop offset="60%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-billing-bg)" />
      <rect x="100" y="70" width="340" height="180" rx="22" fill="#0F172A" />
      <rect x="130" y="100" width="60" height="40" rx="8" fill="#F59E0B" />
      <rect x="210" y="110" width="180" height="12" rx="6" fill="#64748B" />
      <text x="150" y="210" fill="#F8FAFC" fontSize="14" fontFamily="ui-monospace, monospace">
        •••• 4242
      </text>
      <rect x="520" y="80" width="260" height="160" rx="18" fill="#FFFFFF" stroke="#A7F3D0" strokeWidth="2" />
      <text x="550" y="125" fill="#064E3B" fontSize="16" fontWeight="700">
        Invoice
      </text>
      <text x="550" y="215" fill="#059669" fontSize="22" fontWeight="800">
        $49.00
      </text>
      <rect x="840" y="80" width="240" height="160" rx="18" fill="#FFFBEB" stroke="#FDE68A" strokeWidth="2" />
      <text x="870" y="130" fill="#92400E" fontSize="15" fontWeight="700">
        Monthly plan
      </text>
      <rect x="870" y="185" width="120" height="32" rx="10" fill="#F59E0B" />
      <text x="890" y="206" fill="#FFFFFF" fontSize="13" fontWeight="700">
        Manage
      </text>
    </Frame>
  );
}

function SplitBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "70/30 payment split banner"}>
      <defs>
        <linearGradient id="rb-split-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#F1F5F9" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-split-bg)" />
      <text x="80" y="70" fill="#0F172A" fontSize="24" fontWeight="800">
        How Triven splits a $100 sale
      </text>
      <rect x="80" y="110" width="1040" height="64" rx="16" fill="#E2E8F0" />
      <rect x="80" y="110" width="728" height="64" rx="16" fill="#F59E0B" />
      <text x="110" y="150" fill="#FFFFFF" fontSize="20" fontWeight="800">
        Architect 70% · $70
      </text>
      <text x="850" y="150" fill="#334155" fontSize="18" fontWeight="700">
        Triven 30% · $30
      </text>
      <rect x="80" y="210" width="300" height="70" rx="14" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="105" y="252" fill="#64748B" fontSize="15" fontWeight="600">
        Buyer pays Triven
      </text>
      <rect x="420" y="210" width="300" height="70" rx="14" fill="#FFFFFF" stroke="#FDE68A" strokeWidth="2" />
      <text x="445" y="252" fill="#B45309" fontSize="15" fontWeight="700">
        You withdraw on Payouts
      </text>
      <rect x="760" y="210" width="360" height="70" rx="14" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="790" y="252" fill="#64748B" fontSize="15" fontWeight="600">
        Same split every renewal
      </text>
    </Frame>
  );
}

function TroubleshootBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Troubleshooting banner"}>
      <defs>
        <linearGradient id="rb-trouble-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFF7ED" />
          <stop offset="100%" stopColor="#FEF2F2" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-trouble-bg)" />
      <circle cx="220" cy="160" r="80" fill="#FFEDD5" stroke="#F97316" strokeWidth="6" />
      <text x="200" y="175" fill="#C2410C" fontSize="56" fontWeight="800">
        !
      </text>
      <rect x="380" y="70" width="700" height="180" rx="20" fill="#FFFFFF" stroke="#FED7AA" strokeWidth="2" />
      <text x="420" y="120" fill="#0F172A" fontSize="22" fontWeight="800">
        Quick checks
      </text>
      <text x="450" y="160" fill="#475569" fontSize="15" fontWeight="600">
        Agent is not paused
      </text>
      <text x="450" y="195" fill="#475569" fontSize="15" fontWeight="600">
        Forwarding phone verified
      </text>
      <text x="450" y="230" fill="#475569" fontSize="15" fontWeight="600">
        Test SMS after any change
      </text>
      <rect x="420" y="148" width="18" height="18" rx="4" fill="#F59E0B" />
      <rect x="420" y="183" width="18" height="18" rx="4" fill="#F59E0B" />
      <rect x="420" y="218" width="18" height="18" rx="4" fill="#F59E0B" />
    </Frame>
  );
}

function SecurityBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Account and security banner"}>
      <defs>
        <linearGradient id="rb-sec-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#EFF6FF" />
          <stop offset="100%" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-sec-bg)" />
      <rect x="160" y="70" width="200" height="180" rx="24" fill="#FFFFFF" stroke="#BFDBFE" strokeWidth="3" />
      <circle cx="260" cy="130" r="32" fill="#DBEAFE" />
      <rect x="220" y="175" width="80" height="40" rx="12" fill="#1D4ED8" />
      <rect x="450" y="90" width="560" height="140" rx="18" fill="#0F172A" />
      <text x="490" y="145" fill="#F8FAFC" fontSize="22" fontWeight="800">
        Account &amp; security
      </text>
      <text x="490" y="180" fill="#94A3B8" fontSize="15">
        Email · sessions · privacy · export
      </text>
    </Frame>
  );
}

function ArchitectBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Architect builder banner"}>
      <defs>
        <linearGradient id="rb-arch-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ECFDF5" />
          <stop offset="50%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-arch-bg)" />
      <rect x="70" y="50" width="1060" height="220" rx="20" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <rect x="100" y="80" width="160" height="70" rx="14" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="2" />
      <text x="125" y="122" fill="#92400E" fontSize="14" fontWeight="700">
        Trigger
      </text>
      <path d="M270 115h70" stroke="#CBD5E1" strokeWidth="3" />
      <polygon points="340,115 320,105 320,125" fill="#CBD5E1" />
      <rect x="350" y="80" width="160" height="70" rx="14" fill="#ECFDF5" stroke="#34D399" strokeWidth="2" />
      <text x="385" y="122" fill="#065F46" fontSize="14" fontWeight="700">
        SMS / Voice
      </text>
      <path d="M520 115h70" stroke="#CBD5E1" strokeWidth="3" />
      <polygon points="590,115 570,105 570,125" fill="#CBD5E1" />
      <rect x="600" y="80" width="160" height="70" rx="14" fill="#EEF2FF" stroke="#818CF8" strokeWidth="2" />
      <text x="635" y="122" fill="#3730A3" fontSize="14" fontWeight="700">
        Calendar
      </text>
      <text x="820" y="130" fill="#0F172A" fontSize="20" fontWeight="800">
        Builder canvas
      </text>
      <text x="820" y="160" fill="#64748B" fontSize="14">
        Wire · test · publish
      </text>
    </Frame>
  );
}

function LogicBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Logic and conditions banner"}>
      <defs>
        <linearGradient id="rb-logic-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#F8FAFC" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-logic-bg)" />
      <rect x="80" y="120" width="160" height="60" rx="14" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="105" y="156" fill="#475569" fontSize="14" fontWeight="700">
        Incoming call
      </text>
      <path d="M250 150h80" stroke="#CBD5E1" strokeWidth="3" />
      <polygon points="330,150 310,140 310,160" fill="#CBD5E1" />
      <polygon points="420,80 500,150 420,220 340,150" fill="#FFFBEB" stroke="#F59E0B" strokeWidth="3" />
      <text x="385" y="145" fill="#92400E" fontSize="13" fontWeight="700">
        Within
      </text>
      <text x="372" y="165" fill="#92400E" fontSize="13" fontWeight="700">
        hours?
      </text>
      <path d="M500 150h120" stroke="#10B981" strokeWidth="3" />
      <polygon points="620,150 600,140 600,160" fill="#10B981" />
      <text x="530" y="140" fill="#059669" fontSize="13" fontWeight="800">
        Yes
      </text>
      <rect x="640" y="120" width="180" height="60" rx="14" fill="#ECFDF5" stroke="#6EE7B7" strokeWidth="2" />
      <text x="670" y="156" fill="#065F46" fontSize="14" fontWeight="700">
        Live / open path
      </text>
      <path d="M420 220v40" stroke="#F43F5E" strokeWidth="3" />
      <polygon points="420,270 410,250 430,250" fill="#F43F5E" />
      <text x="435" y="250" fill="#E11D48" fontSize="13" fontWeight="800">
        No
      </text>
      <rect x="340" y="275" width="200" height="30" rx="10" fill="#FFF1F2" stroke="#FDA4AF" strokeWidth="2" />
      <text x="375" y="295" fill="#9F1239" fontSize="13" fontWeight="700">
        After-hours path
      </text>
      <text x="880" y="150" fill="#0F172A" fontSize="20" fontWeight="800">
        Logic &amp; conditions
      </text>
    </Frame>
  );
}

function KnowledgeBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Knowledge and FAQs banner"}>
      <defs>
        <linearGradient id="rb-know-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F5F3FF" />
          <stop offset="100%" stopColor="#FFFBEB" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-know-bg)" />
      <rect x="100" y="60" width="280" height="200" rx="18" fill="#FFFFFF" stroke="#DDD6FE" strokeWidth="2" />
      <rect x="130" y="90" width="180" height="14" rx="7" fill="#A78BFA" />
      <rect x="130" y="120" width="200" height="10" rx="5" fill="#E2E8F0" />
      <rect x="130" y="180" width="120" height="36" rx="10" fill="#F59E0B" />
      <text x="150" y="203" fill="#FFFFFF" fontSize="13" fontWeight="700">
        Add FAQ
      </text>
      <rect x="440" y="70" width="620" height="180" rx="18" fill="#0F172A" />
      <text x="480" y="120" fill="#F8FAFC" fontSize="18" fontWeight="700">
        Q: Do you take new customers?
      </text>
      <text x="480" y="160" fill="#94A3B8" fontSize="15">
        A: Yes — reply here or book online.
      </text>
    </Frame>
  );
}

function CalendarBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Calendar booking banner"}>
      <defs>
        <linearGradient id="rb-cal-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#EEF2FF" />
          <stop offset="100%" stopColor="#FFFBEB" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-cal-bg)" />
      <rect x="120" y="50" width="280" height="220" rx="18" fill="#FFFFFF" stroke="#C7D2FE" strokeWidth="2" />
      <rect x="120" y="50" width="280" height="48" rx="18" fill="#6366F1" />
      <rect x="120" y="80" width="280" height="18" fill="#6366F1" />
      <text x="200" y="82" fill="#FFFFFF" fontSize="16" fontWeight="700">
        Calendar
      </text>
      <rect x="200" y="160" width="36" height="28" rx="6" fill="#F59E0B" />
      <rect x="480" y="80" width="560" height="160" rx="18" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="520" y="135" fill="#0F172A" fontSize="22" fontWeight="800">
        Book on your real calendar
      </text>
      <text x="520" y="170" fill="#64748B" fontSize="15">
        Connect Google Calendar · confirm by SMS
      </text>
      <rect x="520" y="190" width="160" height="32" rx="10" fill="#F59E0B" />
      <text x="545" y="211" fill="#FFFFFF" fontSize="13" fontWeight="700">
        Connect
      </text>
    </Frame>
  );
}

function StatsBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Stats banner"}>
      <defs>
        <linearGradient id="rb-stats-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#F8FAFC" />
          <stop offset="100%" stopColor="#FFFBEB" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-stats-bg)" />
      <rect x="80" y="60" width="240" height="100" rx="16" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="105" y="100" fill="#64748B" fontSize="13" fontWeight="600">
        Calls
      </text>
      <text x="105" y="135" fill="#0F172A" fontSize="28" fontWeight="800">
        128
      </text>
      <rect x="350" y="60" width="240" height="100" rx="16" fill="#FFFFFF" stroke="#FDE68A" strokeWidth="2" />
      <text x="375" y="100" fill="#92400E" fontSize="13" fontWeight="600">
        Leads
      </text>
      <text x="375" y="135" fill="#B45309" fontSize="28" fontWeight="800">
        46
      </text>
      <rect x="620" y="60" width="240" height="100" rx="16" fill="#FFFFFF" stroke="#A7F3D0" strokeWidth="2" />
      <text x="645" y="100" fill="#047857" fontSize="13" fontWeight="600">
        Bookings
      </text>
      <text x="645" y="135" fill="#065F46" fontSize="28" fontWeight="800">
        19
      </text>
      <rect x="80" y="190" width="1040" height="90" rx="16" fill="#0F172A" />
      <polyline
        points="120,250 220,230 320,240 420,210 520,220 620,200 720,215 820,195 920,205 1040,185"
        fill="none"
        stroke="#F59E0B"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Frame>
  );
}

function MessageBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "SMS message banner"}>
      <defs>
        <linearGradient id="rb-msg-bg" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#FFFBEB" />
          <stop offset="100%" stopColor="#F0FDF4" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-msg-bg)" />
      <rect x="180" y="50" width="280" height="220" rx="28" fill="#0F172A" />
      <rect x="200" y="80" width="240" height="150" rx="16" fill="#1E293B" />
      <rect x="220" y="100" width="160" height="44" rx="12" fill="#F59E0B" />
      <text x="235" y="127" fill="#FFFFFF" fontSize="12" fontWeight="600">
        Thanks for calling…
      </text>
      <rect x="560" y="90" width="520" height="140" rx="18" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <text x="600" y="145" fill="#0F172A" fontSize="22" fontWeight="800">
        Edit your agent SMS
      </text>
      <text x="600" y="180" fill="#64748B" fontSize="15">
        Configure → save → test on the next missed call
      </text>
    </Frame>
  );
}

function VoiceBanner({ title }: BannerProps) {
  return (
    <Frame label={title || "Voice preview banner"}>
      <defs>
        <linearGradient id="rb-voice-bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FDF4FF" />
          <stop offset="100%" stopColor="#FFFBEB" />
        </linearGradient>
      </defs>
      <rect width="1200" height="320" fill="url(#rb-voice-bg)" />
      <circle cx="220" cy="160" r="70" fill="#FEF3C7" stroke="#F59E0B" strokeWidth="4" />
      <rect x="200" y="125" width="40" height="55" rx="20" fill="#B45309" />
      <rect x="400" y="100" width="640" height="120" rx="18" fill="#FFFFFF" stroke="#E2E8F0" strokeWidth="2" />
      <line x1="450" y1="160" x2="450" y2="120" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" />
      <line x1="480" y1="160" x2="480" y2="110" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" />
      <line x1="510" y1="160" x2="510" y2="130" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" />
      <line x1="540" y1="160" x2="540" y2="105" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" />
      <line x1="570" y1="160" x2="570" y2="125" stroke="#F59E0B" strokeWidth="6" strokeLinecap="round" />
      <text x="620" y="155" fill="#0F172A" fontSize="20" fontWeight="800">
        Preview voice
      </text>
      <text x="620" y="185" fill="#64748B" fontSize="14">
        Hear it before buyers do
      </text>
    </Frame>
  );
}

const BANNER_BY_KEY: Record<string, ComponentType<BannerProps>> = {
  setup: SetupBanner,
  phone: PhoneBanner,
  "missed-call": MissedCallBanner,
  hours: HoursBanner,
  billing: BillingBanner,
  split: SplitBanner,
  troubleshoot: TroubleshootBanner,
  security: SecurityBanner,
  architect: ArchitectBanner,
  logic: LogicBanner,
  knowledge: KnowledgeBanner,
  calendar: CalendarBanner,
  stats: StatsBanner,
  message: MessageBanner,
  voice: VoiceBanner,
};

/** Resolve banner key from image path like /resources/banners/setup.svg or /help-banners/setup.svg */
export function getBannerKeyFromImage(image?: string): string | null {
  if (!image) return null;
  const match = image.match(/(?:banners|help-banners)\/([a-z0-9-]+)\.svg$/i);
  return match?.[1] ?? null;
}

export function ResourceArticleBanner({
  image,
  alt,
}: {
  image?: string;
  alt?: string;
}) {
  const key = getBannerKeyFromImage(image);
  if (!key) return null;
  const Comp = BANNER_BY_KEY[key];
  if (!Comp) return null;
  return (
    <div
      className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-sm"
      data-testid="resources-article-image"
    >
      <Comp title={alt} />
    </div>
  );
}
