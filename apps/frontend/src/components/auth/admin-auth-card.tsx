"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { getAuthUser, hasAuthRole, saveAuthSession, type AuthUser } from "@/lib/auth";

type AuthResponse = {
  token: string;
  user: AuthUser;
};

const ADMIN_DASHBOARD_PATH = "/admin/dashboard" as Route;

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Admin is login-only. Admin accounts are created exclusively by the seed script;
// there is no public admin signup.
export function AdminAuthCard() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentYear = new Date().getFullYear();

  /**
   * Every other door on Triven opens with an emailed code; this one asked for
   * a password, and most accounts have never set one — which locked the owner
   * out of his own admin. The code path is the same one the rest of the
   * platform uses, and the backend still refuses to hand an admin code to an
   * address that is not already an admin.
   */
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState("");
  const [sendingCode, setSendingCode] = useState(false);
  const [notice, setNotice] = useState("");

  async function sendCode() {
    const cleanEmail = email.trim().toLowerCase();
    if (!isValidEmail(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }
    try {
      setError("");
      setNotice("");
      setSendingCode(true);
      const result = await apiPost<{ email: string }>("/auth/send-verification-code", {
        email: cleanEmail,
        role: "ADMIN"
      });
      if (!result.success) {
        setError(result.error ?? "Could not send the code.");
        return;
      }
      setCodeSent(true);
      setNotice(`We emailed a 6-digit code to ${cleanEmail}.`);
    } catch {
      setError("Something went wrong sending the code.");
    } finally {
      setSendingCode(false);
    }
  }

  async function submitCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    try {
      setError("");
      setIsSubmitting(true);
      const result = await apiPost<AuthResponse>("/auth/verify-code", {
        email: cleanEmail,
        code: code.trim(),
        role: "ADMIN"
      });
      if (!result.success || !result.data) {
        setError(result.error ?? "That code did not work.");
        return;
      }
      saveAuthSession(result.data.token, result.data.user);
      router.push(ADMIN_DASHBOARD_PATH);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  useEffect(() => {
    const authUser = getAuthUser();
    if (hasAuthRole(authUser, "ADMIN")) {
      router.replace(ADMIN_DASHBOARD_PATH);
    }
  }, [router]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    try {
      setError("");
      setIsSubmitting(true);

      const result = await apiPost<AuthResponse>("/auth/login", {
        email: cleanEmail,
        password,
        role: "ADMIN"
      });

      if (!result.success || !result.data) {
        setError(result.error ?? "Login failed");
        return;
      }

      saveAuthSession(result.data.token, result.data.user);
      router.push(ADMIN_DASHBOARD_PATH);
    } catch {
      setError("Something went wrong. Please check if backend is running.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="relative isolate flex min-h-screen flex-col overflow-hidden bg-[#0b1120] text-slate-900">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-20"
        style={{
          backgroundImage:
            "radial-gradient(720px 460px at 50% 30%, rgba(245, 158, 11, 0.16), transparent 70%), linear-gradient(rgba(148, 163, 184, 0.045) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.045) 1px, transparent 1px), linear-gradient(180deg, #0b1120 0%, #0f172a 55%, #0b1120 100%)",
          backgroundSize: "100% 100%, 54px 54px, 54px 54px, 100% 100%"
        }}
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10 bg-[radial-gradient(120%_90%_at_50%_50%,transparent_55%,rgba(2,6,23,0.55)_100%)]"
      />

      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-14">
        <section className="w-full max-w-md animate-[admin-card-rise_.55s_cubic-bezier(.16,1,.3,1)_both]">
          <div className="rounded-2xl bg-white p-7 shadow-[inset_0_1px_0_rgba(255,255,255,.6),0_30px_60px_-15px_rgba(2,6,23,.7),0_8px_24px_-8px_rgba(2,6,23,.5)] sm:p-8">
            <header className="flex items-start justify-between gap-4">
              <Link
                data-testid="admin-auth-logo-home-link"
                href={"/" as Route}
                className="flex items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300/50"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-gradient-to-br from-amber-400/15 to-amber-100 shadow-sm ring-1 ring-amber-200">
                  <Image
                    src="/triven.ai word logo transparent bg.PNG"
                    alt="Trivern logo"
                    width={40}
                    height={40}
                    className="h-10 w-10 scale-125 object-contain"
                    priority
                  />
                </span>
                <span
                  className="text-[1.35rem] font-extrabold tracking-normal text-slate-900"
                  data-testid="auth-admin-auth-card-triven-text"
                >
                  Triven.ai
                </span>
              </Link>

              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">
                <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="11" width="16" height="9" rx="2" />
                  <path d="M8 11V7a4 4 0 1 1 8 0v4" />
                </svg>
                <span className="text-[0.65rem] font-semibold uppercase tracking-normal">Secured</span>
              </span>
            </header>

            <p className="mt-3 text-xs font-medium uppercase tracking-normal text-slate-400">
              Admin Portal
            </p>

            <div className="mt-5 border-t border-slate-100" />

            <div className="pt-6">
              <h1
                className="text-2xl font-bold tracking-normal text-slate-900"
                data-testid="auth-admin-auth-card-copy-title-heading"
              >
                Sign in to Admin
              </h1>
              <p
                className="mt-1.5 text-sm text-slate-500"
                data-testid="auth-admin-auth-card-copy-subtitle-text"
              >
                Authorized Trivern personnel only.
              </p>

              <form data-testid="admin-auth-form" className="mt-6 space-y-5" onSubmit={handleSubmit} noValidate>
                <div>
                  <label htmlFor="admin-email" className="block text-sm font-medium text-slate-700" data-testid="auth-admin-auth-card-admin-email-label">
                    Email address
                  </label>
                  <input
                    data-testid="admin-auth-email-input"
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError("");
                    }}
                    placeholder="admin@triven.ai"
                    autoComplete="username"
                    required
                    aria-invalid={Boolean(error)}
                    className={`mt-1.5 w-full rounded-xl border bg-white p-3.5 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100 ${error ? "border-red-300" : "border-gray-200"}`}
                  />
                </div>

                <div>
                  <label htmlFor="admin-password" className="block text-sm font-medium text-slate-700" data-testid="auth-admin-auth-card-password-label">
                    Password
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      data-testid="admin-auth-password-input"
                      id="admin-password"
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setError("");
                      }}
                      placeholder="••••••••••••"
                      autoComplete="current-password"
                      required
                      aria-invalid={Boolean(error)}
                      className={`w-full rounded-xl border bg-white p-3.5 pr-12 text-base text-slate-900 placeholder:text-slate-400 transition focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100 ${error ? "border-red-300" : "border-gray-200"}`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((visible) => !visible)}
                      aria-label={showPassword ? "Hide password" : "Show password"}
                      aria-pressed={showPassword}
                      className="absolute right-2.5 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-50 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    >
                      {showPassword ? (
                        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c6.5 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68M6.61 6.61A13.5 13.5 0 0 0 2 12s3.5 7 10 7a9.12 9.12 0 0 0 5.39-1.61M14.12 14.12A3 3 0 1 1 9.88 9.88M2 2l20 20" />
                        </svg>
                      ) : (
                        <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-400">
                    <svg aria-hidden="true" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                      <circle cx="12" cy="12" r="9" />
                    </svg>
                    Minimum 6 characters
                  </p>
                </div>

                {error ? (
                  <p className="flex items-start gap-1.5 text-sm text-red-500" role="alert" data-testid="auth-admin-auth-card-error-text">
                    <svg aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
                    </svg>
                    {error}
                  </p>
                ) : null}

                <label className="flex cursor-pointer select-none items-center gap-2.5">
                  <input type="checkbox" className="peer sr-only" />
                  <span className="grid h-5 w-5 place-items-center rounded-md border border-gray-300 bg-white transition-colors peer-checked:border-amber-500 peer-checked:bg-amber-500 peer-focus-visible:ring-2 peer-focus-visible:ring-amber-300">
                    <svg aria-hidden="true" className="h-3 w-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                  </span>
                  <span className="text-sm text-slate-600">Remember this device for 30 days</span>
                </label>

                <button
                  data-testid="admin-auth-submit"
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 py-3.5 font-semibold text-white shadow-sm shadow-amber-500/30 transition hover:bg-amber-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
                >
                  {isSubmitting ? (
                    <>
                      <svg aria-hidden="true" className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Signing in...
                    </>
                  ) : (
                    "Continue"
                  )}
                </button>
              </form>

              {/* The way in for an admin who never set a password — which is
                  most of them, since every other Triven login is a code. */}
              <div className="mt-6 border-t border-slate-100 pt-5">
                {notice ? (
                  <p className="mb-3 text-sm text-emerald-600" data-testid="admin-auth-code-notice">
                    {notice}
                  </p>
                ) : null}

                {codeSent ? (
                  <form className="space-y-3" onSubmit={submitCode}>
                    <label htmlFor="admin-code" className="block text-sm font-medium text-slate-700">
                      6-digit code from your email
                    </label>
                    <input
                      id="admin-code"
                      data-testid="admin-auth-code-input"
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="123456"
                      className="w-full rounded-xl border border-gray-200 bg-white p-3.5 text-center text-lg tracking-[0.4em] text-slate-900 placeholder:tracking-normal placeholder:text-slate-300 focus:border-amber-400 focus:outline-none focus:ring-4 focus:ring-amber-100"
                    />
                    <button
                      type="submit"
                      data-testid="admin-auth-code-submit"
                      disabled={isSubmitting}
                      className="w-full rounded-xl border border-amber-300 bg-white py-3 font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-60"
                    >
                      {isSubmitting ? "Signing in…" : "Sign in with this code"}
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    data-testid="admin-auth-send-code"
                    onClick={() => void sendCode()}
                    disabled={sendingCode}
                    className="w-full rounded-xl border border-slate-200 bg-white py-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-60"
                  >
                    {sendingCode ? "Sending…" : "No password? Email me a sign-in code"}
                  </button>
                )}
              </div>
            </div>
          </div>

          <p className="mt-6 text-center text-xs tracking-normal text-slate-500" data-testid="auth-admin-auth-card-256-bit-encryption-soc-2-compliant-restricted-text">
            256-bit encryption &nbsp;•&nbsp; SOC 2 compliant &nbsp;•&nbsp; Restricted access
          </p>
        </section>
      </main>

      <footer className="w-full px-6 py-6 text-xs text-slate-500">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <div className="flex items-center gap-4">
            <Link data-testid="admin-auth-privacy-policy-link" href={"/privacy" as Route} className="transition hover:text-slate-300">
              Privacy Policy
            </Link>
            <Link data-testid="admin-auth-terms-of-service-link" href={"/terms" as Route} className="transition hover:text-slate-300">
              Terms of Service
            </Link>
            <Link data-testid="admin-auth-help-link" href={"/contact" as Route} className="transition hover:text-slate-300">
              Help
            </Link>
          </div>
          <p data-testid="auth-admin-auth-card-current-year-triven-ai-agent-platform-text">© {currentYear} Trivern AI Agent Platform</p>
        </div>
      </footer>
    </div>
  );
}
