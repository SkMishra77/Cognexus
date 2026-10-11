"use client";

import { useCallback, useEffect, useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Download, X } from "lucide-react";
import type { GeneratedImage } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";

interface Props {
  image: GeneratedImage;
  onRegenerate?: (concept: string) => Promise<void> | void;
  /** Render media + actions only; the parent supplies frame and caption. */
  frameless?: boolean;
}

function decodeSvg(b64: string): string | null {
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const decoded = new TextDecoder("utf-8").decode(bytes);
    const trimmed = decoded.trimStart();
    if (trimmed.startsWith("<svg") || trimmed.startsWith("<?xml"))
      return decoded;
  } catch {}
  return null;
}

export default function ImageBlock({ image, onRegenerate, frameless = false }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  // Track which source has finished loading so a new base64 payload starts hidden.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const imageLoaded = loadedSrc === image.image_base64;

  const svgMarkup = useMemo(
    () => (image.image_base64 ? decodeSvg(image.image_base64) : null),
    [image.image_base64],
  );

  const handleRegenerate = useCallback(async () => {
    setRegenerating(true);
    try {
      await onRegenerate?.(image.concept);
    } finally {
      setRegenerating(false);
    }
  }, [image.concept, onRegenerate]);

  const handleDownload = useCallback(() => {
    const link = document.createElement("a");
    const dlMime = svgMarkup ? "image/svg+xml" : "image/png";
    const dlExt = svgMarkup ? "svg" : "png";
    link.href = `data:${dlMime};base64,${image.image_base64}`;
    link.download = `${image.concept.replace(/\s+/g, "_")}.${dlExt}`;
    link.click();
  }, [image, svgMarkup]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  if (!image.image_base64) {
    return (
      <div
        className={
          frameless
            ? "flex items-center justify-center gap-3 py-10 bg-zinc-900/40 rounded-lg"
            : "rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 flex items-center justify-center gap-3"
        }
      >
        <Spinner size="sm" />
        <span className="text-sm text-zinc-400">
          Generating image for &ldquo;{image.concept}&rdquo;…
        </span>
      </div>
    );
  }

  const imgSrc = svgMarkup ? null : `data:image/png;base64,${image.image_base64}`;

  const media = svgMarkup ? (
    <div
      className="w-full max-h-[520px] cursor-zoom-in overflow-hidden [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[520px]"
      onClick={() => setLightboxOpen(true)}
      dangerouslySetInnerHTML={{ __html: svgMarkup }}
    />
  ) : (
    <motion.img
      src={imgSrc!}
      alt={image.caption ?? image.concept}
      className="max-w-full max-h-[520px] object-contain cursor-zoom-in"
      initial={{ opacity: 0 }}
      animate={{ opacity: imageLoaded ? 1 : 0 }}
      transition={{ duration: 0.4 }}
      onLoad={() => setLoadedSrc(image.image_base64)}
      onClick={() => setLightboxOpen(true)}
    />
  );

  const actions = frameless ? (
    <div className="flex items-center gap-0.5">
      <button
        onClick={handleRegenerate}
        disabled={regenerating}
        title="Regenerate image"
        aria-label="Regenerate image"
        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-40 transition-colors"
      >
        {regenerating ? <Spinner size={14} /> : <RefreshCw className="w-3.5 h-3.5" />}
      </button>
      <button
        onClick={handleDownload}
        title="Download image"
        aria-label="Download image"
        className="p-1.5 rounded-md text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
      </button>
    </div>
  ) : (
    <div className="flex gap-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={handleRegenerate}
        disabled={regenerating}
        loading={regenerating}
        iconLeft={!regenerating ? <RefreshCw className="w-3.5 h-3.5" /> : undefined}
      >
        Regenerate
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={handleDownload}
        iconLeft={<Download className="w-3.5 h-3.5" />}
      >
        Download
      </Button>
    </div>
  );

  return (
    <>
      {frameless ? (
        <div className="group/img relative">
          <div className="flex items-center justify-center rounded-lg overflow-hidden bg-zinc-900/40">
            {media}
          </div>
          <div className="absolute top-2 right-2 opacity-0 group-hover/img:opacity-100 focus-within:opacity-100 transition-opacity rounded-md bg-zinc-950/80 backdrop-blur-sm">
            {actions}
          </div>
        </div>
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
        >
          <div className="bg-zinc-900 flex items-center justify-center p-4">{media}</div>
          <div className="px-5 py-4 space-y-3">
            {image.caption && (
              <p className="text-sm text-zinc-400 leading-relaxed">{image.caption}</p>
            )}
            {actions}
          </div>
        </motion.div>
      )}

      {/* Lightbox overlay */}
      <AnimatePresence>
        {lightboxOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setLightboxOpen(false)}
          >
            <button
              className="absolute top-4 right-4 rounded-full bg-zinc-800/80 p-2 text-zinc-300 hover:bg-zinc-700 transition-colors"
              onClick={() => setLightboxOpen(false)}
              aria-label="Close lightbox"
            >
              <X className="w-5 h-5" />
            </button>
            {svgMarkup ? (
              <motion.div
                className="max-w-[90vw] max-h-[90vh] rounded-xl overflow-auto bg-white p-4 [&>svg]:w-full [&>svg]:h-auto [&>svg]:max-h-[85vh]"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.25 }}
                onClick={(e) => e.stopPropagation()}
                dangerouslySetInnerHTML={{ __html: svgMarkup }}
              />
            ) : (
              <motion.img
                src={imgSrc!}
                alt={image.caption ?? image.concept}
                className="w-[90vw] h-[90vh] rounded-xl object-contain"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.9, opacity: 0 }}
                transition={{ duration: 0.25 }}
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
