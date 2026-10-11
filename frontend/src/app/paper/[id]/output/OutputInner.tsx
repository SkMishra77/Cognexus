"use client";

import { useEffect, useState, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, List, MessageSquare, X } from "lucide-react";
import type {
  Paper,
  SimplifiedSection,
  GeneratedImage,
  GeneratedCanvas,
  VideoJob,
  GeneratedLab,
  WebSearchResult,
} from "@/lib/types";
import {
  getOutputSnapshot,
  getPaperDetail,
  getAgentJobs,
  generateManualImage,
  generateManualCanvas,
  generateManualVideo,
  regenerateImage,
  downloadLab,
  downloadLabsZip,
} from "@/lib/api";
import { subscribeToOutput } from "@/lib/sse";
import type { AgentStatusEvent } from "@/lib/sse";
import {
  prepareSections,
  distributeMedia,
  labsForSection,
  sourcesForSection,
  readingMinutes,
} from "@/lib/reader";
import useUpsert from "@/hooks/useUpsert";
import { useToast } from "@/components/ui/Toast";
import ChatPanel, { type ChatRequest } from "@/components/chat/ChatPanel";
import AgentActivityPanel from "@/components/output/AgentActivityPanel";
import ContentsNav from "@/components/output/reader/ContentsNav";
import SectionArticle from "@/components/output/reader/SectionArticle";
import SectionRail, { type MediaRequestType } from "@/components/output/reader/SectionRail";
import PipelineStatus from "@/components/output/reader/PipelineStatus";
import FrontMatter from "@/components/output/reader/FrontMatter";
import Appendix from "@/components/output/reader/Appendix";
import { SkeletonText } from "@/components/ui/Skeleton";

/* ── Lazy section wrapper ─────────────────────────────────────── */

