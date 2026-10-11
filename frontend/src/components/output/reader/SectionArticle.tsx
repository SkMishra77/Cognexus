"use client";

import { useMemo, useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import rehypeKatex from "rehype-katex";
import { Copy, Check, Clock } from "lucide-react";
import "katex/dist/katex.min.css";
import type { TitledSection, PlacedMedia } from "@/lib/reader";
import { splitBlocks, readingMinutes } from "@/lib/reader";
import type { VideoJob } from "@/lib/types";
import Figure from "./Figure";

interface Props {
  prepared: TitledSection;
  media: PlacedMedia[];
  onRegenerateImage?: (concept: string) => Promise<void> | void;
  onVideoUpdate?: (v: VideoJob) => void;
  /** Rendered after the body on narrow screens (rail content). */
  footer?: React.ReactNode;
}

type Segment =
  | { kind: "md"; key: string; text: string }
  | { kind: "figure"; key: string; media: PlacedMedia };

/**
 * Interleave markdown text and figures. Text between two figure anchors is
 * rendered as one ReactMarkdown instance so the number of parsers stays
 * equal to (figures + 1), not (paragraphs).
 */
function buildSegments(body: string, media: PlacedMedia[]): Segment[] {
  const blocks = splitBlocks(body);
  const byBlock = new Map<number, PlacedMedia[]>();
  const tail: PlacedMedia[] = [];
  for (const m of media) {
    if (m.afterBlock < 0 || m.afterBlock >= blocks.length) tail.push(m);
    else byBlock.set(m.afterBlock, [...(byBlock.get(m.afterBlock) ?? []), m]);
  }

  const segments: Segment[] = [];
  let buf: string[] = [];
  let segIdx = 0;
  const flush = () => {
    if (buf.length) {
      segments.push({ kind: "md", key: `md-${segIdx++}`, text: buf.join("\n\n") });
      buf = [];
    }
  };

  blocks.forEach((b, i) => {
    buf.push(b.text);
    const figs = byBlock.get(i);
    if (figs) {
      flush();
      for (const f of figs) segments.push({ kind: "figure", key: `fig-${f.id}`, media: f });
    }
  });
  flush();
  for (const f of tail) segments.push({ kind: "figure", key: `fig-${f.id}`, media: f });
  return segments;
}

export default function SectionArticle({
  prepared,
  media,
  onRegenerateImage,
  onVideoUpdate,
  footer,
}: Props) {
  const { section, number, title, body, words } = prepared;
  const [copied, setCopied] = useState(false);

  const segments = useMemo(() => buildSegments(body, media), [body, media]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard may be unavailable */
    }
  }, [body]);

  const figureCount = media.length;

  return (
    <section
      id={`section-${section.id}`}
      data-section-id={section.id}
      className="reader-section scroll-mt-20 pb-14 mb-14 border-b border-rule last:border-b-0"
      aria-labelledby={`heading-${section.id}`}
    >
      <header className="mb-7">
        <div className="flex items-baseline gap-3 font-sans text-[13px] text-ink-faint">
          <span className="tabular-nums">Section {number}</span>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-3 h-3" aria-hidden />
            {readingMinutes(words)} min
          </span>
          {figureCount > 0 && (
            <span>
              {figureCount} figure{figureCount === 1 ? "" : "s"}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="ml-auto inline-flex items-center gap-1 text-ink-faint hover:text-ink transition-colors"
            title="Copy section text"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
          </button>
        </div>
        <h2
          id={`heading-${section.id}`}
          className="mt-2 font-serif text-[1.9rem] sm:text-[2.25rem] leading-[1.15] font-semibold tracking-[-0.01em] text-ink"
          style={{ fontVariationSettings: '"opsz" 36' }}
        >
          {title}
        </h2>
      </header>

      <div className="reading">
        {segments.map((seg) =>
          seg.kind === "md" ? (
            <ReactMarkdown
              key={seg.key}
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex]}
            >
              {seg.text}
            </ReactMarkdown>
          ) : (
            <Figure
              key={seg.key}
              media={seg.media}
              onRegenerateImage={onRegenerateImage}
              onVideoUpdate={onVideoUpdate}
            />
          ),
        )}
      </div>

      {footer && <div className="mt-10 xl:hidden">{footer}</div>}
    </section>
  );
}
