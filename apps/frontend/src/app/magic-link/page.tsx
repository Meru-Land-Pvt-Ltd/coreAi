"use client";

import Image from "next/image";
import Link from "next/link";
import type { Route } from "next";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiPost } from "@/lib/api";
import { getAuthToken, getAuthUser, saveAuthSession, type AuthUser } from "@/lib/auth";
import { getLoginDeviceId, takePendingLoginNext } from "@/lib/login-device";
import {
  ARCHITECT_LOGIN_PATH,
  ARCHITECT_MY_AGENTS_PATH,
  BUSINESS_DASHBOARD_PATH,
  BUSINESS_LOGIN_PATH,
  BUSINESS_ONBOARDING_PATH,
  HELP_PATH,
  HOME_PATH,
  PRIVACY_PATH,
  TERM_PATH,
  resolveBusinessLoginReturnPath
} from "@/lib/routes";

const TRIVEN_LOGO_SRC = "/triven.ai word logo transparent bg.PNG";

type MagicLinkRole = "BUSINESS" | "ARCHITECT";

type SignedInResult = {
  mode: "signed_in";
  token: string;
  user: AuthUser;
  isNewUser?: boolean;
};

type ShowCodeResult = {
  mode: "show_code";
  email: string;
  role: MagicLinkRole;
  code: string;
  expiresAt: string;
};

type MagicLinkResult = SignedInResult | ShowCodeResult;

const roleLoginPath: Record<MagicLinkRole, Route> = {
  BUSINESS: BUSINESS_LOGIN_PATH,
  ARCHITECT: ARCHITECT_LOGIN_PATH
};

const roleDashboardPath: Record<MagicLinkRole, Route> = {
  BUSINESS: BUSINESS_DASHBOARD_PATH,
  ARCHITECT: ARCHITECT_MY_AGENTS_PATH
};

export default function MagicLinkPage() {
  return (
    <Suspense fallback={<MagicLinkShell>{null}</MagicLinkShell>}>
      <MagicLinkInner />
    </Suspense>
  );
}

function MagicLinkInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<"loading" | "signed_in" | "show_code" | "error">("loading");
  const [codeResult, setCodeResult] = useState<ShowCodeResult | null>(null);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [isSigningInHere, setIsSigningInHere] = useState(false);

  const tokenRef = useRef<string | null>(searchParams.get("token"));

  const exchangeStartedRef = useRef(false);

  const finishSignIn = useCallback(
    (data: SignedInResult) => {
      saveAuthSession(data.token, data.user);
      setStatus("signed_in");

      const role: MagicLinkRole = data.user.role === "ARCHITECT" ? "ARCHITECT" : "BUSINESS";
      const returnPath = resolveBusinessLoginReturnPath(takePendingLoginNext());

      const destination =
        role === "BUSINESS" && returnPath
          ? returnPath
          : role === "BUSINESS" && data.isNewUser
            ? BUSINESS_ONBOARDING_PATH
            : roleDashboardPath[role];

      window.setTimeout(() => {
        // replace, not push — the spent link must not sit in the back stack.
        router.replace(destination);
      }, 700);
    },
    [router]
  );

  const redirectIfAlreadySignedIn = useCallback((): boolean => {
    const user = getAuthUser();
    if (!user || !getAuthToken()) return false;

    const role: MagicLinkRole = user.role === "ARCHITECT" ? "ARCHITECT" : "BUSINESS";
    const returnPath = resolveBusinessLoginReturnPath(takePendingLoginNext());

    setStatus("signed_in");
    window.setTimeout(() => {
      router.replace(role === "BUSINESS" && returnPath ? returnPath : roleDashboardPath[role]);
    }, 700);

    return true;
  }, [router]);

  const openLink = useCallback(async () => {
    const token = tokenRef.current;

    if (!token) {
      if (redirectIfAlreadySignedIn()) return;
      setErrorCode("MAGIC_LINK_INCOMPLETE");
      setError("This sign-in link is incomplete. Request a new one to sign in.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    const result = await apiPost<MagicLinkResult>("/auth/magic-link/complete", {
      token,
      deviceId: getLoginDeviceId() ?? undefined
    });

    if (!result.success || !result.data) {
      if (redirectIfAlreadySignedIn()) return;
      setErrorCode(result.code ?? "API_ERROR");
      setError(result.error ?? "This sign-in link is invalid. Request a new one to sign in.");
      setStatus("error");
      return;
    }

    if (result.data.mode === "signed_in") {
      finishSignIn(result.data);
    } else {
      setCodeResult(result.data);
      setStatus("show_code");
    }
    
    window.history.replaceState(null, "", window.location.pathname);
  }, [finishSignIn, redirectIfAlreadySignedIn]);

  useEffect(() => {
    // Empty dep list on purpose: openLink() reads the token from a ref, so no
    // dependency can churn and re-fire a single-use exchange. Do not add deps.
    if (exchangeStartedRef.current) return;
    exchangeStartedRef.current = true;

    void openLink();
  }, []);

  const handleCopy = useCallback(async () => {
    if (!codeResult) return;

    try {
      await navigator.clipboard.writeText(codeResult.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked (insecure context or denied permission) — the code is
      // on screen anyway, so this stays silent.
    }
  }, [codeResult]);

  /** Second device, but the visitor wants to finish the login right here. */
  const handleSignInHere = useCallback(async () => {
    const activeToken = tokenRef.current;
    if (!activeToken || isSigningInHere) return;

    setIsSigningInHere(true);
    setError("");

    const result = await apiPost<MagicLinkResult>("/auth/magic-link/complete", {
      token: activeToken,
      deviceId: getLoginDeviceId() ?? undefined,
      signInHere: true
    });

    if (!result.success || !result.data || result.data.mode !== "signed_in") {
      setError(result.error ?? "We couldn't sign you in here. Please try again.");
      setIsSigningInHere(false);
      return;
    }

    finishSignIn(result.data);
  }, [finishSignIn, isSigningInHere]);

  // A dead link and an unreachable server need different words and different
  // actions — "Link no longer works" is wrong and alarming when the real problem
  // was a dropped request.
  const isRetryableError =
    status === "error" &&
    !["MAGIC_LINK_INVALID", "MAGIC_LINK_EXPIRED", "MAGIC_LINK_ALREADY_USED", "MAGIC_LINK_INCOMPLETE"].includes(
      errorCode
    );

  const errorHeading =
    errorCode === "MAGIC_LINK_EXPIRED"
      ? "This link has expired"
      : errorCode === "MAGIC_LINK_ALREADY_USED"
        ? "This link was already used"
        : isRetryableError
          ? "Couldn't reach Triven"
          : "Link no longer works";

  return (
    <MagicLinkShell>
      {status === "loading" ? (
        <div data-testid="magic-link-loading" className="text-center py-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
            <span className="block h-7 w-7 rounded-full border-[3px] border-amber-500 border-t-transparent animate-spin" />
          </div>

          <h1
            className="mt-5 text-xl font-extrabold text-slate-900"
            data-testid="magic-link-loading-heading"
          >
            Signing you in…
          </h1>

          <p className="mt-2 text-sm text-slate-500" data-testid="magic-link-loading-text">
            This only takes a moment.
          </p>
        </div>
      ) : null}

      {status === "signed_in" ? (
        <div data-testid="magic-link-signed-in" className="text-center py-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-9 h-9 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={3}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1
            className="mt-5 text-xl font-extrabold text-slate-900"
            data-testid="magic-link-signed-in-heading"
          >
            You&apos;re signed in!
          </h1>

          <p className="mt-2 text-sm text-slate-500" data-testid="magic-link-signed-in-text">
            Redirecting to your dashboard…
          </p>
        </div>
      ) : null}

      {status === "error" ? (
        <div data-testid="magic-link-error" className="text-center py-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-red-100 flex items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="w-9 h-9 text-red-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            </svg>
          </div>

          <h1
            className="mt-5 text-xl font-extrabold text-slate-900"
            data-testid="magic-link-error-heading"
          >
            {errorHeading}
          </h1>

          <p
            className="mt-2 text-sm text-slate-500"
            role="alert"
            data-testid="magic-link-error-text"
          >
            {error}
          </p>

          {/* A transient failure means the server may never have seen the token,
              so the link can still be live — offer a retry before burning it. */}
          {isRetryableError ? (
            <button
              type="button"
              onClick={() => void openLink()}
              className="mt-6 w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200"
              data-testid="magic-link-retry-button"
            >
              Try again
            </button>
          ) : null}

          <Link
            href={BUSINESS_LOGIN_PATH}
            className={
              isRetryableError
                ? "mt-3 block text-center text-sm text-slate-400 hover:text-slate-600 transition-colors duration-200"
                : "mt-6 inline-block w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200"
            }
            data-testid="magic-link-error-login-link"
          >
            {isRetryableError ? "Back to login" : "Send me a new link"}
          </Link>
        </div>
      ) : null}

      {status === "show_code" && codeResult ? (
        <div data-testid="magic-link-ready">
          <h1
            className="text-2xl font-extrabold text-slate-900 text-center"
            data-testid="magic-link-heading"
          >
            Your sign-in code
          </h1>

          <p
            className="mt-2 text-sm text-slate-600 text-center"
            data-testid="magic-link-email-text"
          >
            For{" "}
            <span className="font-semibold text-slate-900" data-testid="magic-link-email">
              {codeResult.email}
            </span>
          </p>

          <div
            className="mt-6 flex items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-6"
            data-testid="magic-link-code-box"
          >
            <span
              className="font-mono text-4xl font-bold tracking-[0.35em] text-slate-900 pl-[0.35em]"
              data-testid="magic-link-code"
            >
              {codeResult.code}
            </span>
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="mt-4 w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200"
            data-testid="magic-link-copy-button"
          >
            {copied ? "Copied!" : "Copy code"}
          </button>

          <p
            className="mt-4 text-xs text-slate-400 text-center leading-relaxed"
            data-testid="magic-link-instructions-text"
          >
            Enter this code on the device where you started signing in. It expires in a few
            minutes and can only be used once.
          </p>

          {error ? (
            <p
              className="mt-3 text-sm text-red-500 text-center"
              role="alert"
              data-testid="magic-link-sign-in-here-error"
            >
              {error}
            </p>
          ) : null}

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-xs font-medium text-slate-400" data-testid="magic-link-or-text">
              OR
            </span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          <button
            type="button"
            onClick={handleSignInHere}
            disabled={isSigningInHere}
            className="block w-full py-3 rounded-xl border border-gray-200 text-center text-slate-600 font-medium hover:bg-gray-50 transition duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
            data-testid="magic-link-sign-in-here-button"
          >
            {isSigningInHere ? "Signing in…" : "Sign in on this device instead"}
          </button>

          <Link
            href={roleLoginPath[codeResult.role]}
            className="mt-3 block text-center text-sm text-slate-400 hover:text-slate-600 transition-colors duration-200"
            data-testid="magic-link-login-link"
          >
            Back to login
          </Link>
        </div>
      ) : null}
    </MagicLinkShell>
  );
}

