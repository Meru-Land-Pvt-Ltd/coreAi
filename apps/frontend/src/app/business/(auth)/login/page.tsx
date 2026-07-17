import { Suspense } from "react";
import { CoreOtpAuth } from "@/components/auth/auth-card";

export default function BusinessLoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <CoreOtpAuth initialRole="BUSINESS" />
    </Suspense>
  );
}