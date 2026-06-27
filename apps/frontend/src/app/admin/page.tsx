"use client";

import type { Route } from "next";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getAuthUser } from "@/lib/auth";

export default function AdminIndexPage() {
  const router = useRouter();

  useEffect(() => {
    const authUser = getAuthUser();
    router.replace((authUser?.role === "ADMIN" ? "/admin/dashboard" : "/admin/login") as Route);
  }, [router]);

  return <div data-testid="admin-index-redirecting" className="min-h-screen bg-[#fffaf3]" />;
}