/** Page chrome — mirrors the login screen so the link lands somewhere familiar. */
function MagicLinkShell({ children }: { children: React.ReactNode }) {
  const currentYear = new Date().getFullYear();

  return (
    <div data-testid="magic-link-page" className="min-h-screen bg-gray-50 flex flex-col">
      <header className="w-full px-6 py-5">
        <div className="w-full max-w-none flex items-center justify-between">
          <Link
            href={HOME_PATH}
            className="flex items-center gap-2.5"
            aria-label="Triven home"
            data-testid="magic-link-home-link"
          >
            <Image
              src={TRIVEN_LOGO_SRC}
              alt="Triven logo"
              width={36}
              height={36}
              priority
              className="h-9 w-9 object-contain"
            />

            <span className="text-xl font-extrabold tracking-tight text-amber-500">Triven.ai</span>
          </Link>

          <Link
            href={HOME_PATH}
            className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors duration-200"
            data-testid="magic-link-back-to-home-link"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-10">
        <div className="w-full max-w-md">
          <div className="bg-white shadow-lg rounded-2xl border border-gray-100 overflow-hidden">
            <div className="p-8">{children}</div>
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-slate-400 tracking-wide" data-testid="magic-link-trust-text">
              Triven.ai will never ask you to share this link &nbsp;•&nbsp; 256-bit encryption
            </p>
          </div>
        </div>
      </main>

      <footer className="w-full px-6 py-6">
        <div className="w-full max-w-none flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div className="flex items-center gap-4">
            <Link
              href={PRIVACY_PATH}
              className="hover:text-slate-600 transition-colors duration-200"
              data-testid="magic-link-privacy-link"
            >
              Privacy Policy
            </Link>

            <Link
              href={TERM_PATH}
              className="hover:text-slate-600 transition-colors duration-200"
              data-testid="magic-link-terms-link"
            >
              Terms of Service
            </Link>

            <Link
              href={HELP_PATH}
              className="hover:text-slate-600 transition-colors duration-200"
              data-testid="magic-link-help-link"
            >
              Help
            </Link>
          </div>

          <p data-testid="magic-link-copyright-text">© {currentYear} Triven AI Agent Platform</p>
        </div>
      </footer>
    </div>
  );
}
