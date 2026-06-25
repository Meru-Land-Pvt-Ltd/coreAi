"use client";

import Link from "next/link";
import type { Route } from "next";
import {
  ClipboardEvent,
  FormEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useRouter } from "next/navigation";
import { apiPost } from "@/lib/api";
import { saveAuthSession, type AuthRole, type AuthUser } from "@/lib/auth";

type OtpAuthRole = Extract<AuthRole, "BUSINESS" | "ARCHITECT">;

type CoreOtpAuthProps = {
  initialRole: OtpAuthRole;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
};

const roleContent: Record<
  OtpAuthRole,
  {
    tab: string;
    subtitle: string;
    loginPath: Route;
    dashboardPath: Route;
  }
> = {
  BUSINESS: {
    tab: "Business Owner",
    subtitle: "Find and install AI agents for your business",
    loginPath: "/business/login" as Route,
    dashboardPath: "/business/marketplace" as Route
  },
  ARCHITECT: {
    tab: "AI Architect",
    subtitle: "Build, publish, and sell AI agents",
    loginPath: "/architect/login" as Route,
    dashboardPath: "/architect/agents" as Route
  }
};

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function CoreOtpAuth({ initialRole }: CoreOtpAuthProps) {
  const router = useRouter();

  const [role, setRole] = useState<OtpAuthRole>(initialRole);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const currentYear = new Date().getFullYear();

  const otpRefs = useRef<Array<HTMLInputElement | null>>([]);

  const otpValue = useMemo(() => otp.join(""), [otp]);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [secondsLeft]);

  function changeRole(nextRole: OtpAuthRole) {
    if (nextRole === role) return;

    setRole(nextRole);
    setStep(1);
    setOtp(["", "", "", "", "", ""]);
    setError("");
    setSecondsLeft(0);

    router.replace(roleContent[nextRole].loginPath, {
      scroll: false
    });
  }

  async function sendVerificationCode(targetEmail: string) {
    const result = await apiPost<unknown>("/auth/send-verification-code", {
      email: targetEmail,
      role
    });

    if (!result.success) {
      throw new Error(result.error ?? "Failed to send verification code");
    }
  }

  async function handleEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    if (!isValidEmail(cleanEmail)) {
      setError("Please enter a valid email address.");
      return;
    }

    try {
      setError("");
      setIsSending(true);

      await sendVerificationCode(cleanEmail);

      setEmail(cleanEmail);
      setStep(2);
      setSecondsLeft(60);

      window.setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 80);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to send verification code"
      );
    } finally {
      setIsSending(false);
    }
  }

  async function handleVerify() {
    if (otpValue.length !== 6) {
      setError("Please enter all 6 digits.");
      return;
    }

    try {
      setError("");
      setIsVerifying(true);

      const result = await apiPost<AuthResponse>("/auth/verify-code", {
        email,
        role,
        code: otpValue
      });

      if (!result.success || !result.data) {
        setError(result.error ?? "Verification failed");
        return;
      }

      saveAuthSession(result.data.token, result.data.user);

      setStep(3);

      window.setTimeout(() => {
        router.push(roleContent[role].dashboardPath);
      }, 700);
    } catch {
      setError("Something went wrong. Please check if backend is running.");
    } finally {
      setIsVerifying(false);
    }
  }

  async function handleGoogleLogin() {
    try {
      setError("");
      setIsGoogleLoading(true);

      const [{ GoogleAuthProvider, signInWithPopup }, { getFirebaseAuth }] =
        await Promise.all([import("firebase/auth"), import("@/lib/firebase")]);

      const provider = new GoogleAuthProvider();

      provider.setCustomParameters({
        prompt: "select_account"
      });

      const firebaseResult = await signInWithPopup(getFirebaseAuth(), provider);
      const idToken = await firebaseResult.user.getIdToken();

      const result = await apiPost<AuthResponse>("/auth/firebase-login", {
        idToken,
        role
      });

      if (!result.success || !result.data) {
        setError(result.error ?? "Google login failed");
        return;
      }

      saveAuthSession(result.data.token, result.data.user);
      router.push(roleContent[role].dashboardPath);
    } catch {
      setError("Google login failed. Please try again.");
    } finally {
      setIsGoogleLoading(false);
    }
  }

  async function handleResend() {
    if (secondsLeft > 0 || !email) return;

    try {
      setError("");
      setIsSending(true);

      await sendVerificationCode(email);

      setOtp(["", "", "", "", "", ""]);
      setSecondsLeft(60);

      window.setTimeout(() => {
        otpRefs.current[0]?.focus();
      }, 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setIsSending(false);
    }
  }

  function handleOtpChange(index: number, value: string) {
    const digit = value.replace(/[^0-9]/g, "").slice(0, 1);

    setOtp((current) => {
      const next = [...current];
      next[index] = digit;
      return next;
    });

    setError("");

    if (digit && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(
    index: number,
    event: KeyboardEvent<HTMLInputElement>
  ) {
    if (event.key === "Backspace" && !otp[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }

    if (event.key === "Enter" && otpValue.length === 6) {
      void handleVerify();
    }
  }

  function handleOtpPaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault();

    const digits = event.clipboardData
      .getData("text")
      .replace(/[^0-9]/g, "")
      .slice(0, 6)
      .split("");

    if (!digits.length) return;

    setOtp((current) => {
      const next = [...current];

      digits.forEach((digit, index) => {
        next[index] = digit;
      });

      return next;
    });

    const focusIndex = Math.min(digits.length, 5);

    window.setTimeout(() => {
      otpRefs.current[focusIndex]?.focus();
    }, 50);
  }

  function useDifferentEmail() {
    setStep(1);
    setOtp(["", "", "", "", "", ""]);
    setError("");
    setSecondsLeft(0);
  }

  return (
    <div data-testid="components-auth-auth-card-div-1" className="min-h-screen bg-gray-50 flex flex-col">
      <header data-testid="components-auth-auth-card-header-1" className="w-full px-6 py-5">
        <div data-testid="components-auth-auth-card-div-2" className="max-w-6xl mx-auto flex items-center justify-between">
          <Link data-testid="components-auth-auth-card-link-1" href="/" className="flex items-center gap-2">
            <span data-testid="components-auth-auth-card-span-1" className="w-8 h-8 rounded-full bg-amber-500 flex items-center justify-center">
              <span data-testid="components-auth-auth-card-span-2" className="w-3 h-3 rounded-full bg-white" />
            </span>
            <span data-testid="components-auth-auth-card-span-3" className="text-xl font-extrabold text-slate-900 tracking-tight">
              CORE
            </span>
          </Link>

          <Link data-testid="components-auth-auth-card-link-2"
            href="/"
            className="text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors duration-200"
          >
            ← Back to Home
          </Link>
        </div>
      </header>

      <main data-testid="components-auth-auth-card-main-1" className="flex-1 flex items-center justify-center px-6 py-10">
        <div data-testid="components-auth-auth-card-div-3" className="w-full max-w-md">
          <div data-testid="components-auth-auth-card-div-4" className="bg-white shadow-lg rounded-2xl border border-gray-100 overflow-hidden">
            <div data-testid="components-auth-auth-card-div-5"
              className="flex border-b border-gray-100"
              role="tablist"
              aria-label="Account type"
            >
              <button data-testid="components-auth-auth-card-button-1"
                type="button"
                role="tab"
                aria-selected={role === "BUSINESS"}
                onClick={() => changeRole("BUSINESS")}
                className={`flex-1 py-4 text-sm border-b-2 transition-colors duration-200 ${role === "BUSINESS"
                  ? "font-semibold text-amber-600 border-amber-500"
                  : "font-medium text-gray-400 border-transparent hover:text-slate-600"
                  }`}
              >
                {roleContent.BUSINESS.tab}
              </button>

              <button data-testid="components-auth-auth-card-button-2"
                type="button"
                role="tab"
                aria-selected={role === "ARCHITECT"}
                onClick={() => changeRole("ARCHITECT")}
                className={`flex-1 py-4 text-sm border-b-2 transition-colors duration-200 ${role === "ARCHITECT"
                  ? "font-semibold text-amber-600 border-amber-500"
                  : "font-medium text-gray-400 border-transparent hover:text-slate-600"
                  }`}
              >
                {roleContent.ARCHITECT.tab}
              </button>
            </div>

            <div data-testid="components-auth-auth-card-div-6" className="p-8">
              <p data-testid="components-auth-auth-card-p-1" className="text-center text-sm text-slate-500 mb-6">
                {roleContent[role].subtitle}
              </p>

              {step === 1 ? (
                <div data-testid="components-auth-auth-card-div-7">
                  <h1 data-testid="components-auth-auth-card-h1-1" className="text-2xl font-extrabold text-slate-900 text-center">
                    Welcome to CORE
                  </h1>

                  <p data-testid="components-auth-auth-card-p-2" className="mt-2 text-sm text-slate-600 text-center">
                    Login with email OTP or Google
                  </p>

                  <button data-testid="components-auth-auth-card-button-3"
                    type="button"
                    onClick={handleGoogleLogin}
                    disabled={isGoogleLoading || isSending}
                    className="mt-6 flex h-14 w-full items-center justify-center gap-4 rounded-full border border-[#747775] bg-white px-6 text-[18px] font-medium text-[#1f1f1f] transition hover:bg-gray-50 active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <svg data-testid="components-auth-auth-card-svg-1"
                      width="24"
                      height="24"
                      viewBox="0 0 48 48"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path data-testid="components-auth-auth-card-path-1"
                        fill="#EA4335"
                        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
                      />
                      <path data-testid="components-auth-auth-card-path-2"
                        fill="#4285F4"
                        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
                      />
                      <path data-testid="components-auth-auth-card-path-3"
                        fill="#FBBC05"
                        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24s.92 7.54 2.56 10.78l7.97-6.19z"
                      />
                      <path data-testid="components-auth-auth-card-path-4"
                        fill="#34A853"
                        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
                      />
                      <path data-testid="components-auth-auth-card-path-5" fill="none" d="M0 0h48v48H0z" />
                    </svg>

                    <span data-testid="components-auth-auth-card-span-4">{isGoogleLoading ? "Connecting..." : "Continue with Google"}</span>
                  </button>

                  <div data-testid="components-auth-auth-card-div-8" className="my-6 flex items-center gap-3">
                    <div data-testid="components-auth-auth-card-div-9" className="h-px flex-1 bg-gray-100" />
                    <span data-testid="components-auth-auth-card-span-5" className="text-xs font-medium text-slate-400">
                      OR
                    </span>
                    <div data-testid="components-auth-auth-card-div-10" className="h-px flex-1 bg-gray-100" />
                  </div>

                  <form data-testid="components-auth-auth-card-form-1" onSubmit={handleEmailSubmit} noValidate>
                    <label data-testid="components-auth-auth-card-label-1" htmlFor="email-input" className="sr-only">
                      Work email
                    </label>

                    <input data-testid="components-auth-auth-card-input-1"
                      id="email-input"
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setError("");
                      }}
                      placeholder="you@company.com"
                      autoComplete="email"
                      required
                      className={`w-full px-4 py-3.5 text-base rounded-xl border text-slate-900 placeholder-slate-400 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 transition duration-200 ${error ? "border-red-300" : "border-gray-200"
                        }`}
                    />

                    {error ? (
                      <p data-testid="components-auth-auth-card-p-3" className="mt-2 text-sm text-red-500" role="alert">
                        {error}
                      </p>
                    ) : null}

                    <button data-testid="components-auth-auth-card-button-4"
                      type="submit"
                      disabled={isSending || isGoogleLoading}
                      className="mt-4 w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {isSending ? "Sending..." : "Send Verification Code"}
                    </button>
                  </form>

                  <p data-testid="components-auth-auth-card-p-4" className="mt-4 text-xs text-slate-400 text-center leading-relaxed">
                    We&apos;ll send a 6-digit code to verify your email. No
                    password needed.
                  </p>
                </div>
              ) : null}

              {step === 2 ? (
                <div data-testid="components-auth-auth-card-div-11">
                  <h1 data-testid="components-auth-auth-card-h1-2" className="text-2xl font-extrabold text-slate-900 text-center">
                    Check your email
                  </h1>

                  <p data-testid="components-auth-auth-card-p-5" className="mt-2 text-sm text-slate-600 text-center">
                    We sent a code to{" "}
                    <span data-testid="components-auth-auth-card-span-6" className="font-semibold text-slate-900">{email}</span>
                  </p>

                  <div data-testid="components-auth-auth-card-div-12"
                    className="mt-6 flex justify-center gap-2"
                    aria-label="6-digit verification code"
                  >
                    {otp.map((digit, index) => (
                      <input data-testid="components-auth-auth-card-input-2"
                        key={index}
                        ref={(element) => {
                          otpRefs.current[index] = element;
                        }}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(event) =>
                          handleOtpChange(index, event.target.value)
                        }
                        onKeyDown={(event) => handleOtpKeyDown(index, event)}
                        onPaste={handleOtpPaste}
                        className="w-12 h-14 text-center text-2xl font-semibold rounded-lg border border-gray-200 text-slate-900 focus:outline-none focus:border-amber-400 focus:ring-4 focus:ring-amber-100 transition duration-200"
                        aria-label={`Digit ${index + 1}`}
                      />
                    ))}
                  </div>

                  {error ? (
                    <p data-testid="components-auth-auth-card-p-6"
                      className="mt-3 text-sm text-red-500 text-center"
                      role="alert"
                    >
                      {error}
                    </p>
                  ) : null}

                  <button data-testid="components-auth-auth-card-button-5"
                    type="button"
                    onClick={handleVerify}
                    disabled={isVerifying}
                    className="mt-6 w-full py-3 rounded-xl bg-amber-500 text-white font-semibold hover:bg-amber-600 active:scale-[0.99] transition duration-200 disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isVerifying ? "Verifying..." : "Verify & Continue"}
                  </button>

                  <div data-testid="components-auth-auth-card-div-13" className="mt-5 flex items-center justify-between text-sm">
                    <button data-testid="components-auth-auth-card-button-6"
                      type="button"
                      onClick={handleResend}
                      disabled={secondsLeft > 0 || isSending}
                      className="text-amber-600 font-medium hover:text-amber-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Resend code{" "}
                      {secondsLeft > 0 ? <span data-testid="components-auth-auth-card-span-7">({secondsLeft}s)</span> : null}
                    </button>

                    <button data-testid="components-auth-auth-card-button-7"
                      type="button"
                      onClick={useDifferentEmail}
                      className="text-slate-400 hover:text-slate-600 transition-colors duration-200"
                    >
                      Use a different email
                    </button>
                  </div>
                </div>
              ) : null}

              {step === 3 ? (
                <div data-testid="components-auth-auth-card-div-14" className="text-center py-6">
                  <div data-testid="components-auth-auth-card-div-15" className="w-16 h-16 mx-auto rounded-full bg-green-100 flex items-center justify-center">
                    <svg data-testid="components-auth-auth-card-svg-2"
                      xmlns="http://www.w3.org/2000/svg"
                      className="w-9 h-9 text-green-600"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={3}
                    >
                      <path data-testid="components-auth-auth-card-path-6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  </div>

                  <h1 data-testid="components-auth-auth-card-h1-3" className="mt-5 text-xl font-extrabold text-slate-900">
                    Verified!
                  </h1>

                  <p data-testid="components-auth-auth-card-p-7" className="mt-2 text-sm text-slate-500">
                    Redirecting to your dashboard…
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          <div data-testid="components-auth-auth-card-div-16" className="mt-8 text-center">
            <p data-testid="components-auth-auth-card-p-8" className="text-sm font-medium text-slate-600">
              Join 2,400+ businesses already using CORE
            </p>

            <p data-testid="components-auth-auth-card-p-9" className="mt-1.5 text-xs text-slate-400">
              Trusted by dentists, HVAC companies, law firms & more
            </p>

            <p data-testid="components-auth-auth-card-p-10" className="mt-4 text-xs text-slate-400 tracking-wide">
              256-bit encryption &nbsp;•&nbsp; SOC 2 compliant &nbsp;•&nbsp; No
              credit card required
            </p>
          </div>
        </div>
      </main>

      <footer data-testid="components-auth-auth-card-footer-1" className="w-full px-6 py-6">
        <div data-testid="components-auth-auth-card-div-17" className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-400">
          <div data-testid="components-auth-auth-card-div-18" className="flex items-center gap-4">
            <Link data-testid="components-auth-auth-card-link-3" href="/" className="hover:text-slate-600 transition-colors duration-200">
              Privacy Policy
            </Link>

            <Link data-testid="components-auth-auth-card-link-4" href="/" className="hover:text-slate-600 transition-colors duration-200">
              Terms of Service
            </Link>

            <Link data-testid="components-auth-auth-card-link-5" href="/" className="hover:text-slate-600 transition-colors duration-200">
              Help
            </Link>
          </div>

          <p data-testid="components-auth-auth-card-p-11">© {currentYear} CORE AI Agent Platform</p>
        </div>
      </footer>
    </div>
  );
}