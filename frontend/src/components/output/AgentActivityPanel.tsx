"use client";

import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X, ChevronDown, ChevronUp } from "lucide-react";
import type { AgentStatusEvent } from "@/lib/sse";
import Spinner from "@/components/ui/Spinner";
import ProgressBar from "@/components/ui/ProgressBar";

const AGENT_LABELS: Record<string, string> = {
  simplification: "Simplification",
  research: "Web Research",
  lab: "Lab Notebook",
  canvas: "Diagram",
  image: "Image Generation",
  video: "Video Generation",
};

const PHASE_LABELS: Record<number, string> = {
  1: "Understanding & Analysis",
  2: "Media Generation",
};

function inferPhase(agentType: string): number {
  if (["image", "video"].includes(agentType)) return 2;
  return 1;
}

function getLabel(agent: AgentStatusEvent): string {
  return agent.metadata?.label ?? AGENT_LABELS[agent.agent_type] ?? agent.agent_type;
}

function formatDuration(start: string | null, end: string | null): string {
  if (!start) return "";
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : Date.now();
  const sec = Math.round((e - s) / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function StatusIcon({ status, id }: { status: string; id: string }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={`${id}-${status}`}
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.5, opacity: 0 }}
        transition={{ duration: 0.2 }}
        className="flex items-center justify-center w-4 h-4"
      >
        {status === "running" && <Spinner size="xs" color="primary" />}
        {status === "done" && <Check className="w-3.5 h-3.5 text-emerald-400" />}
        {status === "failed" && <X className="w-3.5 h-3.5 text-red-400" />}
        {status === "pending" && (
          <div className="w-3 h-3 rounded-full border-2 border-zinc-600" />
        )}
      </motion.div>
    </AnimatePresence>
  );
}

const STATUS_BG: Record<string, string> = {
  running: "bg-indigo-500/10 border-indigo-500/20",
  done: "bg-emerald-500/10 border-emerald-500/20",
  failed: "bg-red-500/10 border-red-500/20",
  pending: "bg-zinc-500/10 border-zinc-500/20",
};

const STATUS_TEXT: Record<string, string> = {
  running: "text-indigo-400",
  done: "text-emerald-400",
  failed: "text-red-400",
  pending: "text-zinc-500",
};

interface PhaseGroup {
  phase: number;
  agents: AgentStatusEvent[];
}

function groupByPhase(agents: AgentStatusEvent[]): PhaseGroup[] {
  const map = new Map<number, AgentStatusEvent[]>();
  for (const a of agents) {
    const p = a.metadata?.phase ?? inferPhase(a.agent_type);
    if (!map.has(p)) map.set(p, []);
    map.get(p)!.push(a);
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => a - b)
    .map(([phase, agents]) => ({ phase, agents }));
}

interface Props {
  agents: AgentStatusEvent[];
}

export default function AgentActivityPanel({ agents }: Props) {
  const hasRunning = agents.some((a) => a.status === "running");
  const hasPending = agents.some((a) => a.status === "pending");
  const allFinished = agents.length > 0 && agents.every(
    (a) => a.status === "done" || a.status === "failed",
  );

  const everSawRunning = useRef(false);
  useEffect(() => {
    if (hasRunning || hasPending) everSawRunning.current = true;
  }, [hasRunning, hasPending]);

  // Start collapsed when the pipeline was already finished on first render.
  const [expanded, setExpanded] = useState(() => !allFinished);
  const [tick, setTick] = useState(0);
  const [userToggled, setUserToggled] = useState(false);

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [hasRunning]);

  useEffect(() => {
    if (allFinished && everSawRunning.current && !userToggled) {
      const timer = setTimeout(() => setExpanded(false), 1200);
      return () => clearTimeout(timer);
    }
  }, [allFinished, userToggled]);

  // Reference tick to ensure re-render
  void tick;

  if (agents.length === 0) return null;

  const phases = groupByPhase(agents);
  const totalDone = agents.filter((a) => a.status === "done").length;
  const totalFailed = agents.filter((a) => a.status === "failed").length;
  const totalRunning = agents.filter((a) => a.status === "running").length;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden mb-6">
      <button
        onClick={() => { setUserToggled(true); setExpanded(!expanded); }}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-zinc-200">
            Agent Pipeline
          </span>
          <div className="flex items-center gap-2.5 text-xs">
            {totalRunning > 0 && (
              <span className="flex items-center gap-1.5 text-indigo-400">
                <Spinner size={10} color="primary" />
                {totalRunning} running
              </span>
            )}
            {totalDone > 0 && (
              <span className="flex items-center gap-1 text-emerald-400">
                <Check className="w-3 h-3" />
                {totalDone} done
              </span>
            )}
            {totalFailed > 0 && (
              <span className="flex items-center gap-1 text-red-400">
                <X className="w-3 h-3" />
                {totalFailed} failed
              </span>
            )}
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-zinc-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-zinc-500" />
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-4">
              {phases.map(({ phase, agents: phaseAgents }, phaseIdx) => {
                const phaseDone = phaseAgents.filter((a) => a.status === "done").length;
                const phaseTotal = phaseAgents.length;
                const allPhaseDone = phaseAgents.every(
                  (a) => a.status === "done" || a.status === "failed",
                );

                return (
                  <div key={phase}>
                    {phaseIdx > 0 && (
                      <div className="flex justify-center py-1">
                        <div className="w-px h-4 bg-zinc-700" />
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
                            Phase {phase}
                          </span>
                          <span className="text-xs text-zinc-500">
                            {PHASE_LABELS[phase] ?? ""}
                          </span>
                        </div>
                        <span className="text-xs text-zinc-500 tabular-nums">
                          {phaseDone}/{phaseTotal}
                          {allPhaseDone && (
                            <Check className="inline w-3 h-3 text-emerald-400 ml-1" />
                          )}
                        </span>
                      </div>

                      <ProgressBar
                        current={phaseDone}
                        total={phaseTotal}
                        variant={allPhaseDone ? "success" : "primary"}
                      />

                      <div className="space-y-1">
                        <AnimatePresence mode="popLayout">
                          {phaseAgents.map((agent) => {
                            const bg = STATUS_BG[agent.status] ?? STATUS_BG.pending;
                            const textColor = STATUS_TEXT[agent.status] ?? STATUS_TEXT.pending;
                            return (
                              <motion.div
                                key={agent.id}
                                layout
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: -10 }}
                                transition={{ duration: 0.2 }}
                                className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${bg}`}
                              >
                                <StatusIcon status={agent.status} id={agent.id} />
                                <span className="text-sm text-zinc-200 flex-1 truncate">
                                  {getLabel(agent)}
                                </span>
                                <span className={`text-xs uppercase font-medium ${textColor}`}>
                                  {agent.status}
                                </span>
                                <span className="text-xs text-zinc-500 tabular-nums min-w-[40px] text-right">
                                  {formatDuration(agent.created_at, agent.completed_at)}
                                </span>
                                {agent.error && (
                                  <span
                                    className="text-xs text-red-400 truncate max-w-[180px]"
                                    title={agent.error}
                                  >
                                    {agent.error}
                                  </span>
                                )}
                              </motion.div>
                            );
                          })}
                        </AnimatePresence>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