function LazySection({
  id,
  estimatedHeight,
  children,
}: {
  id: string;
  estimatedHeight: number;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (visible) return <>{children}</>;

  return (
    <div
      ref={ref}
      id={`section-${id}`}
      data-section-id={id}
      style={{ minHeight: estimatedHeight }}
      className="scroll-mt-20 pb-14 mb-14 border-b border-rule last:border-b-0 flex items-start pt-4"
      aria-hidden
    >
      <div className="space-y-3 w-full">
        <div className="skeleton-shimmer h-3 w-24 rounded" />
        <div className="skeleton-shimmer h-10 w-3/5 rounded" />
        <div className="skeleton-shimmer h-3 w-full rounded mt-6" />
        <div className="skeleton-shimmer h-3 w-full rounded" />
        <div className="skeleton-shimmer h-3 w-4/5 rounded" />
      </div>
    </div>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function OutputInner() {
  const { id: paperId } = useParams<{ id: string }>();
  const router = useRouter();
  const { toast } = useToast();

  /* ── Data ───────────────────────────────────────────────────── */
  const [paper, setPaper] = useState<Paper | null>(null);
  const [sections, upsertSection, setSections] = useUpsert<SimplifiedSection>();
  const [images, upsertImage] = useUpsert<GeneratedImage>();
  const [canvases, upsertCanvas] = useUpsert<GeneratedCanvas>();
  const [videos, upsertVideo, setVideos] = useUpsert<VideoJob>();
  const [labs, upsertLab] = useUpsert<GeneratedLab>();
  const [webSearchResults, upsertWebResult] = useUpsert<WebSearchResult>();
  const [agentJobs, setAgentJobs] = useState<AgentStatusEvent[]>([]);
  const [status, setStatus] = useState<"loading" | "running" | "done">("loading");
  const [error, setError] = useState<string | null>(null);

  /* ── UI state ───────────────────────────────────────────────── */
  const [activeSectionId, setActiveSectionId] = useState<string | null>(null);
  const [readIds, setReadIds] = useState<Set<string>>(() => new Set());
  const [progress, setProgress] = useState(0);
  const [navOpen, setNavOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRequest, setChatRequest] = useState<ChatRequest | null>(null);
  const [pendingMedia, setPendingMedia] = useState<Record<string, MediaRequestType>>({});
  const [downloadingLabId, setDownloadingLabId] = useState<string | null>(null);
  const [downloadingAll, setDownloadingAll] = useState(false);

  const sessionId =
    typeof window !== "undefined"
      ? localStorage.getItem(`cognexus_session_${paperId}`) || paperId
      : paperId;

  /* ── Load snapshot ──────────────────────────────────────────── */
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [snapshot, paperDetail, agentData] = await Promise.allSettled([
        getOutputSnapshot(paperId),
        getPaperDetail(paperId),
        getAgentJobs(paperId),
      ]);
      if (cancelled) return;

      if (paperDetail.status === "fulfilled") setPaper(paperDetail.value);

      if (snapshot.status === "fulfilled") {
        const data = snapshot.value as unknown as Record<string, unknown>;
        setSections((data.simplified_sections ?? data.sections ?? []) as SimplifiedSection[]);
        setVideos((data.videos ?? []) as VideoJob[]);
        ((data.images ?? []) as GeneratedImage[]).forEach(upsertImage);
        ((data.canvases ?? []) as GeneratedCanvas[]).forEach(upsertCanvas);
        ((data.labs ?? []) as GeneratedLab[]).forEach(upsertLab);
        ((data.web_search_results ?? []) as WebSearchResult[]).forEach(upsertWebResult);
        const jobs = (data.agent_jobs ?? []) as AgentStatusEvent[];
        const allDone =
          jobs.length > 0 && jobs.every((j) => j.status === "done" || j.status === "failed");
        setStatus(allDone ? "done" : "running");
      } else {
        setStatus("running");
      }

      if (agentData.status === "fulfilled") setAgentJobs(agentData.value.agents);
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paperId]);

  /* ── Live updates ───────────────────────────────────────────── */
  useEffect(() => {
    if (status !== "running") return;
    return subscribeToOutput(paperId, {
      onSimplification: upsertSection,
      onImage: upsertImage,
      onCanvas: upsertCanvas,
      onVideoQueued: upsertVideo,
      onVideoDone: upsertVideo,
      onLab: upsertLab,
      onResearch: upsertWebResult,
      onAgentStatus: setAgentJobs,
      onComplete: () => setStatus("done"),
      onError: () => setError("Live updates stopped. Refresh the page to reconnect."),
    });
  }, [paperId, status, upsertSection, upsertImage, upsertCanvas, upsertVideo, upsertLab, upsertWebResult]);

  /* ── Derived reading model ──────────────────────────────────── */
  const prepared = useMemo(() => prepareSections(sections), [sections]);

  const distribution = useMemo(
    () => distributeMedia(prepared, images, canvases, videos),
    [prepared, images, canvases, videos],
  );

  const figureCounts = useMemo(() => {
    const m = new Map<string, number>();
    distribution.bySection.forEach((list, id) => m.set(id, list.length));
    return m;
  }, [distribution]);

  const totalFigures = useMemo(
    () => [...distribution.bySection.values()].reduce((n, l) => n + l.length, 0),
    [distribution],
  );

  const totalMinutes = useMemo(
    () => prepared.reduce((n, p) => n + readingMinutes(p.words), 0),
    [prepared],
  );

  const overviewSources = useMemo(
    () => webSearchResults.filter((r) => r.concept === "_paper_overview"),
    [webSearchResults],
  );

  const activePrepared = useMemo(
    () => prepared.find((p) => p.section.id === activeSectionId) ?? prepared[0] ?? null,
    [prepared, activeSectionId],
  );

  const railData = useMemo(() => {
    if (!activePrepared) return null;
    return {
      media: distribution.bySection.get(activePrepared.section.id) ?? [],
      labs: labsForSection(activePrepared.section, labs),
      sources: sourcesForSection(activePrepared.section, webSearchResults),
    };
  }, [activePrepared, distribution, labs, webSearchResults]);

  /* ── Scroll tracking ────────────────────────────────────────── */
  const entries = useRef<Map<string, IntersectionObserverEntry>>(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (list) => {
        for (const e of list) entries.current.set(e.target.id, e);
        let top: string | null = null;
        let topY = Infinity;
        entries.current.forEach((e, id) => {
          if (e.isIntersecting && e.boundingClientRect.top < topY) {
            topY = e.boundingClientRect.top;
            top = id.replace("section-", "");
          }
        });
        if (top) setActiveSectionId(top);
        // Anything whose bottom has passed the viewport top counts as read.
        setReadIds((prev) => {
          let changed = false;
          const next = new Set(prev);
          entries.current.forEach((e, id) => {
            if (!e.isIntersecting && e.boundingClientRect.bottom < 0) {
              const sid = id.replace("section-", "");
              if (!next.has(sid)) {
                next.add(sid);
                changed = true;
              }
            }
          });
          return changed ? next : prev;
        });
      },
      { rootMargin: "-72px 0px -45% 0px", threshold: 0 },
    );
    document.querySelectorAll("[data-section-id]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [prepared.length]);

  useEffect(() => {
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const doc = document.documentElement;
        const max = doc.scrollHeight - window.innerHeight;
        setProgress(max > 0 ? Math.min(1, window.scrollY / max) : 0);
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  /* Lock body scroll while the mobile contents sheet is open */
  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setNavOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [navOpen]);

  /* ── Actions ────────────────────────────────────────────────── */
  const handleRequestMedia = useCallback(
    async (concept: string, type: MediaRequestType, sectionIndex: number) => {
      setPendingMedia((p) => ({ ...p, [concept]: type }));
      try {
        if (type === "image") {
          const section = sections.find((s) => s.section_index === sectionIndex);
          const img = await generateManualImage(
            paperId,
            concept,
            (section?.simplified_text ?? "").slice(0, 2000),
          );
          upsertImage(img);
        } else if (type === "canvas") {
          upsertCanvas(await generateManualCanvas(paperId, sectionIndex, concept));
        } else {
          upsertVideo(await generateManualVideo(paperId, concept));
        }
      } catch {
        toast(`Could not generate ${type} for "${concept}"`, "error");
      } finally {
        setPendingMedia((p) => {
          const next = { ...p };
          delete next[concept];
          return next;
        });
      }
    },
    [paperId, sections, upsertImage, upsertCanvas, upsertVideo, toast],
  );

  const handleRegenerateImage = useCallback(
    async (concept: string) => {
      try {
        upsertImage(await regenerateImage(paperId, concept));
      } catch {
        toast("Could not regenerate image", "error");
      }
    },
    [paperId, upsertImage, toast],
  );

  const handleDownloadLab = useCallback(
    async (lab: GeneratedLab) => {
      setDownloadingLabId(lab.id);
      try {
        const blob = await downloadLab(paperId, lab.id);
        triggerBlobDownload(blob, `${lab.title.replace(/\s+/g, "_")}.ipynb`);
      } catch {
        toast("Could not download notebook", "error");
      } finally {
        setDownloadingLabId(null);
      }
    },
    [paperId, toast],
  );

  const handleDownloadAllLabs = useCallback(async () => {
    setDownloadingAll(true);
    try {
      triggerBlobDownload(await downloadLabsZip(paperId), "labs.zip");
    } catch {
      toast("Could not download notebooks", "error");
    } finally {
      setDownloadingAll(false);
    }
  }, [paperId, toast]);

  const handleAsk = useCallback((question: string, sectionTitle: string) => {
    setChatRequest({ id: Date.now(), text: question, sectionTitle });
  }, []);

  /* ── Render ─────────────────────────────────────────────────── */
  const isEmpty = prepared.length === 0;
  const hasAppendix =
    labs.length > 0 ||
    webSearchResults.some((r) => !r.concept.startsWith("_")) ||
    distribution.orphans.length > 0;

  const nav = (
    <ContentsNav
      sections={prepared}
      activeId={activeSectionId ?? prepared[0]?.section.id ?? null}
      readIds={readIds}
      figureCounts={figureCounts}
      hasLabs={labs.length > 0}
      hasSources={webSearchResults.some((r) => !r.concept.startsWith("_"))}
      hasExtraFigures={distribution.orphans.length > 0}
      onNavigate={(sectionId) => {
        setNavOpen(false);
        if (sectionId) setActiveSectionId(sectionId);
      }}
    />
  );

  return (
    <div className="min-h-screen bg-page text-ink">
      {/* Reading progress */}
      <div
        aria-hidden
        className="fixed top-0 left-0 right-0 h-[2px] z-50 bg-transparent"
      >
        <div
          className="h-full bg-accent transition-[width] duration-150 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Top bar */}
      <header className="sticky top-0 z-30 bg-page/85 backdrop-blur-md border-b border-rule">
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 h-14 flex items-center gap-3 font-sans">
          <button
            onClick={() => router.push("/")}
            className="shrink-0 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden />
            <span className="hidden sm:inline">Library</span>
          </button>

          <button
            onClick={() => setNavOpen(true)}
            className="lg:hidden shrink-0 inline-flex items-center gap-1.5 text-[13px] text-ink-muted hover:text-ink transition-colors"
            aria-label="Open contents"
          >
            <List className="w-4 h-4" aria-hidden />
            Contents
          </button>

          <p className="min-w-0 flex-1 truncate text-[13.5px] text-ink-muted">
            <span className="text-ink">{paper?.title ?? "Loading…"}</span>
            {activePrepared && (
              <span className="hidden md:inline">
                {" "}
                <span className="text-ink-faint">/</span> {activePrepared.number}. {activePrepared.title}
              </span>
            )}
          </p>

          <PipelineStatus agents={agentJobs} />

          <button
            onClick={() => setChatOpen(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-rule px-3 py-1.5 text-xs text-ink-muted hover:text-ink hover:border-rule-strong transition-colors"
          >
            <MessageSquare className="w-3.5 h-3.5" aria-hidden />
            <span className="hidden sm:inline">Ask</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="mx-auto max-w-[1440px] px-4 sm:px-6 mt-4 font-sans">
          <div className="rounded-md border border-amber-700/50 bg-amber-900/20 px-4 py-2.5 text-[13px] text-amber-200">
            {error}
          </div>
        </div>
      )}

      {/* Three columns: contents · reading · margin notes */}
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[13.5rem_minmax(0,1fr)_17rem] lg:gap-10 xl:gap-12">
        {/* Contents */}
        <div className="hidden lg:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto scrollbar-thin py-8 pr-1">
            {isEmpty ? <SkeletonText lines={8} /> : nav}
          </div>
        </div>

        {/* Reading column */}
        <main className="min-w-0 py-8 lg:py-10">
          <div className="max-w-[70ch] mx-auto xl:mx-0">
            {isEmpty ? (
              <EmptyState status={status} agents={agentJobs} />
            ) : (
              <>
                <FrontMatter
                  paper={paper}
                  overview={distribution.overview}
                  overviewSources={overviewSources}
                  sectionCount={prepared.length}
                  figureCount={totalFigures}
                  totalMinutes={totalMinutes}
                />

                {prepared.map((p, i) => {
                  const media = distribution.bySection.get(p.section.id) ?? [];
                  const article = (
                    <SectionArticle
                      key={p.section.id}
                      prepared={p}
                      media={media}
                      onRegenerateImage={handleRegenerateImage}
                      onVideoUpdate={upsertVideo}
                      footer={
                        <SectionRail
                          compact
                          prepared={p}
                          media={media}
                          labs={labsForSection(p.section, labs)}
                          sources={sourcesForSection(p.section, webSearchResults)}
                          pending={pendingMedia}
                          onRequestMedia={handleRequestMedia}
                          onDownloadLab={handleDownloadLab}
                          downloadingLabId={downloadingLabId}
                          onAsk={handleAsk}
                        />
                      }
                    />
                  );
                  if (i < 3) return article;
                  return (
                    <LazySection
                      key={p.section.id}
                      id={p.section.id}
                      estimatedHeight={Math.max(400, p.words * 0.8)}
                    >
                      {article}
                    </LazySection>
                  );
                })}

                {status === "running" && (
                  <div className="font-sans text-[13px] text-ink-faint py-6 flex items-center gap-2">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                    More sections are being written…
                  </div>
                )}

                {hasAppendix && (
                  <div className="pt-6">
                    <Appendix
                      labs={labs}
                      sources={webSearchResults}
                      extraFigures={distribution.orphans}
                      onDownloadLab={handleDownloadLab}
                      onDownloadAllLabs={handleDownloadAllLabs}
                      downloadingLabId={downloadingLabId}
                      downloadingAll={downloadingAll}
                      onRegenerateImage={handleRegenerateImage}
                      onVideoUpdate={upsertVideo}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        </main>

        {/* Margin notes */}
        <div className="hidden xl:block">
          <div className="sticky top-14 max-h-[calc(100vh-3.5rem)] overflow-y-auto scrollbar-thin py-10 pl-1">
            {activePrepared && railData ? (
              <SectionRail
                key={activePrepared.section.id}
                prepared={activePrepared}
                media={railData.media}
                labs={railData.labs}
                sources={railData.sources}
                pending={pendingMedia}
                onRequestMedia={handleRequestMedia}
                onDownloadLab={handleDownloadLab}
                downloadingLabId={downloadingLabId}
                onAsk={handleAsk}
              />
            ) : (
              <SkeletonText lines={6} />
            )}
          </div>
        </div>
      </div>

      {/* Mobile contents sheet */}
      {navOpen && (
        <div className="lg:hidden fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Contents">
          <div className="absolute inset-0 bg-black/60" onClick={() => setNavOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[min(88vw,20rem)] bg-page border-r border-rule overflow-y-auto p-4 pt-3">
            <div className="flex justify-end mb-1">
              <button
                onClick={() => setNavOpen(false)}
                aria-label="Close contents"
                className="p-1.5 rounded text-ink-muted hover:text-ink"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {nav}
          </div>
        </div>
      )}

      <ChatPanel
        paperId={paperId}
        sessionId={sessionId}
        open={chatOpen}
        onOpenChange={setChatOpen}
        hideTrigger
        request={chatRequest}
      />
    </div>
  );
}

/* ── Empty / generating state ────────────────────────────────── */

function EmptyState({
  status,
  agents,
}: {
  status: "loading" | "running" | "done";
  agents: AgentStatusEvent[];
}) {
  if (status === "loading") {
    return (
      <div className="space-y-10 pt-6" aria-busy>
        <div className="space-y-4">
          <div className="skeleton-shimmer h-3 w-32 rounded" />
          <div className="skeleton-shimmer h-12 w-4/5 rounded" />
          <div className="skeleton-shimmer h-12 w-3/5 rounded" />
        </div>
        <SkeletonText lines={6} />
        <SkeletonText lines={5} />
      </div>
    );
  }
  if (status === "running") {
    return (
      <div className="pt-6 font-sans">
        <p className="font-serif text-[2rem] font-semibold text-ink leading-tight">
          Writing your reading…
        </p>
        <p className="mt-3 text-[14px] text-ink-muted max-w-[52ch]">
          Sections appear here as soon as each one is finished. Figures, labs and sources
          follow.
        </p>
        <div className="mt-8">
          <AgentActivityPanel agents={agents} />
        </div>
      </div>
    );
  }
  return (
    <div className="pt-6 font-sans">
      <p className="font-serif text-[2rem] font-semibold text-ink leading-tight">
        Nothing to read yet
      </p>
      <p className="mt-3 text-[14px] text-ink-muted max-w-[52ch]">
        Generation finished without producing any sections. Go back to the library and start
        this paper again.
      </p>
    </div>
  );
}
