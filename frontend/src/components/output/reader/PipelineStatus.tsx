"use client";

import { useEffect, useRef, useState } from "react";
import { Check, X, ChevronDown } from "lucide-react";
import type { AgentStatusEvent } from "@/lib/sse";
import Spinner from "@/components/ui/Spinner";
import AgentActivityPanel from "../AgentActivityPanel";

interface Props {
  agents: AgentStatusEvent[];
}

/**
 * Header pill summarising the generation pipeline. Click to open the full
 * per-agent breakdown in a popover.
 */
export default function PipelineStatus({ agents }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (agents.length === 0) return null;

  const running = agents.filter((a) => a.status === "running").length;
  const pendingCount = agents.filter((a) => a.status === "pending").length;
  const failed = agents.filter((a) => a.status === "failed").length;
  const done = agents.filter((a) => a.status === "done").length;
  const total = agents.length;
  const finished = running === 0 && pendingCount === 0;

  return (
    <div ref={ref} className="relative font-sans">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors
          ${finished ? "border-rule text-ink-muted hover:text-ink hover:border-rule-strong" : "border-accent/40 bg-accent/10 text-ink"}`}
      >
        {!finished ? (
          <>
            <Spinner size={11} color="primary" />
            <span className="whitespace-nowrap">
              <span className="hidden sm:inline">Generating </span>
              <span className="tabular-nums">{done}/{total}</span>
            </span>
          </>
        ) : failed > 0 ? (
          <>
            <X className="w-3.5 h-3.5 text-red-400" aria-hidden />
            <span className="whitespace-nowrap">
              {failed} <span className="hidden sm:inline">step{failed === 1 ? "" : "s"} </span>failed
            </span>
          </>
        ) : (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden />
            <span className="hidden sm:inline whitespace-nowrap">Generation complete</span>
            <span className="sr-only sm:hidden">Generation complete</span>
          </>
        )}
        <ChevronDown className="w-3 h-3 text-ink-faint" aria-hidden />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Generation pipeline"
          className="absolute right-0 top-full mt-2 z-40 w-[min(92vw,30rem)] max-h-[70vh] overflow-y-auto rounded-xl border border-rule-strong bg-zinc-950 shadow-2xl"
        >
          <AgentActivityPanel agents={agents} />
        </div>
      )}
    </div>
  );
}
