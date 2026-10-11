"use client";

import { Image as ImageIcon, Shapes, Film } from "lucide-react";
import type { PlacedMedia, MediaKind } from "@/lib/reader";
import type { VideoJob } from "@/lib/types";
import ImageBlock from "../ImageBlock";
import CanvasBlock from "../CanvasBlock";
import VideoBlock from "../VideoBlock";

const KIND_LABEL: Record<MediaKind, string> = {
  image: "Illustration",
  canvas: "Diagram",
  video: "Animation",
};

const KIND_ICON: Record<MediaKind, typeof ImageIcon> = {
  image: ImageIcon,
  canvas: Shapes,
  video: Film,
};

interface Props {
  media: PlacedMedia;
  onRegenerateImage?: (concept: string) => Promise<void> | void;
  onVideoUpdate?: (v: VideoJob) => void;
}

/** Turn `snake_case_concept` into readable words for a fallback caption. */
function humanize(concept: string): string {
  return concept.replace(/[_\-]+/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * A numbered textbook figure: media on top, "Figure 3.2" + caption below.
 * Media blocks render frameless; this component owns the frame.
 */
export default function Figure({ media, onRegenerateImage, onVideoUpdate }: Props) {
  const Icon = KIND_ICON[media.kind];
  const caption = media.caption?.trim() || humanize(media.concept);

  return (
    <figure
      id={`figure-${media.id}`}
      className="my-8 scroll-mt-24 border-y border-rule py-4 sm:border-y-0 sm:py-0"
    >
      <div className="sm:rounded-lg sm:border sm:border-rule sm:p-1.5">
        {media.kind === "image" && media.image && (
          <ImageBlock image={media.image} onRegenerate={onRegenerateImage} frameless />
        )}
        {media.kind === "canvas" && media.canvas && (
          <CanvasBlock canvas={media.canvas} frameless />
        )}
        {media.kind === "video" && media.video && (
          <VideoBlock video={media.video} onStatusChange={onVideoUpdate} frameless />
        )}
      </div>
      <figcaption className="mt-3 flex gap-3 text-[13.5px] leading-relaxed text-ink-muted font-sans">
        <span className="shrink-0 inline-flex items-center gap-1.5 text-ink whitespace-nowrap">
          <Icon className="w-3.5 h-3.5 text-ink-faint" aria-hidden />
          <span className="font-medium">Figure {media.label}</span>
        </span>
        <span>
          <span className="sr-only">{KIND_LABEL[media.kind]}. </span>
          {caption}
        </span>
      </figcaption>
    </figure>
  );
}
