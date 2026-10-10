"use client";

import { Suspense } from "react";
import KnowledgeCheckInner from "./KnowledgeCheckInner";
import Spinner from "@/components/ui/Spinner";

export default function KnowledgeCheckPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center min-h-screen bg-background">
          <div className="flex flex-col items-center gap-3">
            <Spinner size={36} />
            <p className="text-zinc-400 text-sm">Loading…</p>
          </div>
        </div>
      }
    >
      <KnowledgeCheckInner />
    </Suspense>
  );
}
