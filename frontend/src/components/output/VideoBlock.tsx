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
}

type VideoStatus = "rendering" | "done" | "error";

function resolveStatus(video: VideoJob): VideoStatus {
  if (video.status === "done" && video.mp4_path) return "done";
  if (video.status === "error") return "error";
  return "rendering";
}

const stateVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

export default function VideoBlock({ video, onStatusChange }: Props) {
  const [currentVideo, setCurrentVideo] = useState<VideoJob>(video);
  const [showPoster, setShowPoster] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    setCurrentVideo(video);
  }, [video]);

  useEffect(() => {
    if (
      currentVideo.status === "pending" ||
      currentVideo.status === "running"
    ) {
      pollRef.current = setInterval(async () => {
        try {
          const updated = await getVideoStatus(currentVideo.id);
          setCurrentVideo(updated);
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
    setTimeout(() => videoRef.current?.play(), 50);
  }, []);

  const status = resolveStatus(currentVideo);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
    >
      {/* Video or Progress */}
      <div className="bg-zinc-950 p-4 min-h-[200px] flex items-center justify-center">
        <AnimatePresence mode="wait">
          {status === "done" ? (
            <motion.div
              key="done"
              variants={stateVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={{ duration: 0.35 }}
              className="relative w-full flex items-center justify-center"
            >
              {/* Play button overlay / poster */}
              {showPoster && (
                <div
                  className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer bg-zinc-950/40 rounded-lg"
                  onClick={handlePlay}
                >
                  <div className="rounded-full bg-indigo-600/90 p-4 shadow-lg shadow-indigo-500/20 hover:bg-indigo-500 transition-colors">
                    <Play className="w-8 h-8 text-white fill-white" />
                  </div>
                </div>
              )}
              <video
                ref={videoRef}
                src={`${API_BASE}${currentVideo.mp4_path}`}
                controls={!showPoster}
                className="max-w-full max-h-[500px] rounded-lg"
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
              className="flex flex-col items-center gap-4 w-full max-w-md"
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
      <div className="px-5 py-4 flex items-center justify-between">
        <span className="text-sm text-zinc-400">{currentVideo.concept}</span>
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
    </motion.div>
  );
}
