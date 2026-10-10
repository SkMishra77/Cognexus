"use client";

import { useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Copy, Check, Image, Pen, Video } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import type { SimplifiedSection as SimplifiedSectionType } from "@/lib/types";

interface Props {
  section: SimplifiedSectionType;
  paperId: string;
  onRequestImage?: (concept: string) => void;
  onRequestCanvas?: (concept: string) => void;
  onRequestVideo?: (concept: string) => void;
}

const mediaIcons = {
  image: Image,
  canvas: Pen,
  video: Video,
} as const;

export default function SimplifiedSection({
  section,
  paperId,
  onRequestImage,
  onRequestCanvas,
  onRequestVideo,
}: Props) {
  const [expandedConcept, setExpandedConcept] = useState<string | null>(null);
  const [loadingConcept, setLoadingConcept] = useState<Record<string, string>>(
    {},
  );
  const [copied, setCopied] = useState(false);

  const handleMediaRequest = useCallback(
    (concept: string, type: "image" | "canvas" | "video") => {
      setLoadingConcept((prev) => ({ ...prev, [concept]: type }));
      if (type === "image") onRequestImage?.(concept);
      else if (type === "canvas") onRequestCanvas?.(concept);
      else onRequestVideo?.(concept);

      setTimeout(() => {
        setLoadingConcept((prev) => {
          const next = { ...prev };
          delete next[concept];
          return next;
        });
      }, 5000);
    },
    [onRequestImage, onRequestCanvas, onRequestVideo],
  );

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(section.simplified_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard API may fail in insecure contexts */
    }
  }, [section.simplified_text]);

  const keyConcepts = section.key_concepts ?? [];
  const equations = section.equations ?? {};
  const mediaPlan = section.media_plan ?? {};

  return (
    <div
      id={`section-${section.id}`}
      data-section-id={section.id}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4"
      data-paper-id={paperId}
    >
      {/* Section Header */}
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-xl font-bold text-zinc-100">
          {section.title ?? `Section ${section.section_index + 1}`}
        </h2>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1.5 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
          title="Copy section text"
        >
          {copied ? (
            <Check className="w-4 h-4 text-emerald-400" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Simplified Text via react-markdown */}
      <div className="prose prose-invert prose-sm max-w-none prose-headings:text-zinc-100 prose-p:text-zinc-300 prose-p:leading-relaxed prose-code:bg-zinc-800 prose-code:text-indigo-300 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700 prose-li:text-zinc-300 prose-strong:text-zinc-100">
        <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
        >
          {section.simplified_text}
        </ReactMarkdown>
      </div>

      {/* Equations */}
      {Object.keys(equations).length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Key Equations
          </h3>
          {Object.entries(equations).map(([name, eq]) => (
            <div
              key={name}
              className="bg-zinc-900 border border-zinc-700 rounded-lg p-3 flex items-center justify-between"
            >
              <div>
                <span className="text-xs text-zinc-500">{name}</span>
                <pre className="text-sm font-mono text-indigo-300 mt-1">
                  {eq}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Key Concepts with Toolbars */}
      {keyConcepts.length > 0 && (
        <div className="space-y-2 mt-4">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-500">
            Key Concepts
          </h3>
          <div className="flex flex-wrap gap-2">
            {keyConcepts.map((concept) => {
              const planned = mediaPlan[concept] ?? [];
              const isExpanded = expandedConcept === concept;

              return (
                <div key={concept} className="relative">
                  <button
                    onClick={() =>
                      setExpandedConcept(isExpanded ? null : concept)
                    }
                    className={`inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-medium transition-colors
                      ${
                        isExpanded
                          ? "bg-indigo-600 text-white"
                          : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                      }`}
                  >
                    <span>{concept}</span>
                    {planned.length > 0 && (
                      <span className="ml-1 rounded-full bg-indigo-500/30 px-1.5 text-[10px] text-indigo-300">
                        {planned.join("·")}
                      </span>
                    )}
                  </button>

                  {/* Animated Toolbar popup */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.9, y: -4 }}
                        animate={{ opacity: 1, scale: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.9, y: -4 }}
                        transition={{ duration: 0.15 }}
                        className="absolute top-full left-1/2 -translate-x-1/2 mt-2 z-10 flex gap-1 rounded-lg bg-zinc-800 border border-zinc-700 p-1.5 shadow-xl"
                      >
                        {/* Arrow / triangle */}
                        <div className="absolute -top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-zinc-800 border-l border-t border-zinc-700" />

                        {(["image", "canvas", "video"] as const).map(
                          (type) => {
                            const Icon = mediaIcons[type];
                            return (
                              <button
                                key={type}
                                disabled={!!loadingConcept[concept]}
                                onClick={() =>
                                  handleMediaRequest(concept, type)
                                }
                                className="relative z-10 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors
                                           bg-zinc-700 text-zinc-300 hover:bg-zinc-600 hover:text-white
                                           disabled:opacity-40 disabled:cursor-not-allowed"
                              >
                                <Icon className="w-3 h-3" />
                                {loadingConcept[concept] === type
                                  ? "…"
                                  : type.charAt(0).toUpperCase() +
                                    type.slice(1)}
                              </button>
                            );
                          },
                        )}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
