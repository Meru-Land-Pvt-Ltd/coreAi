"use client";

import Link from "next/link";
import { useForm } from "react-hook-form";

type LoginInput = {
  email: string;
  password: string;
};

type Props = {
  role: "admin" | "business" | "architect";
  dashboardPath: string;
};

export function RoleLoginCard({ role, dashboardPath }: Props) {
  const { register, handleSubmit } = useForm<LoginInput>();

  const onSubmit = (_data: LoginInput) => {
    window.location.href = dashboardPath;
  };

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-orange-200 bg-white/90 p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold capitalize text-orange-900">{role} Login</h1>
        <div className="orb-3d" />
      </div>
      <form className="space-y-3" onSubmit={handleSubmit(onSubmit)}>
        <input className="w-full rounded-lg border border-orange-200 p-2" placeholder="Email" {...register("email", { required: true })} />
        <input className="w-full rounded-lg border border-orange-200 p-2" type="password" placeholder="Password" {...register("password", { required: true })} />
        <button className="brand-gradient w-full rounded-lg py-2 font-semibold text-white" type="submit">Sign in</button>
      </form>
      <p className="mt-4 text-sm text-orange-700">
        Need onboarding? Go to <Link className="underline" href="/marketplace">Marketplace</Link>
      </p>
    </div>
  );
}
