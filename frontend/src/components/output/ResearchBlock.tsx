"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, ChevronRight, ExternalLink, Globe } from "lucide-react";
import type { WebSearchResult } from "@/lib/types";

interface Props {
  results: WebSearchResult[];
}

function truncateUrl(url: string, maxLen = 60): string {
  try {
    const u = new URL(url);
    const display = u.hostname + u.pathname;
    return display.length > maxLen ? display.slice(0, maxLen) + "…" : display;
  } catch {
    return url.length > maxLen ? url.slice(0, maxLen) + "…" : url;
  }
}

const groupVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.07 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.25 } },
};

function ConceptGroup({
  concept,
  sources,
}: {
  concept: string;
  sources: WebSearchResult[];
}) {
  const [open, setOpen] = useState(true);

  return (
    <motion.div variants={itemVariants} className="space-y-2">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 w-full text-left group"
      >
        <ChevronRight
          size={14}
          className={`text-zinc-500 transition-transform duration-200 ${open ? "rotate-90" : ""}`}
        />
        <h3 className="text-sm font-semibold text-zinc-200 group-hover:text-zinc-100 transition-colors">
          {concept}
        </h3>
        <span className="text-xs text-zinc-600">
          {sources.length} source{sources.length !== 1 ? "s" : ""}
        </span>
      </button>

      {open && (
        <motion.div
          className="ml-5 space-y-2"
          initial="hidden"
          animate="visible"
          variants={groupVariants}
        >
          {sources.map((src) => (
            <motion.div
              key={src.id}
              variants={itemVariants}
              whileHover={{ scale: 1.01, backgroundColor: "rgba(63,63,70,0.35)" }}
              className="rounded-lg border border-zinc-700/60 bg-zinc-800/40 p-3 space-y-1.5 transition-colors"
            >
              <a
                href={src.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-sm font-medium text-indigo-400 hover:text-indigo-300 hover:underline transition-colors line-clamp-1"
              >
                <ExternalLink size={12} className="shrink-0 opacity-60" />
                {src.title}
              </a>
              <p className="text-xs text-zinc-400 leading-relaxed line-clamp-3">
                {src.snippet}
              </p>
              <p className="flex items-center gap-1 text-[11px] text-zinc-600 truncate">
                <Globe size={10} className="shrink-0" />
                {truncateUrl(src.url)}
              </p>
            </motion.div>
          ))}
        </motion.div>
      )}
    </motion.div>
  );
}

export default function ResearchBlock({ results }: Props) {
  if (results.length === 0) return null;

  const grouped = results.reduce<Record<string, WebSearchResult[]>>(
    (acc, r) => {
      if (!acc[r.concept]) acc[r.concept] = [];
      acc[r.concept].push(r);
      return acc;
    },
    {}
  );

  const concepts = Object.keys(grouped);

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 space-y-4"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-900/40">
          <Search className="w-4 h-4 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-zinc-100">
            Background Research
          </h2>
          <p className="text-xs text-zinc-500">
            Web sources discovered for {concepts.length} concept
            {concepts.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Concept groups */}
      <motion.div
        className="space-y-3"
        initial="hidden"
        animate="visible"
        variants={groupVariants}
      >
        {concepts.map((concept) => (
          <ConceptGroup
            key={concept}
            concept={concept}
            sources={grouped[concept]}
          />
        ))}
      </motion.div>

      {/* Attribution */}
      <p className="text-[10px] text-zinc-600 text-right">
        Powered by Tavily
      </p>
    </motion.div>
  );
}
