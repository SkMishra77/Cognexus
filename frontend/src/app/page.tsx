"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload,
  Link,
  FileText,
  ChevronRight,
  BookOpen,
  AlertCircle,
  Clock,
  Users,
} from "lucide-react";
import type { Paper } from "@/lib/types";
import { getPapers, ingestPdf, ingestArxiv } from "@/lib/api";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import { SkeletonCard } from "@/components/ui/Skeleton";

const ARXIV_RE =
  /^https?:\/\/(www\.)?arxiv\.org\/(abs|pdf)\/\d{4}\.\d{4,5}(v\d+)?$/;

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12 } },
};

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

export default function Home() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [papers, setPapers] = useState<Paper[]>([]);
  const [loadingPapers, setLoadingPapers] = useState(true);

  const [uploading, setUploading] = useState(false);
  const [fetchingArxiv, setFetchingArxiv] = useState(false);
  const [arxivUrl, setArxivUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [hoveredPaper, setHoveredPaper] = useState<string | null>(null);

  useEffect(() => {
    getPapers()
      .then((res) => setPapers(res.papers))
      .catch(() => {})
      .finally(() => setLoadingPapers(false));
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        setError("Please upload a PDF file.");
        return;
      }
      setError(null);
      setUploading(true);
      try {
        const result = await ingestPdf(file);
        router.push(`/paper/${result.paper_id}/knowledge-check`);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setUploading(false);
      }
    },
    [router],
  );

  const handleArxiv = useCallback(async () => {
    if (!ARXIV_RE.test(arxivUrl.trim())) {
      setError(
        "Enter a valid arXiv URL (e.g. https://arxiv.org/abs/2301.12345)",
      );
      return;
    }
    setError(null);
    setFetchingArxiv(true);
    try {
      const result = await ingestArxiv(arxivUrl.trim());
      router.push(`/paper/${result.paper_id}/knowledge-check`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "arXiv fetch failed");
      setFetchingArxiv(false);
    }
  }, [arxivUrl, router]);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const busy = uploading || fetchingArxiv;

  return (
    <div className="flex flex-col items-center min-h-screen bg-background text-zinc-100 px-4 py-16 font-sans relative overflow-hidden">
      {/* Subtle background gradient glow */}
      <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] rounded-full bg-indigo-600/[0.07] blur-[120px]" />

      <motion.div
        className="w-full max-w-2xl relative z-10"
        variants={stagger}
        initial="hidden"
        animate="show"
      >
        {/* ── Hero Section ─────────────────────── */}
        <motion.div variants={fadeUp} className="mb-14 text-center">
          <h1 className="text-5xl font-bold tracking-tight mb-3">
            <span className="bg-gradient-to-r from-indigo-400 via-purple-400 to-indigo-400 bg-clip-text text-transparent">
              Cognexus
            </span>
          </h1>
          <p className="text-zinc-400 text-lg">
            Upload a paper and learn interactively
          </p>
          <p className="text-zinc-600 text-sm mt-1.5">
            Powered by AI — simplified explanations, visuals, and quizzes
          </p>
        </motion.div>

        <div className="space-y-10">
          {/* ── Upload Zone ───────────────────────── */}
          <motion.section variants={fadeUp}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
              <Upload className="w-3.5 h-3.5" />
              Upload PDF
            </h2>

            <motion.div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              onClick={() => !busy && fileRef.current?.click()}
              animate={
                dragging
                  ? {
                      borderColor: "rgba(99, 102, 241, 0.8)",
                      boxShadow:
                        "0 0 30px rgba(99, 102, 241, 0.15), inset 0 0 30px rgba(99, 102, 241, 0.05)",
                    }
                  : {
                      borderColor: "rgba(63, 63, 70, 1)",
                      boxShadow: "none",
                    }
              }
              transition={{ duration: 0.2 }}
              className={`
                flex flex-col items-center justify-center gap-3
                rounded-xl border-2 border-dashed p-10 cursor-pointer
                bg-zinc-900/50 hover:border-zinc-500 transition-colors duration-200
                ${busy ? "pointer-events-none opacity-60" : ""}
              `}
            >
              {uploading ? (
                <>
                  <Spinner size={32} />
                  <span className="text-sm text-zinc-400">
                    Processing PDF…
                  </span>
                </>
              ) : (
                <>
                  <motion.div
                    animate={dragging ? { scale: 1.15, y: -4 } : { scale: 1, y: 0 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                  >
                    <Upload className="w-10 h-10 text-zinc-500" strokeWidth={1.5} />
                  </motion.div>
                  <span className="text-sm text-zinc-400">
                    Drag &amp; drop a PDF here, or{" "}
                    <span className="text-indigo-400 underline">browse</span>
                  </span>
                  <span className="text-xs text-zinc-600">
                    PDF files up to 50 MB
                  </span>
                </>
              )}
            </motion.div>

            <input
              ref={fileRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
          </motion.section>

          {/* ── arXiv Input ───────────────────────── */}
          <motion.section variants={fadeUp}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
              <Link className="w-3.5 h-3.5" />
              Or paste an arXiv URL
            </h2>

            <div className="flex gap-3">
              <input
                type="text"
                placeholder="https://arxiv.org/abs/2301.12345"
                value={arxivUrl}
                onChange={(e) => setArxivUrl(e.target.value)}
                disabled={busy}
                onKeyDown={(e) => e.key === "Enter" && handleArxiv()}
                className="flex-1 rounded-lg bg-zinc-900 border border-zinc-700 px-4 py-2.5 text-sm
                           placeholder:text-zinc-600 focus:outline-none focus:ring-2 focus:ring-indigo-500
                           disabled:opacity-50"
              />
              <Button
                variant="primary"
                size="lg"
                onClick={handleArxiv}
                disabled={busy || !arxivUrl.trim()}
                loading={fetchingArxiv}
                iconLeft={!fetchingArxiv ? <ChevronRight className="w-4 h-4" /> : undefined}
              >
                Fetch
              </Button>
            </div>
          </motion.section>

          {/* ── Error ─────────────────────────────── */}
          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="rounded-lg bg-red-900/30 border border-red-800 px-4 py-3 text-sm text-red-300 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Paper History ─────────────────────── */}
          <motion.section variants={fadeUp}>
            <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-500 mb-3 flex items-center gap-2">
              <FileText className="w-3.5 h-3.5" />
              Recent Papers
            </h2>

            {loadingPapers ? (
              <div className="space-y-2">
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </div>
            ) : papers.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-col items-center justify-center py-12 text-center"
              >
                <BookOpen className="w-12 h-12 text-zinc-700 mb-3" strokeWidth={1.2} />
                <p className="text-zinc-500 text-sm font-medium">
                  No papers yet
                </p>
                <p className="text-zinc-600 text-xs mt-1">
                  Upload a PDF or paste an arXiv link to get started
                </p>
              </motion.div>
            ) : (
              <ul className="space-y-2">
                {papers.map((paper, i) => (
                  <motion.li
                    key={paper.id}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, duration: 0.35 }}
                  >
                    <button
                      onClick={() =>
                        router.push(`/paper/${paper.id}/knowledge-check`)
                      }
                      onMouseEnter={() => setHoveredPaper(paper.id)}
                      onMouseLeave={() => setHoveredPaper(null)}
                      className="w-full text-left rounded-xl bg-zinc-900/60 border border-zinc-800
                                 hover:border-zinc-600 hover:bg-zinc-900/80 px-5 py-4 transition-all duration-200 group relative"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium text-zinc-100 group-hover:text-white truncate flex items-center gap-2">
                            <FileText className="w-4 h-4 text-zinc-600 shrink-0 group-hover:text-indigo-400 transition-colors" />
                            {paper.title}
                          </h3>
                          <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1.5 ml-6">
                            <span className="flex items-center gap-1">
                              <Users className="w-3 h-3" />
                              {paper.authors?.join(", ") || "Unknown authors"}
                            </span>
                            {paper.year && (
                              <span>· {paper.year}</span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {new Date(paper.created_at).toLocaleDateString()}
                            </span>
                          </div>

                          {/* Abstract preview on hover */}
                          <AnimatePresence>
                            {hoveredPaper === paper.id && paper.abstract && (
                              <motion.p
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                                className="text-xs text-zinc-500 leading-relaxed mt-2 ml-6 line-clamp-2 overflow-hidden"
                              >
                                {paper.abstract}
                              </motion.p>
                            )}
                          </AnimatePresence>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {paper.cached && (
                            <span className="rounded-full bg-emerald-900/40 border border-emerald-700/50 px-2.5 py-0.5 text-[11px] font-medium text-emerald-400">
                              cached
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                        </div>
                      </div>
                    </button>
                  </motion.li>
                ))}
              </ul>
            )}
          </motion.section>
        </div>
      </motion.div>
    </div>
  );
}
