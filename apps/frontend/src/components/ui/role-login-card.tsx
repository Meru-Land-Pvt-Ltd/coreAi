"use client";

import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { createGoogleProvider, getFirebaseAuth } from "@/lib/firebase";

type LoginInput = {
  email: string;
  password: string;
};

type Props = {
  role: "admin" | "business" | "architect";
  dashboardPath: string;
};

export function RoleLoginCard({ role, dashboardPath }: Props) {
  const { register, handleSubmit, reset } = useForm<LoginInput>();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [error, setError] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const navigateToDashboard = () => {
    window.location.href = dashboardPath;
  };

  const onSubmit = async (data: LoginInput) => {
    try {
      setError("");
      setLoading(true);
      const auth = getFirebaseAuth();

      if (mode === "login") {
        await signInWithEmailAndPassword(auth, data.email, data.password);
      } else {
        await createUserWithEmailAndPassword(auth, data.email, data.password);
      }

      reset();
      navigateToDashboard();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  const onGoogleSignIn = async () => {
    try {
      setError("");
      setLoading(true);
      const auth = getFirebaseAuth();
      await signInWithPopup(auth, createGoogleProvider());
      navigateToDashboard();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Google sign-in failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-orange-200 bg-white/90 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold capitalize text-orange-900">{role} Access</h1>
        <div className="orb-3d" />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 rounded-lg bg-orange-50 p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("login")}
          className={`rounded-md py-2 font-medium ${mode === "login" ? "bg-orange-600 text-white" : "text-orange-700"}`}
        >
          Login
        </button>
        <button
          type="button"
          onClick={() => setMode("signup")}
          className={`rounded-md py-2 font-medium ${mode === "signup" ? "bg-orange-600 text-white" : "text-orange-700"}`}
        >
          Create Account
        </button>
      </div>

      <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
        <input
          className="w-full rounded-lg border border-orange-200 p-2"
          placeholder="Email"
          {...register("email", { required: true })}
        />
        <input
          className="w-full rounded-lg border border-orange-200 p-2"
          type="password"
          placeholder="Password"
          {...register("password", { required: true, minLength: 6 })}
        />
        <button
          className="brand-gradient w-full rounded-lg py-2 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-70"
          disabled={loading}
          type="submit"
        >
          {loading ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
        </button>
      </form>

      <button
        onClick={onGoogleSignIn}
        type="button"
        className="mt-3 w-full rounded-lg border border-orange-300 bg-white py-2 font-medium text-orange-800 disabled:cursor-not-allowed disabled:opacity-70"
        disabled={loading}
      >
        Continue with Google
      </button>

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      <p className="mt-4 text-sm text-orange-700">
        Need onboarding? Go to <Link className="underline" href="/marketplace">Marketplace</Link>
      </p>
    </div>
  );
}
