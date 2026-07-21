"use client";

import { Suspense } from "react";
import { ResourcesHub } from "./resources-hub";

export default function ResourcesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">
          Loading help docs…
        </div>
      }
    >
      <ResourcesHub mode="business" />
    </Suspense>
  );
}
