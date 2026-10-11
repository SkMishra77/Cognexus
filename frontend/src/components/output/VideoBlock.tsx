"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Download, Play } from "lucide-react";
import type { VideoJob } from "@/lib/types";
import { getVideoStatus, API_BASE } from "@/lib/api";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";

interface Props {
  video: VideoJob;
  onStatusChange?: (updated: VideoJob) => void;
  /** Render the player only; the parent supplies frame and caption. */
  frameless?: boolean;
}

type VideoStatus = "rendering" | "done" | "error";

function resolveStatus(video: VideoJob): VideoStatus {
  if (video.status === "done" && video.mp4_path) return "done";
  if (video.status === "error" || video.status === "failed") return "error";
  return "rendering";
}

const stateVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export default function VideoBlock({ video, onStatusChange, frameless = false }: Props) {
  // Polling may learn about completion before the parent does. Keep the
  // polled copy only while it is for the same job and the prop is not final.
  const [polled, setPolled] = useState<VideoJob | null>(null);
  const propFinal = video.status === "done" || video.status === "error" || video.status === "failed";
  const currentVideo = polled && polled.id === video.id && !propFinal ? polled : video;
  const [showPoster, setShowPoster] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (
      currentVideo.status === "pending" ||
      currentVideo.status === "running" ||
      currentVideo.status === "queued" ||
      currentVideo.status === "rendering"
    ) {
      pollRef.current = setInterval(async () => {
        try {
          const updated = await getVideoStatus(currentVideo.id);
          setPolled(updated);
          onStatusChange?.(updated);
          if (updated.status === "done" || updated.status === "error") {
            if (pollRef.current) clearInterval(pollRef.current);
          }
        } catch {
          /* silently retry */
        }
      }, 3000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [currentVideo.id, currentVideo.status, onStatusChange]);

  const handleDownload = useCallback(() => {
    if (currentVideo.mp4_path) {
      const link = document.createElement("a");
      link.href = `${API_BASE}${currentVideo.mp4_path}`;
      link.download = `${currentVideo.concept.replace(/\s+/g, "_")}.mp4`;
      link.click();
    }
  }, [currentVideo]);

  const handlePlay = useCallback(() => {
    setShowPoster(false);
    setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
        videoRef.current.play();
      }
    }, 50);
  }, []);

  const status = resolveStatus(currentVideo);

  const body = (
    <>
      {/* Video or Progress */}
      <div className={`${frameless ? "" : "bg-zinc-900"} min-h-[120px] flex items-center justify-center`}>
        <AnimatePresence mode="wait">
          {status === "done" ? (
            <motion.div
              key="done"
              variants={stateVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35 }}
              className="relative w-full aspect-video"
            >
              {/* Play button overlay / poster */}
              {showPoster && (
                <div
                  className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 cursor-pointer bg-gradient-to-t from-zinc-900/80 via-zinc-900/30 to-zinc-900/50"
                  onClick={handlePlay}
                >
                  <div className="rounded-full bg-indigo-600/90 p-4 shadow-lg shadow-indigo-500/20 hover:bg-indigo-500 transition-colors">
                    <Play className="w-8 h-8 text-white fill-white" />
                  </div>
                  <span className="text-sm text-zinc-300 max-w-[80%] text-center line-clamp-2 font-sans">
                    {frameless
                      ? "Play animation"
                      : currentVideo.concept.replace(/[_\-]+/g, " ")}
                  </span>
                </div>
              )}
              <video
                ref={videoRef}
                src={`${API_BASE}${currentVideo.mp4_path}#t=3`}
                controls={!showPoster}
                preload="metadata"
                className="w-full h-full object-contain"
                onPlay={() => setShowPoster(false)}
              >
                Your browser does not support the video tag.
              </video>
            </motion.div>
          ) : status === "rendering" ? (
            <motion.div
              key="rendering"
              variants={stateVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center gap-4 w-full max-w-md py-8"
            >
              <Spinner size="lg" />
              <p className="text-sm text-zinc-400">
                Rendering video for &ldquo;{currentVideo.concept}&rdquo;…
              </p>

              {/* Indeterminate progress bar */}
              <div className="w-full rounded-full bg-zinc-800 h-2 overflow-hidden relative">
                <motion.div
                  className="absolute h-full rounded-full bg-indigo-500"
                  initial={{ left: "-30%", width: "30%" }}
                  animate={{ left: "100%" }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              </div>

              <span className="text-xs text-zinc-500 uppercase tracking-wide">
                {currentVideo.status === "running" ? "Rendering" : "Queued"}
              </span>
            </motion.div>
          ) : status === "error" ? (
            <motion.div
              key="error"
              variants={stateVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35 }}
              className="flex flex-col items-center gap-2 text-red-400"
            >
              <AlertTriangle className="w-8 h-8" />
              <p className="text-sm">
                Video rendering failed
                {currentVideo.error ? `: ${currentVideo.error}` : ""}
              </p>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      {/* Caption & Actions */}
      {frameless ? (
        status === "done" && (
          <button
            onClick={handleDownload}
            title="Download MP4"
            aria-label="Download MP4"
            className="absolute top-2 right-2 z-20 p-1.5 rounded-md bg-zinc-950/80 backdrop-blur-sm text-zinc-400 hover:text-zinc-100 opacity-0 group-hover/vid:opacity-100 focus:opacity-100 transition-opacity"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
        )
      ) : (
        <div className="px-5 py-4 flex items-center justify-between">
          <span className="text-sm text-zinc-400">{currentVideo.caption || currentVideo.concept}</span>
          {status === "done" && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownload}
              iconLeft={<Download className="w-3.5 h-3.5" />}
            >
              Download MP4
            </Button>
          )}
        </div>
      )}
    </>
  );

  if (frameless) {
    return (
      <div className="relative group/vid rounded-lg overflow-hidden bg-zinc-900/40">
        {body}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
    >
      {body}
    </motion.div>
  );
}
