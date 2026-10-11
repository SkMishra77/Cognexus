"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import type { Paper, GeneratedCanvas, WebSearchResult } from "@/lib/types";
import CanvasBlock from "../CanvasBlock";

interface Props {
  paper: Paper | null;
  overview: GeneratedCanvas | null;
  overviewSources: WebSearchResult[];
  sectionCount: number;
  figureCount: number;
  totalMinutes: number;
}

/**
 * Title page: the paper's own metadata, its abstract, and the one-diagram
 * overview the pipeline draws before any section is written.
 */
export default function FrontMatter({
  paper,
  overview,
  overviewSources,
  sectionCount,
  figureCount,
  totalMinutes,
}: Props) {
  const [abstractOpen, setAbstractOpen] = useState(false);
  const authors = paper?.authors ?? [];

  return (
    <header className="pb-12 mb-14 border-b border-rule">
      <p className="font-sans text-[13px] text-ink-faint mb-4">
        A guided reading
        {paper?.year ? ` of a ${paper.year} paper` : ""}
      </p>
      <h1
        className="font-serif font-semibold text-ink tracking-[-0.015em] leading-[1.08] text-[2.6rem] sm:text-[3.4rem]"
        style={{ fontVariationSettings: '"opsz" 60' }}
      >
        {paper?.title ?? "Preparing your reading…"}
      </h1>

      {authors.length > 0 && (
        <p className="mt-5 font-serif italic text-[1.05rem] leading-relaxed text-ink-muted max-w-[60ch]">
          {authors.join(", ")}
        </p>
      )}

      <dl className="mt-6 flex flex-wrap gap-x-7 gap-y-2 font-sans text-[13px] text-ink-muted">
        <div className="flex gap-1.5">
          <dt className="text-ink-faint">Sections</dt>
          <dd className="tabular-nums text-ink">{sectionCount}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ink-faint">Figures</dt>
          <dd className="tabular-nums text-ink">{figureCount}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-ink-faint">Reading time</dt>
          <dd className="tabular-nums text-ink">
            {totalMinutes >= 60
              ? totalMinutes % 60 === 0
                ? `${totalMinutes / 60} h`
                : `${Math.floor(totalMinutes / 60)} h ${totalMinutes % 60} min`
              : `${totalMinutes} min`}
          </dd>
        </div>
        {paper?.doi && (
          <div className="flex gap-1.5">
            <dt className="text-ink-faint">DOI</dt>
            <dd>
              <a
                href={`https://doi.org/${paper.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                {paper.doi}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {paper?.abstract && (
        <div className="mt-8 max-w-[68ch]">
          <p className="font-sans text-[13px] text-ink-faint mb-2">Original abstract</p>
          <p
            className={`reading !text-[1rem] !leading-[1.7] text-ink-muted ${abstractOpen ? "" : "line-clamp-3"}`}
          >
            {paper.abstract}
          </p>
          <button
            onClick={() => setAbstractOpen((v) => !v)}
            className="mt-1.5 font-sans text-[13px] text-accent hover:underline"
          >
            {abstractOpen ? "Show less" : "Read the full abstract"}
          </button>
        </div>
      )}

      {overview && (
        <figure className="mt-10">
          <div className="rounded-lg border border-rule p-1.5">
            <CanvasBlock canvas={overview} frameless />
          </div>
          <figcaption className="mt-3 font-sans text-[13.5px] leading-relaxed text-ink-muted">
            <span className="font-medium text-ink">Overview.</span>{" "}
            {overview.caption || "How the paper's main ideas fit together."}
          </figcaption>
        </figure>
      )}

      {overviewSources.length > 0 && (
        <div className="mt-8">
          <p className="font-sans text-[13px] text-ink-faint mb-2">Background reading</p>
          <ul className="flex flex-wrap gap-2">
            {overviewSources.slice(0, 6).map((s) => (
              <li key={s.id}>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-rule px-2.5 py-1.5 font-sans text-[12.5px] text-ink-muted hover:text-ink hover:border-rule-strong transition-colors max-w-[22rem]"
                >
                  <ExternalLink className="w-3 h-3 text-ink-faint shrink-0" aria-hidden />
                  <span className="truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </header>
  );
}
