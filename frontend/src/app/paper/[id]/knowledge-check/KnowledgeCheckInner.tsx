"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft, BookOpen, SkipForward, Keyboard } from "lucide-react";
import type { Concept } from "@/lib/types";
import { getConcepts, submitKnowledgeProfile } from "@/lib/api";
import Spinner from "@/components/ui/Spinner";
import ProgressBar from "@/components/ui/ProgressBar";
import Button from "@/components/ui/Button";

const cardVariants = {
  enter: (dir: number) => ({
    x: dir > 0 ? 300 : -300,
    opacity: 0,
    scale: 0.95,
  }),
  center: {
    x: 0,
    opacity: 1,
    scale: 1,
    transition: { type: "spring" as const, stiffness: 300, damping: 30 },
  },
  exit: (dir: number) => ({
    x: dir > 0 ? -300 : 300,
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2 },
  }),
};

export default function KnowledgeCheckInner() {
  const params = useParams<{ id: string }>();
  const paperId = params.id;
  const router = useRouter();

  const [concepts, setConcepts] = useState<Concept[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [ratings, setRatings] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [slideDir, setSlideDir] = useState(1);
  const [clickedBtn, setClickedBtn] = useState<"yes" | "no" | null>(null);

  useEffect(() => {
    getConcepts(paperId)
      .then((res) => setConcepts(res.concepts))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Failed to load concepts",
        ),
      )
      .finally(() => setLoading(false));
  }, [paperId]);

  const submitAll = useCallback(
    async (allRatings: Record<string, boolean>) => {
      setSubmitting(true);
      try {
        const sessionId = crypto.randomUUID();
        await submitKnowledgeProfile(paperId, sessionId, allRatings);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (!msg.includes("409")) {
          setError(msg || "Failed to submit profile");
          setSubmitting(false);
          return;
        }
      }
      router.push(`/paper/${paperId}/output`);
    },
    [paperId, router],
  );

  const handleRate = useCallback(
    async (knows: boolean) => {
      setClickedBtn(knows ? "yes" : "no");
      setTimeout(() => setClickedBtn(null), 200);

      const concept = concepts[currentIdx];
      const newRatings = { ...ratings, [concept.name]: knows };
      setRatings(newRatings);

      setSlideDir(1);
      const nextIdx = currentIdx + 1;

      if (nextIdx >= concepts.length) {
        await submitAll(newRatings);
      } else {
        setCurrentIdx(nextIdx);
      }
    },
    [concepts, currentIdx, ratings, submitAll],
  );

  const handleSkipAll = useCallback(async () => {
    const remaining = concepts.slice(currentIdx);
    const allRatings = { ...ratings };
    for (const c of remaining) {
      allRatings[c.name] = false;
    }
    setRatings(allRatings);
    await submitAll(allRatings);
  }, [concepts, currentIdx, ratings, submitAll]);

  // Keyboard shortcuts
  useEffect(() => {
    if (loading || error || concepts.length === 0 || submitting) return;

    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" || e.key === "n" || e.key === "N") {
        e.preventDefault();
        handleRate(false);
      } else if (e.key === "ArrowRight" || e.key === "y" || e.key === "Y") {
        e.preventDefault();
        handleRate(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loading, error, concepts, submitting, handleRate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Spinner size={36} />
          <p className="text-zinc-400 text-sm">Loading concepts…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="max-w-md text-center space-y-4">
          <p className="text-red-400">{error}</p>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-indigo-400 underline"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (concepts.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="text-center space-y-4">
          <BookOpen className="w-12 h-12 text-zinc-700 mx-auto" strokeWidth={1.2} />
          <p className="text-zinc-400">No concepts found for this paper.</p>
          <button
            onClick={() => router.push("/")}
            className="text-sm text-indigo-400 underline"
          >
            Back to home
          </button>
        </div>
      </div>
    );
  }

  if (submitting) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="flex flex-col items-center gap-3"
        >
          <Spinner size={36} />
          <p className="text-zinc-400 text-sm">Submitting your profile…</p>
        </motion.div>
      </div>
    );
  }

  const concept = concepts[currentIdx];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-zinc-100 px-4">
      <motion.div
        className="w-full max-w-lg space-y-8"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        {/* Back link */}
        <button
          onClick={() => router.push("/")}
          className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors -mb-4"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Home
        </button>

        {/* Progress */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              Concept {currentIdx + 1} of {concepts.length}
            </span>
            <span>
              {Math.round(((currentIdx + 1) / concepts.length) * 100)}%
            </span>
          </div>
          <ProgressBar current={currentIdx + 1} total={concepts.length} />

          {/* Step indicator dots */}
          <div className="flex items-center justify-center gap-1 pt-1">
            {concepts.map((_, i) => (
              <div
                key={i}
                className={`
                  rounded-full transition-all duration-300
                  ${
                    i === currentIdx
                      ? "w-2.5 h-2.5 bg-indigo-500"
                      : i < currentIdx
                        ? "w-1.5 h-1.5 bg-indigo-500/50"
                        : "w-1.5 h-1.5 bg-zinc-700"
                  }
                `}
              />
            ))}
          </div>
        </div>

        {/* Concept Card with slide animation */}
        <div className="relative overflow-hidden rounded-2xl min-h-[200px]">
          <AnimatePresence mode="wait" custom={slideDir}>
            <motion.div
              key={currentIdx}
              custom={slideDir}
              variants={cardVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="rounded-2xl bg-zinc-900/60 border border-zinc-800 p-8 text-center space-y-4"
            >
              <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
                Do you know this concept?
              </p>
              <h2 className="text-2xl font-bold text-white">
                {concept.name}
              </h2>
              {concept.description && (
                <p className="text-zinc-400 text-sm leading-relaxed max-w-sm mx-auto">
                  {concept.description}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Buttons */}
        <div className="flex gap-4">
          <motion.div
            className="flex-1"
            animate={clickedBtn === "no" ? { scale: [1, 0.95, 1] } : {}}
            transition={{ duration: 0.2 }}
          >
            <Button
              variant="danger"
              size="lg"
              onClick={() => handleRate(false)}
              className="w-full !rounded-xl !py-4 !text-lg !bg-red-600/20 !border !border-red-600/40
                         !text-red-400 hover:!bg-red-600/30 hover:!border-red-500"
            >
              No
            </Button>
          </motion.div>
          <motion.div
            className="flex-1"
            animate={clickedBtn === "yes" ? { scale: [1, 0.95, 1] } : {}}
            transition={{ duration: 0.2 }}
          >
            <Button
              variant="primary"
              size="lg"
              onClick={() => handleRate(true)}
              className="w-full !rounded-xl !py-4 !text-lg !bg-emerald-600/20 !border !border-emerald-600/40
                         !text-emerald-400 hover:!bg-emerald-600/30 hover:!border-emerald-500"
            >
              Yes
            </Button>
          </motion.div>
        </div>

        {/* Skip All + Keyboard hints */}
        <div className="flex items-center justify-between">
          <button
            onClick={handleSkipAll}
            className="flex items-center gap-1.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            <SkipForward className="w-3.5 h-3.5" />
            Skip all remaining
          </button>

          <div className="flex items-center gap-1.5 text-xs text-zinc-700">
            <Keyboard className="w-3.5 h-3.5" />
            <span>
              <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 text-[10px] font-mono">
                ←
              </kbd>{" "}
              No{" · "}
              <kbd className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 text-[10px] font-mono">
                →
              </kbd>{" "}
              Yes
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
