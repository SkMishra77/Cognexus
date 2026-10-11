"use client";

import { FlaskConical, Download, Archive, ExternalLink, Loader2 } from "lucide-react";
import type { GeneratedLab, WebSearchResult, VideoJob } from "@/lib/types";
import type { MediaItem } from "@/lib/reader";
import { groupSources } from "@/lib/reader";
import Figure from "./Figure";

interface Props {
  labs: GeneratedLab[];
  sources: WebSearchResult[];
  extraFigures: MediaItem[];
  onDownloadLab: (lab: GeneratedLab) => void;
  onDownloadAllLabs: () => void;
  downloadingLabId: string | null;
  downloadingAll: boolean;
  onRegenerateImage?: (concept: string) => Promise<void> | void;
  onVideoUpdate?: (v: VideoJob) => void;
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function AppendixHeading({ id, label, title }: { id: string; label: string; title: string }) {
  return (
    <header id={id} className="scroll-mt-20 mb-6">
      <p className="font-sans text-[13px] text-ink-faint">{label}</p>
      <h2
        className="mt-1 font-serif text-[1.9rem] font-semibold tracking-[-0.01em] text-ink leading-tight"
        style={{ fontVariationSettings: '"opsz" 36' }}
      >
        {title}
      </h2>
    </header>
  );
}

/**
 * Everything that belongs to the whole paper rather than one section:
 * unplaced figures, every lab notebook, every source.
 */
export default function Appendix({
  labs,
  sources,
  extraFigures,
  onDownloadLab,
  onDownloadAllLabs,
  downloadingLabId,
  downloadingAll,
  onRegenerateImage,
  onVideoUpdate,
}: Props) {
  const grouped = groupSources(sources.filter((s) => !s.concept.startsWith("_")));
  if (labs.length === 0 && grouped.length === 0 && extraFigures.length === 0) return null;

  return (
    <div className="space-y-16">
      {extraFigures.length > 0 && (
        <section aria-labelledby="appendix-figures">
          <AppendixHeading id="appendix-figures" label="Appendix" title="Additional figures" />
          <p className="font-sans text-[13.5px] text-ink-muted mb-2 max-w-[60ch]">
            Figures generated for this paper that do not belong to one section.
          </p>
          <div className="reading">
            {extraFigures.map((m, i) => (
              <Figure
                key={m.id}
                media={{ ...m, afterBlock: -1, label: `A.${i + 1}` }}
                onRegenerateImage={onRegenerateImage}
                onVideoUpdate={onVideoUpdate}
              />
            ))}
          </div>
        </section>
      )}

      {labs.length > 0 && (
        <section aria-labelledby="appendix-labs">
          <AppendixHeading id="appendix-labs" label="Appendix" title="Lab notebooks" />
          <div className="flex items-start justify-between gap-4 mb-5">
            <p className="font-sans text-[13.5px] text-ink-muted max-w-[52ch]">
              Runnable Jupyter notebooks that let you experiment with the ideas above.
              Download one, or all of them as a zip.
            </p>
            <button
              onClick={onDownloadAllLabs}
              disabled={downloadingAll}
              className="shrink-0 inline-flex items-center gap-2 rounded-md bg-ink text-page font-sans text-[13px] font-medium px-3 py-2 hover:bg-white transition-colors disabled:opacity-60"
            >
              {downloadingAll ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              ) : (
                <Archive className="w-3.5 h-3.5" aria-hidden />
              )}
              Download all
            </button>
          </div>
          <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            {labs.map((lab) => (
              <li key={lab.id}>
                <button
                  onClick={() => onDownloadLab(lab)}
                  disabled={downloadingLabId === lab.id}
                  className="w-full h-full text-left flex items-start gap-3 rounded-lg border border-rule p-3.5 hover:border-zinc-500 hover:bg-zinc-900/60 transition-colors disabled:opacity-60"
                >
                  <FlaskConical className="w-4 h-4 mt-0.5 text-emerald-400 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 font-sans">
                    <span className="block text-[14px] text-ink leading-snug">{lab.title}</span>
                    <span className="block text-[12px] text-ink-faint mt-1">{lab.concept}</span>
                  </span>
                  {downloadingLabId === lab.id ? (
                    <Loader2 className="w-4 h-4 mt-0.5 animate-spin text-ink-faint" />
                  ) : (
                    <Download className="w-4 h-4 mt-0.5 text-ink-faint" aria-hidden />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {grouped.length > 0 && (
        <section aria-labelledby="appendix-sources">
          <AppendixHeading id="appendix-sources" label="Appendix" title="Sources" />
          <div className="space-y-8">
            {grouped.map(([concept, items]) => (
              <div key={concept}>
                <h3 className="font-serif text-[1.15rem] font-semibold text-ink mb-3">{concept}</h3>
                <ol className="space-y-3">
                  {items.map((s) => (
                    <li key={s.id} className="font-sans">
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group inline-flex items-start gap-1.5 text-[14.5px] text-ink hover:text-accent leading-snug"
                      >
                        {s.title}
                        <ExternalLink className="w-3 h-3 mt-1 text-ink-faint shrink-0" aria-hidden />
                      </a>
                      <p className="text-[13px] text-ink-muted leading-relaxed mt-1 line-clamp-2 max-w-[70ch]">
                        {s.snippet}
                      </p>
                      <p className="text-[12px] text-ink-faint mt-0.5">{hostname(s.url)}</p>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
            <p className="font-sans text-[11px] text-ink-faint">Search results provided by Tavily.</p>
          </div>
        </section>
      )}
    </div>
  );
}
