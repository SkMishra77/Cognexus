"use client";

import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Download, X } from "lucide-react";
import type { GeneratedImage } from "@/lib/types";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";

interface Props {
  image: GeneratedImage;
  onRegenerate?: (concept: string) => Promise<void> | void;
}

export default function ImageBlock({ image, onRegenerate }: Props) {
  const [regenerating, setRegenerating] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

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
    link.href = `data:image/png;base64,${image.image_base64}`;
    link.download = `${image.concept.replace(/\s+/g, "_")}.png`;
    link.click();
  }, [image]);

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightboxOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  // Reset imageLoaded when image data changes
  useEffect(() => {
    setImageLoaded(false);
  }, [image.image_base64]);

  if (!image.image_base64) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 flex items-center justify-center gap-3"
      >
        <Spinner size="sm" />
        <span className="text-sm text-zinc-400">
          Generating image for &ldquo;{image.concept}&rdquo;…
        </span>
      </motion.div>
    );
  }

  const imgSrc = `data:image/png;base64,${image.image_base64}`;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="rounded-xl border border-zinc-800 bg-zinc-900/60 overflow-hidden"
      >
        {/* Image */}
        <div className="bg-zinc-950 flex items-center justify-center p-4">
          <motion.img
            src={imgSrc}
            alt={image.caption ?? image.concept}
            className="max-w-full max-h-[500px] rounded-lg object-contain cursor-zoom-in"
            initial={{ opacity: 0 }}
            animate={{ opacity: imageLoaded ? 1 : 0 }}
            transition={{ duration: 0.5 }}
            onLoad={() => setImageLoaded(true)}
            onClick={() => setLightboxOpen(true)}
          />
        </div>

        {/* Caption & Actions */}
        <div className="px-5 py-4 space-y-3">
          {image.caption && (
            <p className="text-sm text-zinc-400 leading-relaxed">
              {image.caption}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={handleRegenerate}
              disabled={regenerating}
              loading={regenerating}
              iconLeft={
                !regenerating ? <RefreshCw className="w-3.5 h-3.5" /> : undefined
              }
            >
              Regenerate
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDownload}
              iconLeft={<Download className="w-3.5 h-3.5" />}
            >
              Download PNG
            </Button>
          </div>
        </div>
      </motion.div>

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
            <motion.img
              src={imgSrc}
              alt={image.caption ?? image.concept}
              className="max-w-[90vw] max-h-[90vh] rounded-xl object-contain"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.25 }}
              onClick={(e) => e.stopPropagation()}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
