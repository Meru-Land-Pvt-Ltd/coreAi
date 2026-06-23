"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { apiPost } from "@/lib/api";
import { saveAuthSession, type AuthRole, type AuthUser } from "@/lib/auth";

type AuthMode = "login" | "signup";

type AuthInput = {
  fullName?: string;
  email: string;
  password: string;
};

type AuthResponse = {
  token: string;
  user: AuthUser;
};

type Props = {
  role: AuthRole;
  mode: AuthMode;
  title: string;
  subtitle: string;
  switchHref: Route;
  switchText: string;
  dashboardPath: Route;
};

export function AuthCard({
  role,
  mode,
  title,
  subtitle,
  switchHref,
  switchText,
  dashboardPath
}: Props) {
  const { register, handleSubmit } = useForm<AuthInput>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (values: AuthInput) => {
    try {
      setError("");
      setLoading(true);

      const payload =
        mode === "signup"
          ? {
              fullName: values.fullName,
              email: values.email,
              password: values.password,
              role
            }
          : {
              email: values.email,
              password: values.password,
              role
            };

      const result = await apiPost<AuthResponse>(`/auth/${mode}`, payload);

      if (!result.success || !result.data) {
        setError(result.error ?? "Authentication failed");
        return;
      }

      saveAuthSession(result.data.token, result.data.user);
      window.location.href = dashboardPath;
    } catch {
      setError("Something went wrong. Please check if backend is running.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md rounded-3xl soft-card p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-600">
            CoreAI Access
          </p>
          <h1 className="mt-2 text-3xl font-bold text-orange-950">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-orange-800/75">{subtitle}</p>
        </div>
        <div className="brand-ring shrink-0" />
      </div>

      <form className="space-y-4" onSubmit={handleSubmit(onSubmit)}>
        {mode === "signup" ? (
          <div>
            <label className="text-sm font-medium text-orange-900">Full Name</label>
            <input
              className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-500"
              placeholder="Enter full name"
              {...register("fullName", { required: mode === "signup" })}
            />
          </div>
        ) : null}

        <div>
          <label className="text-sm font-medium text-orange-900">Email</label>
          <input
            className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-500"
            placeholder="Enter email"
            type="email"
            {...register("email", { required: true })}
          />
        </div>

        <div>
          <label className="text-sm font-medium text-orange-900">Password</label>
          <input
            className="mt-1 w-full rounded-xl border border-orange-200 px-3 py-2 outline-none focus:border-orange-500"
            placeholder="Enter password"
            type="password"
            {...register("password", { required: true, minLength: 6 })}
          />
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <button
          className="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-70"
          disabled={loading}
          type="submit"
        >
          {loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-orange-800">
        {switchText}{" "}
        <Link className="font-semibold underline" href={switchHref}>
          Click here
        </Link>
      </p>

      <Link
        href="/"
        className="mt-4 block text-center text-sm font-medium text-orange-700 underline"
      >
        Back to landing page
      </Link>
    </div>
  );
}