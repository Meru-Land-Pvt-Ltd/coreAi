"use client";

import Link from "next/link";
import type { Route } from "next";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { getAuthUser, saveAuthSession, type AuthUser } from "@/lib/auth";

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
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentYear = new Date().getFullYear();

  useEffect(() => {
    const authUser = getAuthUser();
    if (authUser?.role === "ADMIN") {
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="w-full px-6 py-5">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Link data-testid="admin-auth-logo-home-link" href={"/" as Route} className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
              <span className="w-3 h-3 rounded-full bg-white" />
            </span>
            <span className="text-xl font-extrabold text-slate-900 tracking-tight" data-testid="auth-admin-auth-card-core-text">
              CORE
            </span>
          </Link>

          <Link data-testid="admin-auth-back-to-home-link"
            href={"/" as Route}
            className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors duration-200"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="bg-white shadow-lg rounded-2xl border border-gray-100 overflow-hidden">
            <div className="border-b border-gray-100 py-4">
              <p className="text-center text-sm font-semibold text-amber-600" data-testid="auth-admin-auth-card-platform-administration-text">
                Platform Administration
              </p>
            </div>

            <div className="p-8">
              <p className="text-center text-sm text-slate-500 mb-6" data-testid="auth-admin-auth-card-copy-subtitle-text">
                Sign in to manage users, approvals, agents, projects, and platform operations.
              </p>

              <h1 className="text-2xl font-extrabold text-slate-900 text-center" data-testid="auth-admin-auth-card-copy-title-heading">
                Admin Login
              </h1>

              <p className="mt-2 text-sm text-slate-600 text-center" data-testid="auth-admin-auth-card-sign-in-with-your-admin-email-and-text">
                Sign in with your admin email and password
              </p>

              <form data-testid="admin-auth-form" className="mt-6" onSubmit={handleSubmit} noValidate>
                <div className="mb-4">
                  <label htmlFor="admin-email" className="sr-only" data-testid="auth-admin-auth-card-admin-email-label">
                    Admin email
                  </label>
                  <input data-testid="admin-auth-email-input"
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(event) => {
                      setEmail(event.target.value);
                      setError("");
                    }}
                    placeholder="admin@company.com"
                    autoComplete="email"
                    required
                    className={`w-full px-4 py-3.5 text-base rounded-xl border text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 transition duration-200 ${error ? "border-red-300" : "border-gray-200"
                      }`}
                  />
                </div>

                <div>
                  <label htmlFor="admin-password" className="sr-only" data-testid="auth-admin-auth-card-password-label">
                    Password
                  </label>
                  <input data-testid="admin-auth-password-input"
                    id="admin-password"
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    required
                    className="w-full px-4 py-3.5 text-base rounded-xl border border-gray-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 transition duration-200"
                  />
                </div>

                {error ? (
                  <p className="mt-3 text-sm text-red-500" role="alert" data-testid="auth-admin-auth-card-error-text">
                    {error}
                  </p>
                ) : null}

                <button data-testid="admin-auth-submit"
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-6 w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? "Signing in..." : "Sign In"}
                </button>
              </form>
            </div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-400 tracking-wide" data-testid="auth-admin-auth-card-256-bit-encryption-soc-2-compliant-restricted-text">
              256-bit encryption &nbsp;•&nbsp; SOC 2 compliant &nbsp;•&nbsp;
              Restricted access
            </p>
          </div>
        </div>
      </main>

      <footer className="w-full px-6 py-6">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <Link data-testid="admin-auth-privacy-policy-link" href={"/" as Route} className="hover:text-slate-600 transition-colors duration-200">
              Privacy Policy
            </Link>

            <Link data-testid="admin-auth-terms-of-service-link" href={"/" as Route} className="hover:text-slate-600 transition-colors duration-200">
              Terms of Service
            </Link>

            <Link data-testid="admin-auth-help-link" href={"/" as Route} className="hover:text-slate-600 transition-colors duration-200">
              Help
            </Link>
          </div>

          <p data-testid="auth-admin-auth-card-current-year-core-ai-agent-platform-text">© {currentYear} CORE AI Agent Platform</p>
        </div>
      </footer>
    </div>
  );
}
