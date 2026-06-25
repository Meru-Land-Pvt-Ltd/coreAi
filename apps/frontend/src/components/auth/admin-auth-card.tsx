"use client";

import Link from "next/link";
import type { Route } from "next";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { saveAuthSession, type AuthUser } from "@/lib/auth";

type AdminAuthMode = "login" | "signup";

type AdminAuthCardProps = {
  mode: AdminAuthMode;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
};

const ADMIN_DASHBOARD_PATH = "/admin/dashboard" as Route;
const ADMIN_LOGIN_PATH = "/admin/login" as Route;
const ADMIN_SIGNUP_PATH = "/admin/signup" as Route;

const content: Record<
  AdminAuthMode,
  {
    title: string;
    subtitle: string;
    submitLabel: string;
    pendingLabel: string;
    switchHref: Route;
    switchPrompt: string;
    switchLink: string;
  }
> = {
  login: {
    title: "Admin Login",
    subtitle:
      "Sign in to manage users, approvals, agents, projects, and platform operations.",
    submitLabel: "Sign In",
    pendingLabel: "Signing in...",
    switchHref: ADMIN_SIGNUP_PATH,
    switchPrompt: "Need an admin account?",
    switchLink: "Create one"
  },
  signup: {
    title: "Admin Signup",
    subtitle:
      "Create an admin account for prototype management and moderation.",
    submitLabel: "Create Account",
    pendingLabel: "Creating account...",
    switchHref: ADMIN_LOGIN_PATH,
    switchPrompt: "Already have an admin account?",
    switchLink: "Sign in"
  }
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function AdminAuthCard({ mode }: AdminAuthCardProps) {
  const router = useRouter();
  const copy = content[mode];

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const currentYear = new Date().getFullYear();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    if (mode === "signup" && fullName.trim().length < 2) {
      setError("Please enter your full name.");
      return;
    }

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

      const path = mode === "login" ? "/auth/login" : "/auth/signup";

      const body =
        mode === "login"
          ? { email: cleanEmail, password, role: "ADMIN" }
          : { fullName: fullName.trim(), email: cleanEmail, password, role: "ADMIN" };

      const result = await apiPost<AuthResponse>(path, body);

      if (!result.success || !result.data) {
        setError(
          result.error ??
            (mode === "login" ? "Login failed" : "Could not create account")
        );
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
    <div data-testid="components-auth-admin-auth-card-div-1" className="min-h-screen bg-gray-50 flex flex-col">
      <header data-testid="components-auth-admin-auth-card-header-1" className="w-full px-6 py-5">
        <div data-testid="components-auth-admin-auth-card-div-2" className="max-w-6xl mx-auto flex items-center justify-between">
          <Link data-testid="components-auth-admin-auth-card-link-1" href="/" className="flex items-center gap-2">
            <span data-testid="components-auth-admin-auth-card-span-1" className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
              <span data-testid="components-auth-admin-auth-card-span-2" className="w-3 h-3 rounded-full bg-white" />
            </span>
            <span data-testid="components-auth-admin-auth-card-span-3" className="text-xl font-extrabold text-slate-900 tracking-tight">
              CORE
            </span>
          </Link>

          <Link data-testid="components-auth-admin-auth-card-link-2"
            href="/"
            className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors duration-200"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <main data-testid="components-auth-admin-auth-card-main-1" className="flex-1 flex items-center justify-center px-6 py-10">
        <div data-testid="components-auth-admin-auth-card-div-3" className="w-full max-w-md">
          <div data-testid="components-auth-admin-auth-card-div-4" className="bg-white shadow-lg rounded-2xl border border-gray-100 overflow-hidden">
            <div data-testid="components-auth-admin-auth-card-div-5" className="border-b border-gray-100 py-4">
              <p data-testid="components-auth-admin-auth-card-p-1" className="text-center text-sm font-semibold text-amber-600">
                Platform Administration
              </p>
            </div>

            <div data-testid="components-auth-admin-auth-card-div-6" className="p-8">
              <p data-testid="components-auth-admin-auth-card-p-2" className="text-center text-sm text-slate-500 mb-6">
                {copy.subtitle}
              </p>

              <h1 data-testid="components-auth-admin-auth-card-h1-1" className="text-2xl font-extrabold text-slate-900 text-center">
                {copy.title}
              </h1>

              <p data-testid="components-auth-admin-auth-card-p-3" className="mt-2 text-sm text-slate-600 text-center">
                Sign in with your admin email and password
              </p>

              <form data-testid="components-auth-admin-auth-card-form-1" className="mt-6" onSubmit={handleSubmit} noValidate>
                {mode === "signup" ? (
                  <div data-testid="components-auth-admin-auth-card-div-7" className="mb-4">
                    <label data-testid="components-auth-admin-auth-card-label-1" htmlFor="admin-name" className="sr-only">
                      Full name
                    </label>
                    <input data-testid="components-auth-admin-auth-card-input-1"
                      id="admin-name"
                      type="text"
                      value={fullName}
                      onChange={(event) => {
                        setFullName(event.target.value);
                        setError("");
                      }}
                      placeholder="Full name"
                      autoComplete="name"
                      required
                      className="w-full px-4 py-3.5 text-base rounded-xl border border-gray-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 transition duration-200"
                    />
                  </div>
                ) : null}

                <div data-testid="components-auth-admin-auth-card-div-8" className="mb-4">
                  <label data-testid="components-auth-admin-auth-card-label-2" htmlFor="admin-email" className="sr-only">
                    Admin email
                  </label>
                  <input data-testid="components-auth-admin-auth-card-input-2"
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

                <div data-testid="components-auth-admin-auth-card-div-9">
                  <label data-testid="components-auth-admin-auth-card-label-3" htmlFor="admin-password" className="sr-only">
                    Password
                  </label>
                  <input data-testid="components-auth-admin-auth-card-input-3"
                    id="admin-password"
                    type="password"
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      setError("");
                    }}
                    placeholder="••••••••"
                    autoComplete={
                      mode === "login" ? "current-password" : "new-password"
                    }
                    required
                    className="w-full px-4 py-3.5 text-base rounded-xl border border-gray-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 transition duration-200"
                  />
                </div>

                {error ? (
                  <p data-testid="components-auth-admin-auth-card-p-4" className="mt-3 text-sm text-red-500" role="alert">
                    {error}
                  </p>
                ) : null}

                <button data-testid="components-auth-admin-auth-card-button-1"
                  type="submit"
                  disabled={isSubmitting}
                  className="mt-6 w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {isSubmitting ? copy.pendingLabel : copy.submitLabel}
                </button>
              </form>

              <p data-testid="components-auth-admin-auth-card-p-5" className="mt-6 text-sm text-slate-500 text-center">
                {copy.switchPrompt}{" "}
                <Link data-testid="components-auth-admin-auth-card-link-3"
                  href={copy.switchHref}
                  className="font-semibold text-amber-600 hover:text-amber-700 transition-colors duration-200"
                >
                  {copy.switchLink}
                </Link>
              </p>
            </div>
          </div>

          <div data-testid="components-auth-admin-auth-card-div-10" className="mt-8 text-center">
            <p data-testid="components-auth-admin-auth-card-p-6" className="text-xs text-slate-400 tracking-wide">
              256-bit encryption &nbsp;•&nbsp; SOC 2 compliant &nbsp;•&nbsp;
              Restricted access
            </p>
          </div>
        </div>
      </main>

      <footer data-testid="components-auth-admin-auth-card-footer-1" className="w-full px-6 py-6">
        <div data-testid="components-auth-admin-auth-card-div-11" className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div data-testid="components-auth-admin-auth-card-div-12" className="flex items-center gap-4">
            <Link data-testid="components-auth-admin-auth-card-link-4" href="/" className="hover:text-slate-600 transition-colors duration-200">
              Privacy Policy
            </Link>

            <Link data-testid="components-auth-admin-auth-card-link-5" href="/" className="hover:text-slate-600 transition-colors duration-200">
              Terms of Service
            </Link>

            <Link data-testid="components-auth-admin-auth-card-link-6" href="/" className="hover:text-slate-600 transition-colors duration-200">
              Help
            </Link>
          </div>

          <p data-testid="components-auth-admin-auth-card-p-7">© {currentYear} CORE AI Agent Platform</p>
        </div>
      </footer>
    </div>
  );
}
