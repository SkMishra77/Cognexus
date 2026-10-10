"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronLeft, Check } from "lucide-react";
import type {
  Paper,
  SimplifiedSection,
  GeneratedImage,
  GeneratedCanvas,
  VideoJob,
  GeneratedLab,
  WebSearchResult,
} from "@/lib/types";
import { getOutputSnapshot, getPaperDetail } from "@/lib/api";
import { subscribeToOutput } from "@/lib/sse";
import useUpsert from "@/hooks/useUpsert";
import OutputTimeline from "@/components/output/OutputTimeline";
import Spinner from "@/components/ui/Spinner";
import { SkeletonCard } from "@/components/ui/Skeleton";

/* ── Status badge ──────────────────────────────────────────────── */

function StatusBadge({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className={`inline-block w-2 h-2 rounded-full ${color}`} />
      <span className="text-zinc-400">
        {count} {label}
      </span>
    </div>
  );
}

/* ── Sidebar Table of Contents ─────────────────────────────────── */

function SidebarTOC({
  sections,
  activeSectionId,
}: {
  sections: SimplifiedSection[];
  activeSectionId: string | null;
}) {
  const scrollTo = (id: string) => {
    document.getElementById(`section-${id}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  if (sections.length === 0) return null;

  return (
    <nav className="hidden lg:block sticky top-20 w-56 shrink-0 max-h-[calc(100vh-6rem)] overflow-y-auto pr-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 mb-3">
        Contents
      </h3>
      <ul className="space-y-1">
        {sections.map((s) => {
          const isActive = activeSectionId === s.id;
          return (
            <li key={s.id}>
              <button
                onClick={() => scrollTo(s.id)}
                className={`w-full text-left text-sm px-2 py-1.5 rounded-md transition-colors truncate
                  ${
                    isActive
                      ? "bg-indigo-600/20 text-indigo-300 font-medium"
                      : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60"
                  }`}
              >
                {s.title ?? `Section ${s.section_index + 1}`}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ── Main component ────────────────────────────────────────────── */

export default function OutputInner() {
  const { id: paperId } = useParams<{ id: string }>();
  const router = useRouter();

  const [paper, setPaper] = useState<Paper | null>(null);
  const [sections, upsertSection, setSections] = useUpsert<SimplifiedSection>();
  const [images, upsertImage] = useUpsert<GeneratedImage>();
  const [canvases, upsertCanvas] = useUpsert<GeneratedCanvas>();
  const [videos, upsertVideo, setVideos] = useUpsert<VideoJob>();
  const [labs, upsertLab] = useUpsert<GeneratedLab>();
  const [webSearchResults, upsertWebResult] = useUpsert<WebSearchResult>();

  const [status, setStatus] = useState<string>("loading");
  const [showPdf, setShowPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);

  const sectionRefs = useRef<Map<string, IntersectionObserverEntry>>(new Map());

  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem(`cognexus_session_${paperId}`) || paperId
      : paperId;

  /* Load existing snapshot on mount */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [snapshot, paperDetail] = await Promise.allSettled([
          getOutputSnapshot(paperId),
          getPaperDetail(paperId),
        ]);

        if (cancelled) return;

        if (paperDetail.status === "fulfilled") {
          setPaper(paperDetail.value);
        }

        if (snapshot.status === "fulfilled") {
          const data = snapshot.value;
          if (data.paper) setPaper(data.paper);
          setSections(data.sections ?? []);
          setVideos(data.videos ?? []);

          /* Bulk-set remaining arrays via upsert for each item */
          (data.images ?? []).forEach((img: GeneratedImage) => upsertImage(img));
          (data.canvases ?? []).forEach((c: GeneratedCanvas) => upsertCanvas(c));
          (data.labs ?? []).forEach((l: GeneratedLab) => upsertLab(l));
          setStatus(data.status ?? "running");
        } else {
          setStatus("running");
        }
      } catch {
        if (!cancelled) setStatus("running");
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  /* Subscribe to SSE */
  useEffect(() => {
    if (status === "done") return;

    const cleanup = subscribeToOutput(paperId, {
      onSimplification: upsertSection,
      onImage: upsertImage,
      onCanvas: upsertCanvas,
      onVideoQueued: upsertVideo,
      onVideoDone: upsertVideo,
      onLab: upsertLab,
      onResearch: upsertWebResult,
      onComplete: () => setStatus("done"),
      onError: () => setError("Connection lost. Refresh to reconnect."),
    });

    return cleanup;
  }, [paperId, status, upsertSection, upsertImage, upsertCanvas, upsertVideo, upsertLab, upsertWebResult]);

  /* Intersection observer for active section tracking */
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          sectionRefs.current.set(entry.target.id, entry);
        });

        let topVisible: string | null = null;
        let topY = Infinity;

        sectionRefs.current.forEach((entry, id) => {
          if (entry.isIntersecting && entry.boundingClientRect.top < topY) {
            topY = entry.boundingClientRect.top;
            topVisible = id.replace("section-", "");
          }
        });

        if (topVisible) setActiveSectionId(topVisible);
      },
      { rootMargin: "-80px 0px -40% 0px", threshold: 0 },
    );

    const elements = document.querySelectorAll("[data-section-id]");
    elements.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [sections]);

  /* Callback for video status updates from VideoBlock */
  const handleVideoUpdate = useCallback(
    (v: VideoJob) => {
      upsertVideo(v);
    },
    [upsertVideo],
  );

  /* Loading skeleton state */
  if (status === "loading" && sections.length === 0) {
    return (
      <div className="min-h-screen bg-background text-zinc-100">
        <div className="max-w-4xl mx-auto px-4 pt-20 space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    );
  }

  const sortedSections = [...sections].sort(
    (a, b) => a.section_index - b.section_index,
  );

  return (
    <div className="min-h-screen bg-background text-zinc-100">
      {/* Top Bar */}
      <header className="sticky top-0 z-30 bg-background/90 backdrop-blur-sm border-b border-zinc-800">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => router.push("/")}
              className="shrink-0 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold truncate">
              {paper?.title ?? "Processing…"}
            </h1>
          </div>

          <button
            onClick={() => setShowPdf(!showPdf)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors
              ${
                showPdf
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
              }`}
          >
            {showPdf ? "Hide PDF" : "Toggle PDF"}
          </button>
        </div>
      </header>

      {/* Status Bar */}
      <div className="max-w-6xl mx-auto px-4 py-3">
        <div className="flex items-center gap-4 flex-wrap">
          <StatusBadge
            label="sections"
            count={sections.length}
            color="bg-indigo-500"
          />
          <StatusBadge
            label="images"
            count={images.length}
            color="bg-blue-500"
          />
          <StatusBadge
            label="canvases"
            count={canvases.length}
            color="bg-purple-500"
          />
          <StatusBadge
            label="videos"
            count={videos.length}
            color="bg-amber-500"
          />
          <StatusBadge
            label="labs"
            count={labs.length}
            color="bg-emerald-500"
          />

          {status === "running" && (
            <div className="flex items-center gap-1.5 text-xs ml-auto">
              <Spinner size={12} />
              <span className="text-indigo-400">Processing…</span>
            </div>
          )}
          {status === "done" && (
            <span className="text-xs text-emerald-400 ml-auto flex items-center gap-1">
              <Check className="w-3.5 h-3.5" />
              Complete
            </span>
          )}
        </div>

        {error && (
          <div className="mt-3 rounded-lg bg-red-900/30 border border-red-800 px-4 py-2 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>

      {/* Main Content with Sidebar TOC */}
      <div className="max-w-6xl mx-auto px-4 pb-12 flex gap-6">
        <SidebarTOC
          sections={sortedSections}
          activeSectionId={activeSectionId}
        />

        <main className="min-w-0 flex-1">
          {showPdf && (
            <div className="mb-6 rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
              <p className="text-sm text-zinc-500">
                PDF viewer placeholder — original paper PDF will be displayed
                here
              </p>
            </div>
          )}

          <AnimatePresence mode="popLayout">
            <OutputTimeline
              paperId={paperId}
              sessionId={sessionId}
              sections={sortedSections}
              images={images}
              canvases={canvases}
              videos={videos}
              labs={labs}
              webSearchResults={webSearchResults}
              onNewImage={upsertImage}
              onNewCanvas={upsertCanvas}
              onNewVideo={upsertVideo}
              onVideoUpdate={handleVideoUpdate}
            />
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
