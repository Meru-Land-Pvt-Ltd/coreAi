import { Suspense } from "react";
import { MyAgentsView } from "@/components/architect/ui/my-agents-view";

export default function ArchitectAgentsPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gray-50" />}>
      <MyAgentsView />
    </Suspense>
  );
}
